import { AgentReadClient } from "@/ampersend/agent-client.ts"
import { AgentActivityResponse, AgentSelfDTO, AgentSelfPaymentDTO } from "@/ampersend/agent.ts"
import type { ApiClient } from "@/ampersend/client.ts"
import { Schema } from "effect"
import { afterEach, describe, expect, it, vi } from "vitest"

/**
 * AgentReadClient unit tests.
 *
 * AgentReadClient is a thin wrapper that translates method calls into
 * `ApiClient.getAuthorized(path, schema)` invocations. These tests inject
 * a stub `ApiClient` and assert which path each method asks for — the
 * SIWE handshake itself is `ApiClient`'s responsibility and is not
 * re-exercised here.
 */

interface GetCall {
  path: string
}

/**
 * Build a stub `ApiClient` whose only job is to record the path it was
 * asked to GET. Return value is parameterisable per test for the few
 * cases that need to check decoded data flow-through.
 */
function makeApi(returnValue: unknown = {}): {
  api: ApiClient
  calls: Array<GetCall>
} {
  const calls: Array<GetCall> = []
  const api = {
    getAuthorized: vi.fn(async (path: string) => {
      calls.push({ path })
      return returnValue
    }),
  } as unknown as ApiClient
  return { api, calls }
}

describe("AgentReadClient", () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it("returns the value ApiClient produced, unchanged", async () => {
    const body = { address: "0xabc", name: "demo", balance: "1000" }
    const { api } = makeApi(body)

    const result = await new AgentReadClient(api).getSelf()

    expect(result).toBe(body)
  })

  it.each<{ name: string; path: string; call: (c: AgentReadClient) => Promise<unknown> }>([
    { name: "getSelf", path: "/api/v1/agents/self", call: (c) => c.getSelf() },
    { name: "getSpendConfig", path: "/api/v1/agents/self/spend-config", call: (c) => c.getSpendConfig() },
    {
      name: "getAutoCollectConfig",
      path: "/api/v1/agents/self/auto-collect-config",
      call: (c) => c.getAutoCollectConfig(),
    },
    {
      name: "getAuthorizedSellers",
      path: "/api/v1/agents/self/authorized-sellers",
      call: (c) => c.getAuthorizedSellers(),
    },
    { name: "getPayments (no args)", path: "/api/v1/agents/self/payments", call: (c) => c.getPayments() },
    { name: "getActivity (no args)", path: "/api/v1/agents/self/activity", call: (c) => c.getActivity() },
    { name: "getOwner", path: "/api/v1/agents/self/owner", call: (c) => c.getOwner() },
  ])("$name targets $path", async ({ call, path }) => {
    const { api, calls } = makeApi()

    await call(new AgentReadClient(api))

    expect(calls).toEqual([{ path }])
  })

  describe("getPayments query string", () => {
    it.each(["1d", "30d", "all"] as const)("encodes preset=%s", async (preset) => {
      const { api, calls } = makeApi()

      await new AgentReadClient(api).getPayments({ preset })

      expect(calls[0]?.path).toBe(`/api/v1/agents/self/payments?preset=${preset}`)
    })

    it("omits the query string when no preset is given", async () => {
      const { api, calls } = makeApi()

      await new AgentReadClient(api).getPayments({})

      expect(calls[0]?.path).toBe("/api/v1/agents/self/payments")
    })
  })

  describe("getActivity query string", () => {
    it("emits only the params the caller set", async () => {
      const { api, calls } = makeApi()

      await new AgentReadClient(api).getActivity({ limit: 5, page: 2 })

      const url = new URL(`https://x.test${calls[0]?.path}`)
      expect(url.pathname).toBe("/api/v1/agents/self/activity")
      expect(url.searchParams.get("limit")).toBe("5")
      expect(url.searchParams.get("page")).toBe("2")
      expect(url.searchParams.get("preset")).toBeNull()
    })

    it("includes preset alongside pagination when all three are set", async () => {
      const { api, calls } = makeApi()

      await new AgentReadClient(api).getActivity({ preset: "30d", limit: 10, page: 1 })

      const url = new URL(`https://x.test${calls[0]?.path}`)
      expect(url.searchParams.get("preset")).toBe("30d")
      expect(url.searchParams.get("limit")).toBe("10")
      expect(url.searchParams.get("page")).toBe("1")
    })

    it("omits the query string entirely when no params are set", async () => {
      const { api, calls } = makeApi()

      await new AgentReadClient(api).getActivity({})

      expect(calls[0]?.path).toBe("/api/v1/agents/self/activity")
    })

    it("does not emit limit=undefined or page=undefined", async () => {
      const { api, calls } = makeApi()

      await new AgentReadClient(api).getActivity({ preset: "1d" })

      const url = new URL(`https://x.test${calls[0]?.path}`)
      expect(url.searchParams.has("limit")).toBe(false)
      expect(url.searchParams.has("page")).toBe(false)
    })
  })

  it("propagates errors from ApiClient.getAuthorized", async () => {
    const api = {
      getAuthorized: vi.fn().mockRejectedValue(new Error("HTTP 403 Forbidden")),
    } as unknown as ApiClient

    await expect(new AgentReadClient(api).getSelf()).rejects.toThrow(/HTTP 403/)
  })

  // Drift sentinel: locks in the wire shape of `GET /v1/agents/self`. If the
  // server adds/renames/removes a field on AgentSelfDTO this test fails first
  // and a maintainer is forced to update the mirrored schema in agent.ts.
  it("decodes a server-shaped AgentSelfDTO response", () => {
    const wire = {
      address: "0x1234567890123456789012345678901234567890",
      name: "demo",
      slug: "demo",
      status: "deployed",
      published: false,
      registry_id: null,
      registry_uri: null,
      balance_usdc_micro: "1000000",
    }

    const decoded = Schema.decodeUnknownSync(AgentSelfDTO)(wire)

    expect(decoded.address).toBe(wire.address)
    expect(decoded.balance_usdc_micro).toBe(1000000n)
  })

  // Tolerant reader: enum-valued response fields are OpenEnum, so a value the
  // server adds later (e.g. a "topup" activity type) must decode instead of
  // failing the whole response for every deployed SDK.
  describe("forward compatibility with server-added enum values", () => {
    it("decodes an activity feed containing an unknown row type and status", () => {
      const row = {
        type: "topup",
        id: "row-1",
        agent_address: "0x1234567890123456789012345678901234567890",
        receiver: "0x1234567890123456789012345678901234567890",
        amount: 5,
        status: "refunded",
        timestamp: "1778000431596",
        tx_hash: null,
        chain_caip2id: null,
      }
      const wire = {
        activity: [row, { ...row, id: "row-2", type: "earn", status: "settled" }],
        hasNextPage: false,
        totalCount: 2,
      }

      const decoded = Schema.decodeUnknownSync(AgentActivityResponse)(wire)

      expect(decoded.activity[0]!.type).toBe("topup")
      expect(decoded.activity[0]!.status).toBe("refunded")
      expect(decoded.activity[1]!.type).toBe("earn")
    })

    it("decodes a payment row with an unknown status and scheme", () => {
      const payment = {
        seller_address: "0x1234567890123456789012345678901234567890",
        amount_usdc_micro: "1000",
        scheme: "permit",
        status: "refunding",
        tx_hash: null,
        chain_caip2id: null,
        created_at: 1778000431596,
        expires_at: null,
      }

      const decoded = Schema.decodeUnknownSync(AgentSelfPaymentDTO)(payment)
      expect(decoded.status).toBe("refunding")
      expect(decoded.scheme).toBe("permit")

      expect(() => Schema.decodeUnknownSync(AgentSelfPaymentDTO)({ ...payment, status: 42 })).toThrow()
    })
  })
})
