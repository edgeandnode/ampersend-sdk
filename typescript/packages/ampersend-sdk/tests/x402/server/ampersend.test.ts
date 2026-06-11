import { ApiClient } from "@/ampersend/client.ts"
import { AmpersendX402ServerExecutor, GENERIC_DENY_REASON } from "@/x402/server/ampersend.ts"
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  makeFakeAmpersendApi,
  makeFakeFacilitatorExecutor,
  samplePayment,
  sampleRequirements,
  type AuthorizeReceiptBehavior,
} from "./helpers.ts"

const sessionKey = generatePrivateKey()
const sellerAgentAddress = privateKeyToAccount(sessionKey).address

function buildExecutor(behavior: AuthorizeReceiptBehavior, facilitatorExecutor = makeFakeFacilitatorExecutor()) {
  const api = makeFakeAmpersendApi(behavior)
  vi.stubGlobal("fetch", api.fetch)
  const apiClient = new ApiClient({
    baseUrl: "https://api.test.invalid",
    agentAddress: sellerAgentAddress,
    sessionKeyPrivateKey: sessionKey,
  })
  const logger = { warn: vi.fn() }
  const executor = new AmpersendX402ServerExecutor({
    apiBaseUrl: "https://api.test.invalid",
    sellerAgentAddress,
    sellerSessionKeyPrivateKey: sessionKey,
    network: "base-sepolia",
    apiClient,
    facilitatorExecutor,
    logger,
  })
  return { executor, api, facilitatorExecutor, logger }
}

describe("AmpersendX402ServerExecutor.verifyPayment", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it("(a) compliance deny -> generic 'Payment rejected', no detail leaked to the buyer", async () => {
    const { executor, facilitatorExecutor, logger } = buildExecutor({
      kind: "deny",
      reason: "Sanctions exposure (High)",
      reasonCode: "compliance_high_risk",
      screeningId: "scr_secret",
    })

    const result = await executor.verifyPayment(samplePayment(), sampleRequirements)

    expect(result.isValid).toBe(false)
    expect(result.invalidReason).toBe(GENERIC_DENY_REASON)
    // The buyer-facing result must not carry reason/reasonCode/screeningId.
    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain("Sanctions")
    expect(serialized).not.toContain("compliance_high_risk")
    expect(serialized).not.toContain("scr_secret")
    // The facilitator is never consulted on a compliance deny.
    expect(facilitatorExecutor.verifyPayment).not.toHaveBeenCalled()
    // Full detail is logged server-side at WARNING.
    expect(logger.warn).toHaveBeenCalledWith(
      "Compliance denied payment",
      expect.objectContaining({
        reason: "Sanctions exposure (High)",
        reasonCode: "compliance_high_risk",
        screeningId: "scr_secret",
      }),
    )
  })

  it("(b) allow -> delegates to facilitator verify", async () => {
    const facilitatorExecutor = makeFakeFacilitatorExecutor({ verify: { isValid: true, payer: "0xpayer" } })
    const { executor } = buildExecutor({ kind: "allow" }, facilitatorExecutor)

    const result = await executor.verifyPayment(samplePayment(), sampleRequirements)

    expect(result.isValid).toBe(true)
    expect(facilitatorExecutor.verifyPayment).toHaveBeenCalledOnce()
  })

  it("(c) facilitator verify failure surfaces (after compliance allow)", async () => {
    const facilitatorExecutor = makeFakeFacilitatorExecutor({
      verify: { isValid: false, invalidReason: "invalid signature" },
    })
    const { executor } = buildExecutor({ kind: "allow" }, facilitatorExecutor)

    const result = await executor.verifyPayment(samplePayment(), sampleRequirements)

    expect(result.isValid).toBe(false)
    expect(result.invalidReason).toBe("invalid signature")
  })

  it("(d) Ampersend network error -> fail closed (generic deny), facilitator not consulted", async () => {
    const { executor, facilitatorExecutor, logger } = buildExecutor({ kind: "network-error" })

    const result = await executor.verifyPayment(samplePayment(), sampleRequirements)

    expect(result.isValid).toBe(false)
    expect(result.invalidReason).toBe(GENERIC_DENY_REASON)
    expect(facilitatorExecutor.verifyPayment).not.toHaveBeenCalled()
    expect(logger.warn).toHaveBeenCalledWith(
      "Compliance API call failed (transport/timeout/api-error)",
      expect.objectContaining({ payerAddress: expect.any(String) }),
    )
  })

  it("(d') Ampersend timeout -> fail closed (generic deny)", async () => {
    vi.stubEnv("AMPERSEND_COMPLIANCE_API_TIMEOUT_SECONDS", "0.05")
    const { executor, facilitatorExecutor } = buildExecutor({ kind: "hang" })

    const result = await executor.verifyPayment(samplePayment(), sampleRequirements)

    expect(result.isValid).toBe(false)
    expect(result.invalidReason).toBe(GENERIC_DENY_REASON)
    expect(facilitatorExecutor.verifyPayment).not.toHaveBeenCalled()
    vi.unstubAllEnvs()
  })

  it("(e) 401 -> re-auth + retry once -> then succeeds", async () => {
    const facilitatorExecutor = makeFakeFacilitatorExecutor()
    const { api, executor } = buildExecutor({ kind: "unauthorized-then", then: { kind: "allow" } }, facilitatorExecutor)

    const result = await executor.verifyPayment(samplePayment(), sampleRequirements)

    expect(result.isValid).toBe(true)
    // Two SIWE logins: the initial one and the forced re-auth after the 401.
    expect(api.authCount()).toBe(2)
    // Exactly one authorize-receipt counted as "handled" (the retry).
    expect(api.authorizeReceiptCalls()).toBe(1)
    expect(facilitatorExecutor.verifyPayment).toHaveBeenCalledOnce()
  })

  it("(f) non-exact scheme -> deny 'Unsupported payment scheme'", async () => {
    const { api, executor } = buildExecutor({ kind: "allow" })

    const result = await executor.verifyPayment(
      samplePayment("0x1111111111111111111111111111111111111111", "deferred"),
      sampleRequirements,
    )

    expect(result.isValid).toBe(false)
    expect(result.invalidReason).toBe("Unsupported payment scheme")
    // Never even reaches the Ampersend API.
    expect(api.authorizeReceiptCalls()).toBe(0)
  })

  it("settlePayment delegates straight to the facilitator", async () => {
    const facilitatorExecutor = makeFakeFacilitatorExecutor()
    const { executor } = buildExecutor({ kind: "allow" }, facilitatorExecutor)

    const settle = await executor.settlePayment(samplePayment(), sampleRequirements)

    expect(settle.success).toBe(true)
    expect(facilitatorExecutor.settlePayment).toHaveBeenCalledOnce()
  })
})
