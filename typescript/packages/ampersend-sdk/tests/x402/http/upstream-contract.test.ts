/**
 * `AmpersendX402Client` extends upstream's `x402Client` and relies on unwritten
 * properties of `createPaymentPayload`: the sync selector runs after
 * filter+policy, `Array.prototype.filter` preserves element references, and
 * upstream wraps v2 results into `{ x402Version, resource, accepted, payload }`.
 *
 * Pin the behavior end-to-end against a real upstream (no `@x402/core` mocks)
 * so a silent call-graph change at upgrade time breaks here, not in production.
 */
import type { PaymentAuthorization } from "@/x402/envelopes.ts"
import { AmpersendX402Client } from "@/x402/http/client.ts"
import type { Authorization, X402Treasurer } from "@/x402/treasurer.ts"
import type { PaymentRequired as V2PaymentRequired } from "@x402/core/types"
import { describe, expect, it, vi } from "vitest"

const accepts = [
  {
    scheme: "exact",
    network: "eip155:84532",
    asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    amount: "1000",
    payTo: "0x1111111111111111111111111111111111111111",
    maxTimeoutSeconds: 300,
    extra: { name: "USDC", version: "2" },
  },
  {
    scheme: "exact",
    network: "eip155:84532",
    asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    amount: "2000",
    payTo: "0x2222222222222222222222222222222222222222",
    maxTimeoutSeconds: 300,
    extra: { name: "USDC", version: "2" },
  },
] as const

const paymentRequired: V2PaymentRequired = {
  x402Version: 2,
  resource: { url: "https://api.example.com/r", description: "test", mimeType: "application/json" },
  accepts: [...accepts],
  extensions: { someServerExtension: { foo: "bar" } },
}

const signedPayload: PaymentAuthorization = {
  protocol: "x402-v2",
  data: {
    x402Version: 2,
    resource: paymentRequired.resource,
    accepted: accepts[1],
    payload: { signature: "0xdeadbeef", authorization: { from: "0x0", to: "0x0", value: "2000" } },
  },
}

describe("AmpersendX402Client × real @x402/core contract", () => {
  it("routes the treasurer's pick through upstream and produces a well-formed v2 envelope", async () => {
    // Treasurer picks accepts[1] (not the default accepts[0]).
    const treasurer: X402Treasurer = {
      onPaymentRequired: vi.fn().mockResolvedValue({
        payment: signedPayload,
        authorizationId: "auth-1",
        accepted: accepts[1],
      } satisfies Authorization),
      onStatus: vi.fn().mockResolvedValue(undefined),
    }

    const client = new AmpersendX402Client(treasurer).withNetworks({ v2: ["eip155:84532"] })
    const payload = await client.createPaymentPayload(paymentRequired)

    expect(payload.x402Version).toBe(2)
    expect(payload.resource).toEqual(paymentRequired.resource)
    expect(payload.accepted).toBe(accepts[1]) // reference identity preserved through filter
    expect(payload.payload).toEqual(signedPayload.data.payload) // our signed bytes, untouched
    expect(payload.extensions).toEqual({ someServerExtension: { foo: "bar" } })

    expect(treasurer.onStatus).toHaveBeenCalledWith("sending", expect.anything(), { method: "http" })
  })
})
