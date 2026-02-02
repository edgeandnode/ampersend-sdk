import { privateKeyToAccount } from "viem/accounts"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { AmpersendManagementClient } from "../../src/ampersend/management.ts"

// Deterministic test key (same as Python tests)
const TEST_PRIVATE_KEY = `0x${"ab".repeat(32)}` as const
const TEST_ACCOUNT = privateKeyToAccount(TEST_PRIVATE_KEY)
const TEST_ADDRESS = TEST_ACCOUNT.address

const MOCK_PREPARE_RESPONSE = {
  agent_address: "0x1111111111111111111111111111111111111111",
  init_data: {
    address: "0xabc",
    factory: "0xdef",
    factoryData: "0x00",
    intentExecutorInstalled: false,
  },
  nonce: "12345",
  recovery_address: "0x2222222222222222222222222222222222222222",
  owners: ["0x2222222222222222222222222222222222222222", TEST_ADDRESS],
  unsigned_user_op: { sender: "0xabc", callGasLimit: "0x1000" },
  user_op_hash: `0x${"ff".repeat(32)}`,
  expires_at: 9999999999,
  server_signature: "deadbeef",
}

const MOCK_AGENT_RESPONSE = {
  address: "0x1111111111111111111111111111111111111111",
  name: "test-agent",
  user_id: "user-123",
  balance: "0",
  init_data: {},
  nonce: "12345",
  created_at: 1700000000000,
  updated_at: 1700000000000,
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

  it("createAgent calls prepare, signs, then submits", async () => {
    let callCount = 0
    fetchSpy.mockImplementation(async (url: string, init?: RequestInit) => {
      callCount++
      if (callCount === 1) {
        // prepare call
        expect(init?.method).toBe("GET")
        expect(url).toContain("/agents/prepare")
        expect(url).toContain(`agent_key_address=${TEST_ADDRESS}`)
        return jsonResponse(MOCK_PREPARE_RESPONSE)
      }
      // create call
      expect(init?.method).toBe("POST")
      expect(url).toContain("/api/v1/sdk/agents")
      const body = JSON.parse(init?.body as string)
      expect(body.name).toBe("test-agent")
      expect(body.signature).toMatch(/^0x/)
      expect(body.signature).toHaveLength(132) // 0x + 65 bytes hex
      expect(body.keys).toEqual([{ address: TEST_ADDRESS, permission_id: null }])
      expect(body.spend_config).toBeNull()
      expect(body.authorized_sellers).toBeNull()
      return jsonResponse(MOCK_AGENT_RESPONSE)
    })

    const client = new AmpersendManagementClient({ apiKey: "amp_test123" })
    const result = await client.createAgent({
      name: "test-agent",
      privateKey: TEST_PRIVATE_KEY,
    })

    expect(result.address).toBe(MOCK_AGENT_RESPONSE.address)
    expect(result.name).toBe("test-agent")
    expect(callCount).toBe(2)
  })

  it("createAgent passes spend config and authorized sellers", async () => {
    let submittedPayload: Record<string, unknown> = {}

    fetchSpy.mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method === "GET") {
        return jsonResponse(MOCK_PREPARE_RESPONSE)
      }
      submittedPayload = JSON.parse(init?.body as string)
      return jsonResponse(MOCK_AGENT_RESPONSE)
    })

    const client = new AmpersendManagementClient({ apiKey: "amp_test123" })
    await client.createAgent({
      name: "test-agent",
      privateKey: TEST_PRIVATE_KEY,
      spendConfig: {
        dailyLimit: 1000000,
        perTransactionLimit: 50000,
      },
      authorizedSellers: ["0x3333333333333333333333333333333333333333"],
    })

    const sc = submittedPayload.spend_config as Record<string, unknown>
    expect(sc.daily_limit).toBe("1000000")
    expect(sc.per_transaction_limit).toBe("50000")
    expect(sc.monthly_limit).toBeNull()
    expect(sc.auto_topup_allowed).toBe(false)
    expect(submittedPayload.authorized_sellers).toEqual(["0x3333333333333333333333333333333333333333"])
  })

  it("listAgents returns a list of agent records", async () => {
    const agentsData = [MOCK_AGENT_RESPONSE, { ...MOCK_AGENT_RESPONSE, name: "agent-2" }]

    fetchSpy.mockImplementation(async (url: string, init?: RequestInit) => {
      expect(init?.method).toBe("GET")
      expect(url).toContain("/api/v1/sdk/agents")
      const headers = init?.headers as Record<string, string>
      expect(headers.Authorization).toBe("Bearer amp_test123")
      return jsonResponse(agentsData)
    })

    const client = new AmpersendManagementClient({ apiKey: "amp_test123" })
    const result = await client.listAgents()

    expect(result).toHaveLength(2)
    expect(result[0].name).toBe("test-agent")
    expect(result[1].name).toBe("agent-2")
  })

  it("throws ApiError on HTTP error response", async () => {
    fetchSpy.mockResolvedValue(new Response("Unauthorized", { status: 401, statusText: "Unauthorized" }))

    const client = new AmpersendManagementClient({ apiKey: "bad_key" })
    await expect(client.listAgents()).rejects.toThrow("HTTP 401 Unauthorized")
  })
})
