import type { X402ServerExecutor } from "@/x402/server/executor.ts"
import type { AmpersendPaymentRequirements } from "@/x402/server/express.ts"
import type { PaymentPayload, SettleResponse, VerifyResponse } from "@x402/core/types"
import { vi } from "vitest"

/**
 * A minimal `exact` requirement the seller advertises, in the v1-wire superset
 * shape used by the Express adapter: v1-wire fields (`maxAmountRequired`,
 * `description`, `mimeType`) + the v2 `amount`. `resource` is omitted so the
 * adapter fills it per-request from the request URL.
 */
export const sampleRequirements: AmpersendPaymentRequirements = {
  scheme: "exact",
  network: "base-sepolia",
  maxAmountRequired: "1000",
  amount: "1000",
  description: "An insight",
  mimeType: "application/json",
  payTo: "0x2222222222222222222222222222222222222222",
  maxTimeoutSeconds: 300,
  asset: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  extra: { name: "USDC", version: "2" },
}

/** A decoded v1 `exact` payment payload from a given payer. */
export function samplePayment(payer = "0x1111111111111111111111111111111111111111", scheme = "exact"): PaymentPayload {
  return {
    x402Version: 1,
    scheme,
    network: "base-sepolia",
    payload: {
      signature: "0x" + "ab".repeat(65),
      authorization: {
        from: payer,
        to: sampleRequirements.payTo,
        value: "1000",
        validAfter: "0",
        validBefore: "9999999999",
        nonce: "0x" + "cd".repeat(32),
      },
    },
  } as unknown as PaymentPayload
}

/**
 * What the fake Ampersend API should answer for an authorize-receipt call.
 * `"network-error"` makes the call reject at the transport layer; `"hang"`
 * never resolves (drives the AbortController timeout).
 */
export type AuthorizeReceiptBehavior =
  | { kind: "allow"; screeningId?: string | null }
  | { kind: "deny"; reason: string; reasonCode: string; screeningId?: string | null }
  | { kind: "network-error" }
  | { kind: "hang" }
  | { kind: "unauthorized-then"; then: AuthorizeReceiptBehavior }

export interface FakeAmpersendApi {
  fetch: ReturnType<typeof vi.fn>
  /** Number of successful (non-401) authorize-receipt calls handled. */
  authorizeReceiptCalls: () => number
  /** Number of nonce GETs (proxy for how many SIWE logins ran). */
  authCount: () => number
}

/**
 * Build a `fetch` stub that emulates the Ampersend API's nonce + login +
 * authorize-receipt endpoints. The SIWE handshake always succeeds; the
 * authorize-receipt response is driven by `behavior`.
 *
 * `unauthorized-then` answers the first authorize-receipt with a 401 (forcing
 * a re-auth + retry), then falls through to the wrapped behavior on the retry.
 */
export function makeFakeAmpersendApi(behavior: AuthorizeReceiptBehavior): FakeAmpersendApi {
  let receiptCalls = 0
  let auths = 0
  let unauthorizedConsumed = false

  const json = (body: unknown, status = 200): Response =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })

  const respondAuthorize = (b: AuthorizeReceiptBehavior, signal?: AbortSignal): Promise<Response> => {
    switch (b.kind) {
      case "allow":
        return Promise.resolve(json({ authorized: true, screeningId: b.screeningId ?? "scr_1" }))
      case "deny":
        return Promise.resolve(
          json({
            authorized: false,
            reason: b.reason,
            reasonCode: b.reasonCode,
            screeningId: b.screeningId ?? "scr_2",
          }),
        )
      case "network-error":
        return Promise.reject(new TypeError("fetch failed: ECONNREFUSED"))
      case "hang":
        return new Promise<Response>((_resolve, reject) => {
          // Resolve only when the caller's AbortController fires.
          signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")))
        })
      case "unauthorized-then":
        return Promise.resolve(json({ error: "unauthorized" }, 401))
    }
  }

  const fetchStub = vi.fn(async (input: string | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input.toString()

    if (url.endsWith("/api/v1/agents/auth/nonce")) {
      auths += 1
      return json({ nonce: "0123456789abcdef", sessionId: "session-1" })
    }
    if (url.endsWith("/api/v1/agents/auth/login")) {
      const body = JSON.parse(init?.body as string) as { agentAddress: string }
      return json({
        token: `token-${auths}`,
        agentAddress: body.agentAddress,
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      })
    }
    if (url.includes("/payment/authorize-receipt")) {
      if (behavior.kind === "unauthorized-then" && !unauthorizedConsumed) {
        unauthorizedConsumed = true
        return respondAuthorize(behavior, init?.signal ?? undefined)
      }
      receiptCalls += 1
      const effective = behavior.kind === "unauthorized-then" ? behavior.then : behavior
      return respondAuthorize(effective, init?.signal ?? undefined)
    }
    throw new Error(`unexpected fetch to ${url}`)
  })

  return {
    fetch: fetchStub,
    authorizeReceiptCalls: () => receiptCalls,
    authCount: () => auths,
  }
}

/** Spy-able fake facilitator-backed executor for verify/settle delegation. */
export function makeFakeFacilitatorExecutor(opts?: {
  verify?: VerifyResponse
  settle?: SettleResponse
}): X402ServerExecutor & {
  verifyPayment: ReturnType<typeof vi.fn>
  settlePayment: ReturnType<typeof vi.fn>
} {
  const verify: VerifyResponse = opts?.verify ?? { isValid: true, payer: "0x1111111111111111111111111111111111111111" }
  const settle: SettleResponse = opts?.settle ?? {
    success: true,
    transaction: "0xdeadbeef",
    network: "base-sepolia",
  }
  return {
    verifyPayment: vi.fn(async () => verify),
    settlePayment: vi.fn(async () => settle),
  }
}
