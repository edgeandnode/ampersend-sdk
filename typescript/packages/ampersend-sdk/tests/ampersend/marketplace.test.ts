import { ApiClient, ApiError } from "@/ampersend/client.ts"
import { MarketplaceClient } from "@/ampersend/marketplace.ts"
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * MarketplaceClient unit tests.
 *
 * The contract under test: `getAgent` reads an unauthenticated endpoint and
 * must work on a client built with no credentials, while `listAgents` goes
 * through the authenticated `getAuthorized` path and requires them. This is
 * the regression the marketplace-endpoint PR introduced — `show` started
 * demanding setup it never needed.
 */

const BASE_URL = "https://api.test.invalid"

// Wire-form curated agent (pricing amounts arrive as strings; the DTO decodes
// them to bigint). Mirrors the shape exercised in curated-agent.test.ts.
const WIRE_AGENT = {
  id: "6c3a1d4e-4852-4aef-bd89-d36611646e4b",
  name: "weather",
  description: "Current weather conditions.",
  source: "bazaar",
  enabled: true,
  category: "bazaar",
  tags: [],
  url: "https://example.test/weather",
  logo_url: null,
  docs_url: null,
  ampersend_agent_address: null,
  created_at: 1780341582675,
  updated_at: 1780341582675,
  endpoints: [
    {
      id: "0deb66e4-b211-4836-b580-553dc4da04f5",
      curated_agent_id: "6c3a1d4e-4852-4aef-bd89-d36611646e4b",
      url: "https://example.test/weather",
      methods: ["GET"],
      x402_enabled: true,
      x402_protocol_version: 2,
      network: "eip155:84532",
      description: null,
      enabled: true,
      pricing_config: {
        amount: "1000",
        amountAtomicUnit: "1000",
        currency: "USDC",
        networkCaip2ID: "eip155:84532",
        assetAddress: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
        payTo: "0xA27f7cB624B57C79d7F9de03ae9F5C705c2858dB",
        x402Schema: "exact",
      },
      created_at: 1780341582675,
      updated_at: 1780341582675,
    },
  ],
  skills: [],
}

function authHeaderFromCall(stubFetch: ReturnType<typeof vi.fn>, callIndex = 0): string | null {
  const init = stubFetch.mock.calls[callIndex]?.[1] as RequestInit | undefined
  return new Headers(init?.headers).get("Authorization")
}

function urlFromCall(stubFetch: ReturnType<typeof vi.fn>, callIndex = 0): string {
  return stubFetch.mock.calls[callIndex]?.[0] as string
}

describe("MarketplaceClient", () => {
  it("constructs with no credentials", () => {
    expect(() => new MarketplaceClient({ baseUrl: BASE_URL })).not.toThrow()
  })

  describe("getAgent (unauthenticated)", () => {
    let stubFetch: ReturnType<typeof vi.fn>

    beforeEach(() => {
      stubFetch = vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify(WIRE_AGENT), { status: 200, headers: { "content-type": "application/json" } }),
        )
      vi.stubGlobal("fetch", stubFetch)
    })

    afterEach(() => {
      vi.unstubAllGlobals()
      vi.clearAllMocks()
    })

    it("reads an agent without credentials and without an Authorization header", async () => {
      const client = new MarketplaceClient({ baseUrl: BASE_URL })

      const agent = await client.getAgent(WIRE_AGENT.id)

      expect(agent.id).toBe(WIRE_AGENT.id)
      // Decodes wire string -> bigint, proving it went through the real schema.
      expect(agent.endpoints[0]?.pricing_config.amount).toBe(1000n)

      // Exactly one request: no nonce/login round-trip.
      expect(stubFetch).toHaveBeenCalledTimes(1)
      expect(urlFromCall(stubFetch)).toBe(`${BASE_URL}/api/v1/agents/marketplace/${WIRE_AGENT.id}`)
      expect(authHeaderFromCall(stubFetch)).toBeNull()
    })

    it("url-encodes the id", async () => {
      const client = new MarketplaceClient({ baseUrl: BASE_URL })

      await client.getAgent("a b/c")

      expect(urlFromCall(stubFetch)).toBe(`${BASE_URL}/api/v1/agents/marketplace/a%20b%2Fc`)
    })
  })

  describe("listAgents (authenticated)", () => {
    let stubFetch: ReturnType<typeof vi.fn>

    beforeEach(() => {
      stubFetch = vi.fn().mockResolvedValue(new Response("nope", { status: 500 }))
      vi.stubGlobal("fetch", stubFetch)
    })

    afterEach(() => {
      vi.unstubAllGlobals()
      vi.clearAllMocks()
    })

    it("rejects with a clear error and issues no request when no credentials are configured", async () => {
      const client = new MarketplaceClient({ baseUrl: BASE_URL })

      await expect(client.listAgents()).rejects.toBeInstanceOf(ApiError)
      // The auth guard fires before any network call.
      expect(stubFetch).not.toHaveBeenCalled()
    })

    it("goes through the authenticated discover endpoint with the filters as query params", async () => {
      const sessionKey = generatePrivateKey()
      const agentAddress = privateKeyToAccount(sessionKey).address
      const api = new ApiClient({ baseUrl: BASE_URL, agentAddress, sessionKeyPrivateKey: sessionKey })
      const getAuthorized = vi.spyOn(api, "getAuthorized").mockResolvedValue([])

      const client = new MarketplaceClient(api)
      const result = await client.listAgents({ source: "catalog", search: "weather" })

      expect(result).toEqual([])
      expect(getAuthorized).toHaveBeenCalledTimes(1)
      expect(getAuthorized.mock.calls[0]?.[0]).toBe(
        "/api/v1/agents/marketplace/agentic/discover?source=catalog&search=weather",
      )
    })
  })
})
