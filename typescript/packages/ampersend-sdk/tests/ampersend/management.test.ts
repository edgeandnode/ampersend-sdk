import { privateKeyToAccount } from "viem/accounts"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { AmpersendManagementClient } from "../../src/ampersend/management.ts"

// Deterministic test key (same as Python tests)
const TEST_PRIVATE_KEY = `0x${"ab".repeat(32)}` as const
const TEST_ACCOUNT = privateKeyToAccount(TEST_PRIVATE_KEY)
const TEST_ADDRESS = TEST_ACCOUNT.address

// This fixture is the REAL wire shape the API returns from `/v1/sdk/agents`:
// snake_case outer keys (`user_id`, `init_data`, `created_at`, `updated_at`),
// camelCase inner `init_data` keys, plus extra snake_case fields the API sends
// that the SDK schema ignores (`status`, `team_id`, `slug`, ...).
//
// IMPORTANT: a fixture that matches the SDK schema instead of the real wire
// format is exactly how the userId-vs-user_id decode bug survived undetected
// through releases 0.0.11-0.0.28. Keep these fixtures pinned to the wire.
const MOCK_AGENT_RESPONSE = {
  address: "0x1111111111111111111111111111111111111111",
  name: "test-agent",
  user_id: "user-123",
  team_id: "team-456",
  slug: "test-agent",
  status: "deployed",
  balance: "0",
  init_data: {
    address: "0x1111111111111111111111111111111111111111",
    factory: "0x2222222222222222222222222222222222222222",
    factoryData: "0xdeadbeef",
    intentExecutorInstalled: true,
  },
  nonce: "12345",
  published: false,
  created_at: 1700000000000,
  updated_at: 1700000000000,
}

// What the dual-emit API sends during the compatibility window: BOTH the
// canonical snake_case keys AND the legacy camelCase duplicates. Decoding must
// still succeed (the camelCase duplicates are simply ignored as excess keys).
const MOCK_AGENT_RESPONSE_DUAL_EMIT = {
  ...MOCK_AGENT_RESPONSE,
  userId: "user-123",
  initData: {
    address: "0x1111111111111111111111111111111111111111",
    factory: "0x2222222222222222222222222222222222222222",
    factoryData: "0xdeadbeef",
    intentExecutorInstalled: true,
  },
  createdAt: 1700000000000,
  updatedAt: 1700000000000,
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

describe("AmpersendManagementClient", () => {
  let fetchSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchSpy = vi.fn()
    vi.stubGlobal("fetch", fetchSpy)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("createAgent calls single endpoint with agent_key_address", async () => {
    fetchSpy.mockImplementation(async (url: string, init?: RequestInit) => {
      expect(init?.method).toBe("POST")
      expect(url).toContain("/api/v1/sdk/agents")
      expect(url).not.toContain("/prepare")
      const body = JSON.parse(init?.body as string)
      expect(body.agent_key_address).toBe(TEST_ADDRESS)
      expect(body.name).toBe("test-agent")
      expect(body.spend_config).toBeNull()
      expect(body.authorized_sellers).toBeNull()
      return jsonResponse(MOCK_AGENT_RESPONSE)
    })

    const client = new AmpersendManagementClient({ apiKey: "sk_test_123" })
    const result = await client.createAgent({
      name: "test-agent",
      privateKey: TEST_PRIVATE_KEY,
    })

    expect(result.address).toBe(MOCK_AGENT_RESPONSE.address)
    expect(result.name).toBe("test-agent")
    // The snake_case wire keys decode into the camelCase public surface.
    expect(result.userId).toBe("user-123")
    expect(result.createdAt).toBe(1700000000000)
    expect(result.updatedAt).toBe(1700000000000)
    expect(result.initData.factory).toBe("0x2222222222222222222222222222222222222222")
    expect(result.initData.intentExecutorInstalled).toBe(true)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it("createAgent decodes the dual-emit response (snake + camel duplicates)", async () => {
    fetchSpy.mockImplementation(async () => jsonResponse(MOCK_AGENT_RESPONSE_DUAL_EMIT))

    const client = new AmpersendManagementClient({ apiKey: "sk_test_123" })
    const result = await client.createAgent({ name: "test-agent", privateKey: TEST_PRIVATE_KEY })

    expect(result.userId).toBe("user-123")
    expect(result.initData.factory).toBe("0x2222222222222222222222222222222222222222")
    expect(result.createdAt).toBe(1700000000000)
    expect(result.updatedAt).toBe(1700000000000)
  })

  it("createAgent passes spend config and authorized sellers", async () => {
    let submittedPayload: Record<string, unknown> = {}

    fetchSpy.mockImplementation(async (_url: string, init?: RequestInit) => {
      submittedPayload = JSON.parse(init?.body as string)
      return jsonResponse(MOCK_AGENT_RESPONSE)
    })

    const client = new AmpersendManagementClient({ apiKey: "sk_test_123" })
    await client.createAgent({
      name: "test-agent",
      privateKey: TEST_PRIVATE_KEY,
      spendConfig: {
        dailyLimit: 1000000n,
        perTransactionLimit: 50000n,
      },
      authorizedSellers: ["0x3333333333333333333333333333333333333333"],
    })

    expect(submittedPayload.agent_key_address).toBe(TEST_ADDRESS)
    const sc = submittedPayload.spend_config as Record<string, unknown>
    expect(sc.daily_limit).toBe("1000000")
    expect(sc.per_transaction_limit).toBe("50000")
    expect(sc.monthly_limit).toBeNull()
    expect(sc.auto_topup_allowed).toBe(false)
    expect(submittedPayload.authorized_sellers).toEqual(["0x3333333333333333333333333333333333333333"])
  })

  it("listAgents returns a list of agent records", async () => {
    // API returns paginated response. Mix a plain wire item with a dual-emit
    // item so the list path is exercised against both shapes.
    const paginatedResponse = {
      items: [MOCK_AGENT_RESPONSE, { ...MOCK_AGENT_RESPONSE_DUAL_EMIT, name: "agent-2" }],
      total: 2,
      limit: 50,
      offset: 0,
    }

    fetchSpy.mockImplementation(async (url: string, init?: RequestInit) => {
      expect(init?.method).toBe("GET")
      expect(url).toContain("/api/v1/sdk/agents")
      const headers = init?.headers as Record<string, string>
      expect(headers.Authorization).toBe("Bearer sk_test_123")
      return jsonResponse(paginatedResponse)
    })

    const client = new AmpersendManagementClient({ apiKey: "sk_test_123" })
    const result = await client.listAgents()

    expect(result).toHaveLength(2)
    expect(result[0].name).toBe("test-agent")
    expect(result[0].userId).toBe("user-123")
    expect(result[1].name).toBe("agent-2")
    expect(result[1].userId).toBe("user-123")
  })

  it("throws ApiError on HTTP error response", async () => {
    fetchSpy.mockResolvedValue(new Response("Unauthorized", { status: 401, statusText: "Unauthorized" }))

    const client = new AmpersendManagementClient({ apiKey: "bad_key" })
    await expect(client.listAgents()).rejects.toThrow("HTTP 401 Unauthorized")
  })
})
