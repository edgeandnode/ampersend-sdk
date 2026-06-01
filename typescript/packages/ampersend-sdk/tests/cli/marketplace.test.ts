import type * as ConfigModule from "@/cli/config.ts"
import { err } from "@/cli/envelope.ts"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * CLI marketplace command tests.
 *
 * `executeShow` reads an unauthenticated endpoint and must succeed with no
 * credentials configured — that's the regression this exercises. `executeList`
 * still requires an authenticated agent and exits when none is set up.
 *
 * Like the other CLI tests, the contract is the printed envelope + exit code,
 * so we stub `process.exit` and `console.log` and assert on what's emitted.
 * `loadCredentials` is mocked to report "no credentials" deterministically;
 * the rest of `@/cli/config.ts` (resolveApiUrl's deps) stays real.
 */

vi.mock("@/cli/config.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof ConfigModule>()
  return {
    ...actual,
    loadCredentials: vi.fn(() => ({
      ok: false as const,
      error: err("NOT_CONFIGURED", 'Run "ampersend setup start" or "ampersend config set" to configure'),
    })),
  }
})

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
  endpoints: [],
  skills: [],
}

const { executeList, executeShow } = await import("@/cli/commands/marketplace.ts")

const mockExit = vi.spyOn(process, "exit").mockImplementation(() => {
  throw new Error("process.exit called")
})
const mockLog = vi.spyOn(console, "log").mockImplementation(() => {})

function lastPrinted(): { ok: boolean; data?: unknown; error?: { code: string; message: string } } {
  const calls = mockLog.mock.calls
  return JSON.parse(calls[calls.length - 1]?.[0] as string)
}

describe("CLI marketplace", () => {
  let stubFetch: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockExit.mockClear()
    mockLog.mockClear()
    stubFetch = vi.fn()
    vi.stubGlobal("fetch", stubFetch)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  describe("show", () => {
    it("succeeds with no credentials configured", async () => {
      stubFetch.mockResolvedValue(
        new Response(JSON.stringify(WIRE_AGENT), { status: 200, headers: { "content-type": "application/json" } }),
      )

      await executeShow(WIRE_AGENT.id, { raw: false })

      expect(mockExit).not.toHaveBeenCalled()
      const printed = lastPrinted()
      expect(printed.ok).toBe(true)
      expect((printed.data as { id: string }).id).toBe(WIRE_AGENT.id)
    })

    it("maps a 404 to a NOT_FOUND envelope", async () => {
      stubFetch.mockResolvedValue(new Response("", { status: 404 }))

      await expect(executeShow("missing", { raw: false })).rejects.toThrow("process.exit called")

      expect(mockExit).toHaveBeenCalledWith(1)
      expect(lastPrinted().error?.code).toBe("NOT_FOUND")
    })
  })

  describe("list", () => {
    it("exits with NOT_CONFIGURED when no credentials are set up", async () => {
      await expect(executeList({ raw: false })).rejects.toThrow("process.exit called")

      expect(mockExit).toHaveBeenCalledWith(1)
      // Exited before any network call.
      expect(stubFetch).not.toHaveBeenCalled()
      expect(lastPrinted().error?.code).toBe("NOT_CONFIGURED")
    })
  })
})
