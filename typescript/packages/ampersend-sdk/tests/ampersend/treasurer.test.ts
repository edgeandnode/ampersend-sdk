import type { ApiClient } from "@/ampersend/client.ts"
import { AmpersendTreasurer } from "@/ampersend/treasurer.ts"
import type { PaymentAuthorization, PaymentRequest } from "@/x402/envelopes.ts"
import type { X402Wallet } from "@/x402/index.ts"
import { describe, expect, it, vi } from "vitest"

const v1Request: PaymentRequest = {
  protocol: "x402-v1",
  data: {
    x402Version: 1,
    accepts: [
      {
        scheme: "exact",
        network: "base-sepolia",
        maxAmountRequired: "1000",
        resource: "https://api.example.com/r",
        description: "t",
        mimeType: "application/json",
        payTo: "0x1111111111111111111111111111111111111111",
        maxTimeoutSeconds: 300,
        asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
        extra: { name: "USDC", version: "2" },
      },
    ],
  },
}

const fakePayment: PaymentAuthorization = {
  protocol: "x402-v1",
  data: {
    x402Version: 1,
    scheme: "exact",
    network: "base-sepolia",
    payload: { signature: "0xsig", authorization: { from: "0x0", to: "0x0", value: "0" } },
  },
}

function makeApi(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    authorizePayment: vi.fn(),
    reportPaymentEvent: vi.fn().mockResolvedValue({ received: true }),
    ...overrides,
  } as unknown as ApiClient
}

function makeWallet(overrides: Partial<X402Wallet> = {}): X402Wallet {
  return {
    createPayment: vi.fn().mockResolvedValue(fakePayment),
    ...overrides,
  } as X402Wallet
}

describe("AmpersendTreasurer.onPaymentRequired", () => {
  it("returns null when the API declines all options", async () => {
    const api = makeApi({
      authorizePayment: vi.fn().mockResolvedValue({
        authorized: { selected: null, alternatives: [] },
        rejected: [{ acceptsIndex: 0, reason: "budget exhausted" }],
      }),
    })
    const treasurer = new AmpersendTreasurer(api, makeWallet())

    await expect(treasurer.onPaymentRequired(v1Request)).resolves.toBeNull()
  })

  it("propagates API errors — infra failure is not a decline", async () => {
    const api = makeApi({
      authorizePayment: vi.fn().mockRejectedValue(new Error("HTTP 500: upstream unavailable")),
    })
    const treasurer = new AmpersendTreasurer(api, makeWallet())

    await expect(treasurer.onPaymentRequired(v1Request)).rejects.toThrow(/HTTP 500/)
  })

  it("propagates wallet errors — signing failure is not a decline", async () => {
    const api = makeApi({
      authorizePayment: vi.fn().mockResolvedValue({
        authorized: {
          selected: { acceptsIndex: 0, limits: { dailyRemaining: "0", monthlyRemaining: "0" } },
          alternatives: [],
        },
        rejected: [],
      }),
    })
    const wallet = makeWallet({
      createPayment: vi.fn().mockRejectedValue(new Error("signing failed: invalid domain")),
    })
    const treasurer = new AmpersendTreasurer(api, wallet)

    await expect(treasurer.onPaymentRequired(v1Request)).rejects.toThrow(/signing failed/)
  })
})
