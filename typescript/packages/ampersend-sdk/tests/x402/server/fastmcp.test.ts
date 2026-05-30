import type { X402ServerExecutor } from "@/x402/server/executor.ts"
import { createExecutorOnPayment, withAmpersendX402PaymentMcp } from "@/x402/server/fastmcp.ts"
import { describe, expect, it, vi } from "vitest"

import { makeFakeFacilitatorExecutor, samplePayment, sampleRequirements } from "./helpers.ts"

const mcpPayment = samplePayment() as never
const mcpRequirements = sampleRequirements as never

describe("FastMCP adapter (createExecutorOnPayment / withAmpersendX402PaymentMcp)", () => {
  it("(h) executor deny -> onPayment throws the generic reason (drives the 402 reject path)", async () => {
    const denyExecutor: X402ServerExecutor = {
      verifyPayment: async () => ({ isValid: false, invalidReason: "Payment rejected" }),
      settlePayment: async () => {
        throw new Error("settle should not run on deny")
      },
    }
    const onPayment = createExecutorOnPayment(denyExecutor)

    await expect(onPayment({ payment: mcpPayment, requirements: mcpRequirements })).rejects.toThrow("Payment rejected")
  })

  it("allow -> onPayment returns the SettleResponse to embed in _meta", async () => {
    const facilitatorExecutor = makeFakeFacilitatorExecutor()
    const onPayment = createExecutorOnPayment(facilitatorExecutor)

    const settlement = await onPayment({ payment: mcpPayment, requirements: mcpRequirements })

    expect(settlement).toMatchObject({ success: true, transaction: "0xdeadbeef" })
  })

  it("withAmpersendX402PaymentMcp throws a 402-style error on deny (fail closed via withX402Payment)", async () => {
    const denyExecutor: X402ServerExecutor = {
      verifyPayment: async () => ({ isValid: false, invalidReason: "Payment rejected" }),
      settlePayment: async () => {
        throw new Error("unused")
      },
    }
    const wrap = withAmpersendX402PaymentMcp({
      executor: denyExecutor,
      onExecute: async () => sampleRequirements as never,
    })
    const innerExecute = vi.fn(async () => "secret content")
    const wrapped = wrap(innerExecute)

    // FastMCP context carries the decoded payment under requestMetadata.
    const context = { requestMetadata: { "x402/payment": samplePayment() } }
    await expect(wrapped({} as never, context as never)).rejects.toMatchObject({ code: 402 })
    // The protected tool body never runs on a deny.
    expect(innerExecute).not.toHaveBeenCalled()
  })

  it("withAmpersendX402PaymentMcp runs the tool on allow and attaches settlement to _meta", async () => {
    const wrap = withAmpersendX402PaymentMcp({
      executor: makeFakeFacilitatorExecutor(),
      onExecute: async () => sampleRequirements as never,
    })
    const wrapped = wrap(async () => "ok")

    const context = { requestMetadata: { "x402/payment": samplePayment() } }
    const result = (await wrapped({} as never, context as never)) as { _meta?: Record<string, unknown> }

    expect(result._meta?.["x402/payment-response"]).toMatchObject({ success: true })
  })
})
