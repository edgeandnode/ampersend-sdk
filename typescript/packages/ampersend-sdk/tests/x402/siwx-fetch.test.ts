import { wrapFetchWithAmpersendSiwx } from "@/x402/siwx.ts"
import { encodePaymentRequiredHeader } from "@x402/core/http"
import type { PaymentRequired } from "@x402/core/types"
import { SIGN_IN_WITH_X, type SIWxExtension } from "@x402/extensions/sign-in-with-x"
import { hashMessage, type Hex } from "viem"
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { signSiwxChallenge } = vi.hoisted(() => ({
  signSiwxChallenge: vi.fn<(message: string) => Promise<{ serverSignature: Hex }>>(),
}))

vi.mock("@/ampersend/client.ts", () => ({
  ApiClient: class {
    signSiwxChallenge = signSiwxChallenge
  },
}))

const smartAccountAddress = "0x1111111111111111111111111111111111111111" as const
const sessionKey = generatePrivateKey()
const serverAccount = privateKeyToAccount(generatePrivateKey())

const config = {
  smartAccountAddress,
  sessionKeyPrivateKey: sessionKey,
  apiUrl: "http://test.invalid",
}

const siwxInfo = {
  domain: "api.example.com",
  uri: "https://api.example.com/resource",
  version: "1",
  nonce: "abc123def456",
  issuedAt: "2026-05-18T00:00:00.000Z",
} satisfies SIWxExtension["info"]

const siwxExtension: SIWxExtension = {
  info: siwxInfo,
  supportedChains: [{ chainId: "eip155:8453", type: "eip191" }],
  schema: {} as SIWxExtension["schema"],
}

function buildPaymentRequired(overrides: Partial<PaymentRequired> = {}): PaymentRequired {
  return {
    x402Version: 2,
    resource: { url: "https://api.example.com/resource" },
    accepts: [
      {
        scheme: "exact",
        network: "eip155:8453",
        asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
        amount: "10000",
        payTo: "0x2222222222222222222222222222222222222222",
        maxTimeoutSeconds: 60,
        extra: {},
      },
    ],
    extensions: { [SIGN_IN_WITH_X]: siwxExtension },
    ...overrides,
  }
}

function build402(paymentRequired: PaymentRequired | null): Response {
  const headers = new Headers()
  if (paymentRequired) {
    headers.set("PAYMENT-REQUIRED", encodePaymentRequiredHeader(paymentRequired))
  }
  return new Response(null, { status: 402, headers })
}

beforeEach(() => {
  signSiwxChallenge.mockReset()
  // The server signs the same digest the agent does — any 65-byte hex would
  // satisfy the packer, but a real signature keeps the test honest end-to-end.
  signSiwxChallenge.mockImplementation(async (message: string) => ({
    serverSignature: await serverAccount.sign({ hash: hashMessage(message) }),
  }))
})

afterEach(() => {
  vi.clearAllMocks()
})

describe("wrapFetchWithAmpersendSiwx", () => {
  it("passes non-402 responses through unchanged", async () => {
    const ok = new Response("ok", { status: 200 })
    const stubFetch = vi.fn().mockResolvedValue(ok)

    const wrapped = wrapFetchWithAmpersendSiwx(stubFetch, config)
    const result = await wrapped("https://api.example.com/resource")

    expect(result).toBe(ok)
    expect(stubFetch).toHaveBeenCalledTimes(1)
    expect(signSiwxChallenge).not.toHaveBeenCalled()
  })

  it("passes 402 responses through when the PAYMENT-REQUIRED header is missing", async () => {
    const stubFetch = vi.fn().mockResolvedValue(build402(null))
    const wrapped = wrapFetchWithAmpersendSiwx(stubFetch, config)

    const result = await wrapped("https://api.example.com/resource")

    expect(result.status).toBe(402)
    expect(stubFetch).toHaveBeenCalledTimes(1)
    expect(signSiwxChallenge).not.toHaveBeenCalled()
  })

  it("passes 402 responses through when SIWX extension is absent", async () => {
    const stubFetch = vi.fn().mockResolvedValue(build402(buildPaymentRequired({ extensions: {} })))
    const wrapped = wrapFetchWithAmpersendSiwx(stubFetch, config)

    const result = await wrapped("https://api.example.com/resource")

    expect(result.status).toBe(402)
    expect(stubFetch).toHaveBeenCalledTimes(1)
    expect(signSiwxChallenge).not.toHaveBeenCalled()
  })

  it("attaches a SIWX header and retries on a SIWX-enabled 402", async () => {
    const ok = new Response("ok", { status: 200 })
    const stubFetch = vi.fn().mockResolvedValueOnce(build402(buildPaymentRequired())).mockResolvedValueOnce(ok)

    const wrapped = wrapFetchWithAmpersendSiwx(stubFetch, config)
    const result = await wrapped("https://api.example.com/resource")

    expect(result).toBe(ok)
    expect(stubFetch).toHaveBeenCalledTimes(2)
    expect(signSiwxChallenge).toHaveBeenCalledTimes(1)

    const retryRequest = stubFetch.mock.calls[1]![0] as Request
    expect(retryRequest.headers.get(SIGN_IN_WITH_X)).not.toBeNull()
  })

  it("throws when the incoming request already carries a SIWX header (loop guard)", async () => {
    const stubFetch = vi.fn().mockResolvedValue(build402(buildPaymentRequired()))
    const wrapped = wrapFetchWithAmpersendSiwx(stubFetch, config)

    await expect(
      wrapped(
        new Request("https://api.example.com/resource", {
          headers: { [SIGN_IN_WITH_X]: "previously-set-value" },
        }),
      ),
    ).rejects.toThrow(/SIWX authentication already attempted/)
    expect(signSiwxChallenge).not.toHaveBeenCalled()
  })

  it("handles auth-only routes (empty accepts) by picking the first supportedChain", async () => {
    const ok = new Response("ok", { status: 200 })
    const stubFetch = vi
      .fn()
      .mockResolvedValueOnce(build402(buildPaymentRequired({ accepts: [] })))
      .mockResolvedValueOnce(ok)

    const wrapped = wrapFetchWithAmpersendSiwx(stubFetch, config)
    const result = await wrapped("https://api.example.com/resource")

    expect(result).toBe(ok)
    expect(stubFetch).toHaveBeenCalledTimes(2)
    expect(signSiwxChallenge).toHaveBeenCalledTimes(1)
    const retryRequest = stubFetch.mock.calls[1]![0] as Request
    expect(retryRequest.headers.get(SIGN_IN_WITH_X)).not.toBeNull()
  })
})
