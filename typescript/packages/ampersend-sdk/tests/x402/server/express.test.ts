import type { Server } from "node:http"
import type { AddressInfo } from "node:net"

import type { X402ServerExecutor } from "@/x402/server/executor.ts"
import { ampersendPaymentMiddleware } from "@/x402/server/express.ts"
import { encodePaymentSignatureHeader } from "@x402/core/http"
import express from "express"
import { afterEach, describe, expect, it } from "vitest"

import { makeFakeFacilitatorExecutor, samplePayment, sampleRequirements } from "./helpers.ts"

function startApp(executor: X402ServerExecutor): Promise<{ server: Server; baseUrl: string }> {
  const app = express()
  app.use(express.json())
  app.use(
    ampersendPaymentMiddleware({
      executor,
      routes: { "GET /api/insight": { accepts: [sampleRequirements] } },
    }),
  )
  app.get("/api/insight", (_req, res) => {
    res.json({ insight: "buy low sell high" })
  })
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const port = (server.address() as AddressInfo).port
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` })
    })
  })
}

describe("ampersendPaymentMiddleware (Express adapter)", () => {
  let server: Server | undefined

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve) => server!.close(() => resolve()))
      server = undefined
    }
  })

  it("(g) executor deny -> 403 generic, handler not run, no detail leaked", async () => {
    // Executor that denies (compliance posture): verify returns isValid:false.
    const denyExecutor: X402ServerExecutor = {
      verifyPayment: async () => ({ isValid: false, invalidReason: "Payment rejected" }),
      settlePayment: async () => {
        throw new Error("settle should not be called on deny")
      },
    }
    const started = await startApp(denyExecutor)
    server = started.server

    const paymentHeader = encodePaymentSignatureHeader(samplePayment())
    const res = await fetch(`${started.baseUrl}/api/insight`, { headers: { "X-PAYMENT": paymentHeader } })

    expect(res.status).toBe(403)
    const body = (await res.json()) as { error?: string; insight?: string }
    expect(body).toEqual({ error: "Payment rejected" })
    expect(body.insight).toBeUndefined()
  })

  it("no X-PAYMENT -> 402 with advertised requirements", async () => {
    const started = await startApp(makeFakeFacilitatorExecutor())
    server = started.server

    const res = await fetch(`${started.baseUrl}/api/insight`)

    expect(res.status).toBe(402)
    const body = (await res.json()) as { accepts: Array<unknown> }
    expect(body.accepts).toHaveLength(1)
  })

  it("allow -> 200 with handler body and X-PAYMENT-RESPONSE header", async () => {
    const started = await startApp(makeFakeFacilitatorExecutor())
    server = started.server

    const paymentHeader = encodePaymentSignatureHeader(samplePayment())
    const res = await fetch(`${started.baseUrl}/api/insight`, { headers: { "X-PAYMENT": paymentHeader } })

    expect(res.status).toBe(200)
    expect(res.headers.get("X-PAYMENT-RESPONSE")).toBeTruthy()
    const body = (await res.json()) as { insight: string }
    expect(body.insight).toBe("buy low sell high")
  })

  it("executor that throws -> fail closed to 403 generic", async () => {
    const throwingExecutor: X402ServerExecutor = {
      verifyPayment: async () => {
        throw new Error("boom")
      },
      settlePayment: async () => {
        throw new Error("unused")
      },
    }
    const started = await startApp(throwingExecutor)
    server = started.server

    const paymentHeader = encodePaymentSignatureHeader(samplePayment())
    const res = await fetch(`${started.baseUrl}/api/insight`, { headers: { "X-PAYMENT": paymentHeader } })

    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: "Payment rejected" })
  })

  it("settle failure -> 402 retryable", async () => {
    const settleFailExecutor: X402ServerExecutor = {
      verifyPayment: async () => ({ isValid: true }),
      settlePayment: async () => ({
        success: false,
        errorReason: "settle bork",
        transaction: "",
        network: "base-sepolia",
      }),
    }
    const started = await startApp(settleFailExecutor)
    server = started.server

    const paymentHeader = encodePaymentSignatureHeader(samplePayment())
    const res = await fetch(`${started.baseUrl}/api/insight`, { headers: { "X-PAYMENT": paymentHeader } })

    expect(res.status).toBe(402)
  })

  it("unprotected route passes through untouched", async () => {
    const started = await startApp(makeFakeFacilitatorExecutor())
    server = started.server
    // Hit a route not in the config — middleware should call next(), so the
    // app falls through to a 404 rather than a 402/403.
    const res = await fetch(`${started.baseUrl}/api/unprotected`)
    expect(res.status).toBe(404)
  })
})
