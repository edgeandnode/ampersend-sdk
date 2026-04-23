import type { PaymentInstruction } from "@/x402/envelopes.ts"
import { chainIdOf } from "@/x402/wallets/smart-account/chain.ts"
import { describe, expect, it } from "vitest"

function v1Instruction(network: string): PaymentInstruction {
  return {
    protocol: "x402-v1",
    request: {
      x402Version: 1,
      accepts: [
        {
          scheme: "exact",
          network,
          maxAmountRequired: "1",
          resource: "https://x",
          description: "d",
          mimeType: "application/json",
          payTo: "0x0000000000000000000000000000000000000001",
          maxTimeoutSeconds: 300,
          asset: "0x0000000000000000000000000000000000000002",
          extra: {},
        },
      ],
    },
    acceptsIndex: 0,
  }
}

function v2Instruction(network: string): PaymentInstruction {
  return {
    protocol: "x402-v2",
    request: {
      x402Version: 2,
      resource: { url: "https://x" },
      accepts: [
        {
          scheme: "exact",
          network,
          amount: "1",
          asset: "0x0000000000000000000000000000000000000002",
          payTo: "0x0000000000000000000000000000000000000001",
          maxTimeoutSeconds: 300,
          extra: {},
        },
      ],
    },
    acceptsIndex: 0,
  }
}

describe("chainIdOf", () => {
  it("derives v1 chain id from the network name", () => {
    expect(chainIdOf(v1Instruction("base"))).toBe(8453)
    expect(chainIdOf(v1Instruction("base-sepolia"))).toBe(84532)
  })

  it("returns null for unknown v1 network names", () => {
    expect(chainIdOf(v1Instruction("not-a-real-chain"))).toBeNull()
  })

  it("derives v2 chain id from CAIP-2", () => {
    expect(chainIdOf(v2Instruction("eip155:8453"))).toBe(8453)
    expect(chainIdOf(v2Instruction("eip155:10"))).toBe(10)
    expect(chainIdOf(v2Instruction("eip155:42161"))).toBe(42161)
  })

  it("returns null for non-EVM v2 namespaces", () => {
    expect(chainIdOf(v2Instruction("solana:mainnet"))).toBeNull()
  })

  it("returns null for malformed v2 network strings", () => {
    expect(chainIdOf(v2Instruction("eip155:*"))).toBeNull()
    expect(chainIdOf(v2Instruction("eip155:"))).toBeNull()
  })
})
