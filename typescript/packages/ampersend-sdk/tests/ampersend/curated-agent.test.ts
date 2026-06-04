import {
  AgentMarketplaceListQueryParams,
  CuratedAgentDTO,
  CuratedAgentEndpointX402PricingConfig,
} from "@/ampersend/curated-agent.ts"
import { Schema } from "effect"
import { describe, expect, it } from "vitest"

describe("CuratedAgentDTO", () => {
  const validAgent = {
    id: "d7d88120-4c02-4072-ba53-3a8297c4a46c",
    name: "BlackSwan",
    description: "Real-time risk engine for autonomous AI agents.",
    source: "catalog",
    enabled: true,
    category: "Crypto",
    tags: ["DeFi", "Crypto"],
    url: "https://blackswan.wtf",
    logo_url: null,
    docs_url: "https://blackswanwtf.gitbook.io/docs",
    ampersend_agent_address: null,
    created_at: 1778000431596,
    updated_at: 1778000431596,
    endpoints: [
      {
        id: "536e47d1-702c-4a7c-86ff-623b02214017",
        curated_agent_id: "d7d88120-4c02-4072-ba53-3a8297c4a46c",
        url: "https://x402.blackswan.wtf",
        methods: ["GET"],
        x402_enabled: true,
        x402_protocol_version: 1,
        network: "base",
        description: null,
        enabled: true,
        pricing_config: {
          amount: "1000",
          amountAtomicUnit: "100000",
          currency: "USDC",
          networkCaip2ID: "eip155:8453",
          assetAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
          payTo: "0x154b1006435e5cfe2206e7777c1003f9438119b1",
          x402Schema: "exact",
        },
        created_at: 1778000723022,
        updated_at: 1778000723022,
      },
    ],
    skills: [],
  }

  it("decodes a representative API response", () => {
    const result = Schema.decodeUnknownResult(CuratedAgentDTO)(validAgent)
    expect(result._tag).toBe("Success")
  })

  it("rejects an unknown source value", () => {
    const result = Schema.decodeUnknownResult(CuratedAgentDTO)({ ...validAgent, source: "unknown" })
    expect(result._tag).toBe("Failure")
  })

  it("rejects an invalid id (not a UUID)", () => {
    const result = Schema.decodeUnknownResult(CuratedAgentDTO)({ ...validAgent, id: "not-a-uuid" })
    expect(result._tag).toBe("Failure")
  })

  it("rejects an invalid asset address in pricing_config", () => {
    const bad = {
      ...validAgent,
      endpoints: [
        {
          ...validAgent.endpoints[0],
          pricing_config: { ...validAgent.endpoints[0]!.pricing_config, assetAddress: "not-an-address" },
        },
      ],
    }
    const result = Schema.decodeUnknownResult(CuratedAgentDTO)(bad)
    expect(result._tag).toBe("Failure")
  })
})

describe("CuratedAgentEndpointX402PricingConfig", () => {
  it("decodes amount/amountAtomicUnit from string", () => {
    const result = Schema.decodeUnknownResult(CuratedAgentEndpointX402PricingConfig)({
      amount: "1000",
      amountAtomicUnit: "100000",
      currency: "USDC",
      networkCaip2ID: "eip155:8453",
      assetAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      payTo: "0x154b1006435e5cfe2206e7777c1003f9438119b1",
      x402Schema: "exact",
    })
    expect(result._tag).toBe("Success")
    if (result._tag === "Success") {
      expect(result.success.amount).toBe(1000n)
      expect(result.success.amountAtomicUnit).toBe(100000n)
    }
  })
})

describe("AgentMarketplaceListQueryParams", () => {
  it("accepts all fields optional", () => {
    const result = Schema.decodeUnknownResult(AgentMarketplaceListQueryParams)({})
    expect(result._tag).toBe("Success")
  })

  it("accepts a known source", () => {
    const result = Schema.decodeUnknownResult(AgentMarketplaceListQueryParams)({ source: "catalog" })
    expect(result._tag).toBe("Success")
  })

  it("rejects an unknown source", () => {
    const result = Schema.decodeUnknownResult(AgentMarketplaceListQueryParams)({ source: "nope" })
    expect(result._tag).toBe("Failure")
  })
})
