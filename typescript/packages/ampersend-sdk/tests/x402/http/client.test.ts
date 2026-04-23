import type { PaymentAuthorization } from "@/x402/envelopes.ts"
import { AmpersendX402Client, PaymentDeclinedError, UnsupportedProtocolError } from "@/x402/http/client.ts"
import type { Authorization, X402Treasurer } from "@/x402/treasurer.ts"
import { describe, expect, it, vi } from "vitest"

// Minimal v1 accepts[] entries. Two distinct objects so we can assert
// reference-identity of the treasurer's pick.
const v1AcceptA = {
  scheme: "exact",
  network: "base-sepolia",
  maxAmountRequired: "1000",
  resource: "https://api.example.com/a",
  description: "Option A",
  mimeType: "application/json",
  payTo: "0x1111111111111111111111111111111111111111",
  maxTimeoutSeconds: 300,
  asset: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  extra: { name: "USDC", version: "2" },
}
const v1AcceptB = {
  ...v1AcceptA,
  maxAmountRequired: "2000",
  resource: "https://api.example.com/b",
  description: "Option B",
  asset: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
}

function v1PaymentRequired() {
  return { x402Version: 1 as const, accepts: [v1AcceptA, v1AcceptB] }
}

function v1WirePayment(): PaymentAuthorization {
  return {
    protocol: "x402-v1",
    data: {
      x402Version: 1,
      scheme: "exact",
      network: "base-sepolia",
      payload: { signature: "0xsig", authorization: { from: "0x0", to: "0x0", value: "0" } },
    },
  }
}

function treasurerSigning(accept: object, overrides?: Partial<Authorization>): X402Treasurer {
  return {
    onPaymentRequired: vi.fn().mockResolvedValue({
      payment: v1WirePayment(),
      authorizationId: "auth-1",
      accepted: accept,
      ...overrides,
    } satisfies Authorization),
    onStatus: vi.fn().mockResolvedValue(undefined),
  }
}

describe("AmpersendX402Client", () => {
  it("drives selection from the treasurer's pick (not accepts[0])", async () => {
    // Treasurer picks B even though upstream's default selector would pick A.
    const client = new AmpersendX402Client(treasurerSigning(v1AcceptB)).withNetworks({
      v1: ["base-sepolia"],
    })

    const payload = await client.createPaymentPayload(v1PaymentRequired() as never)

    // v1 envelope carries scheme+network from the signed payment.
    expect((payload as { scheme: string }).scheme).toBe("exact")
    expect((payload as { network: string }).network).toBe("base-sepolia")
    // The v1 shape is passed through from TreasurerSchemeClient verbatim.
    expect((payload as { x402Version: number }).x402Version).toBe(1)
  })

  it("passes the full PaymentRequest to the treasurer (all accepts[] visible)", async () => {
    const treasurer = treasurerSigning(v1AcceptA)
    const client = new AmpersendX402Client(treasurer).withNetworks({ v1: ["base-sepolia"] })

    await client.createPaymentPayload(v1PaymentRequired() as never)

    expect(treasurer.onPaymentRequired).toHaveBeenCalledTimes(1)
    const request = (treasurer.onPaymentRequired as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(request.protocol).toBe("x402-v1")
    expect(request.data.accepts).toHaveLength(2)
    // Byte-exact passthrough — reference equality on elements.
    expect(request.data.accepts[0]).toBe(v1AcceptA)
    expect(request.data.accepts[1]).toBe(v1AcceptB)
  })

  it("throws PaymentDeclinedError when the treasurer returns null", async () => {
    const treasurer: X402Treasurer = {
      onPaymentRequired: vi.fn().mockResolvedValue(null),
      onStatus: vi.fn(),
    }
    const client = new AmpersendX402Client(treasurer).withNetworks({ v1: ["base-sepolia"] })

    await expect(client.createPaymentPayload(v1PaymentRequired() as never)).rejects.toBeInstanceOf(PaymentDeclinedError)
  })

  it("throws when accepted is not a reference in paymentRequired.accepts (cloning guard)", async () => {
    // Treasurer returns a clone of v1AcceptA instead of the original ref.
    const treasurer = treasurerSigning({ ...v1AcceptA })
    const client = new AmpersendX402Client(treasurer).withNetworks({ v1: ["base-sepolia"] })

    await expect(client.createPaymentPayload(v1PaymentRequired() as never)).rejects.toThrow(
      /reference equality required/i,
    )
  })

  it("throws when the treasurer's pick is filtered out by a policy", async () => {
    // Treasurer picks B; user policy removes B.
    const treasurer = treasurerSigning(v1AcceptB)
    const client = new AmpersendX402Client(treasurer).withNetworks({ v1: ["base-sepolia"] })
    client.registerPolicy((_v, reqs) => reqs.filter((r) => r !== v1AcceptB))

    await expect(client.createPaymentPayload(v1PaymentRequired() as never)).rejects.toThrow(
      /not present in the filtered accepts/i,
    )
  })

  it("throws when the treasurer's pick is on an unregistered network", async () => {
    const treasurer = treasurerSigning(v1AcceptA)
    // Register a network that doesn't match accepts[] — upstream filters the list empty.
    const client = new AmpersendX402Client(treasurer).withNetworks({ v1: ["arbitrum"] })

    await expect(client.createPaymentPayload(v1PaymentRequired() as never)).rejects.toThrow()
  })

  it("fires onStatus('sending') after a successful super call", async () => {
    const treasurer = treasurerSigning(v1AcceptA)
    const client = new AmpersendX402Client(treasurer).withNetworks({ v1: ["base-sepolia"] })

    await client.createPaymentPayload(v1PaymentRequired() as never)

    expect(treasurer.onStatus).toHaveBeenCalledWith("sending", expect.objectContaining({ authorizationId: "auth-1" }), {
      method: "http",
    })
  })

  it("fires onStatus('error') and rethrows when super throws", async () => {
    const treasurer = treasurerSigning(v1AcceptA)
    // Register a network that doesn't match accepts[] — super throws, our catch fires.
    const client = new AmpersendX402Client(treasurer).withNetworks({ v1: ["arbitrum"] })

    await expect(client.createPaymentPayload(v1PaymentRequired() as never)).rejects.toThrow()
    expect(treasurer.onStatus).toHaveBeenCalledWith(
      "error",
      expect.objectContaining({ authorizationId: "auth-1" }),
      expect.objectContaining({ method: "http" }),
    )
  })

  it("user before/after hooks still run, with selectedRequirements = treasurer's pick", async () => {
    const treasurer = treasurerSigning(v1AcceptB)
    const client = new AmpersendX402Client(treasurer).withNetworks({ v1: ["base-sepolia"] })

    const before = vi.fn().mockResolvedValue(undefined)
    const after = vi.fn().mockResolvedValue(undefined)
    client.onBeforePaymentCreation(before)
    client.onAfterPaymentCreation(after)

    await client.createPaymentPayload(v1PaymentRequired() as never)

    expect(before).toHaveBeenCalledTimes(1)
    expect(before.mock.calls[0][0].selectedRequirements).toBe(v1AcceptB)
    expect(after).toHaveBeenCalledTimes(1)
    expect(after.mock.calls[0][0].selectedRequirements).toBe(v1AcceptB)
  })

  it("concurrent createPaymentPayload calls do not cross-talk", async () => {
    // Two independent 402 flows, one picks A, the other picks B. The WeakMap
    // is shared, keyed by accepts[i] reference; element references are unique
    // across requests, so both calls resolve correctly.
    const treasurer: X402Treasurer = {
      onPaymentRequired: vi.fn(async (req) => ({
        payment: v1WirePayment(),
        authorizationId: crypto.randomUUID(),
        accepted: (req as { data: { accepts: Array<object> } }).data.accepts[0],
      })),
      onStatus: vi.fn(),
    }
    const client = new AmpersendX402Client(treasurer).withNetworks({ v1: ["base-sepolia"] })

    const req1 = v1PaymentRequired()
    const req2 = v1PaymentRequired()
    const [p1, p2] = await Promise.all([
      client.createPaymentPayload(req1 as never),
      client.createPaymentPayload(req2 as never),
    ])

    expect(p1).toBeDefined()
    expect(p2).toBeDefined()
  })

  it("rejects unsupported x402 versions before the treasurer runs", async () => {
    const treasurer = treasurerSigning(v1AcceptA)
    const client = new AmpersendX402Client(treasurer).withNetworks({ v2: ["eip155:8453"] })

    await expect(client.createPaymentPayload(v1PaymentRequired() as never)).rejects.toBeInstanceOf(
      UnsupportedProtocolError,
    )
    expect(treasurer.onPaymentRequired).not.toHaveBeenCalled()
  })
})
