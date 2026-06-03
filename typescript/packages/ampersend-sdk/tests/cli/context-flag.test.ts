import type * as AmpersendModule from "@/ampersend/index.ts"
import { registerAgentCommand } from "@/cli/commands/agent.ts"
import { registerCardCommand } from "@/cli/commands/card.ts"
import { registerMarketplaceCommand } from "@/cli/commands/marketplace.ts"
import type * as ConfigModule from "@/cli/config.ts"
import { Command } from "commander"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Regression guard for the uniform `--context <name>` selector. These tests
 * drive the *real* Commander parse (not the execute functions directly),
 * because the bug they protect against was a parent/subcommand option
 * collision in Commander that swallowed `--context` — invisible to tests that
 * bypass argument parsing.
 *
 * We mock `loadCredentials` to capture the selector it receives and to return
 * a ready credential, and stub the read clients so nothing hits the network.
 */

const loadCredentials = vi.fn()

vi.mock("@/cli/config.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof ConfigModule>()
  return { ...actual, loadCredentials: (opts?: { context?: string }) => loadCredentials(opts) }
})

// Stub the clients so a "ready" credential doesn't trigger a real request.
vi.mock("@/ampersend/index.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof AmpersendModule>()
  class FakeAgentReadClient {
    getSelf = async () => ({})
    getOwner = async () => ({})
    getSpendConfig = async () => ({})
    getAutoCollectConfig = async () => ({})
    getAuthorizedSellers = async () => ({})
    getPayments = async () => ({})
    getActivity = async () => ({})
  }
  class FakeMarketplaceClient {
    listAgents = async () => []
    getAgent = async () => ({})
  }
  return { ...actual, AgentReadClient: FakeAgentReadClient, MarketplaceClient: FakeMarketplaceClient }
})

const READY = {
  ok: true as const,
  credentials: {
    agentAccount: "0x1111111111111111111111111111111111111111" as `0x${string}`,
    agentKey: "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef" as `0x${string}`,
  },
}

describe("--context selector reaches loadCredentials", () => {
  const mockExit = vi.spyOn(process, "exit").mockImplementation(() => undefined as never)
  const mockLog = vi.spyOn(console, "log").mockImplementation(() => {})
  // `card` subcommands reach the network after resolving credentials. We only
  // assert that loadCredentials saw the selector, so a rejecting fetch (swallowed
  // by the command's own error guard) is enough to keep the test off the wire.
  const mockFetch = vi.spyOn(globalThis, "fetch")

  beforeEach(() => {
    loadCredentials.mockReset().mockReturnValue(READY)
    mockExit.mockClear()
    mockLog.mockClear()
    mockFetch.mockReset().mockRejectedValue(new Error("network disabled in test"))
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  /** Build a fresh program with the commands registered and parse argv. */
  async function run(argv: Array<string>): Promise<void> {
    const program = new Command()
    program.exitOverride()
    registerAgentCommand(program)
    registerCardCommand(program)
    registerMarketplaceCommand(program)
    await program.parseAsync(argv, { from: "user" })
  }

  it("agent subcommand: --context after the subcommand reaches loadCredentials", async () => {
    await run(["agent", "owner", "--context", "sandbox"])
    expect(loadCredentials).toHaveBeenCalledWith(expect.objectContaining({ context: "sandbox" }))
  })

  it("agent subcommand: --context before the subcommand also reaches loadCredentials", async () => {
    await run(["agent", "--context", "sandbox", "owner"])
    expect(loadCredentials).toHaveBeenCalledWith(expect.objectContaining({ context: "sandbox" }))
  })

  it("bare `agent` (getSelf): --context reaches loadCredentials", async () => {
    await run(["agent", "--context", "sandbox"])
    expect(loadCredentials).toHaveBeenCalledWith(expect.objectContaining({ context: "sandbox" }))
  })

  it("agent payments: --context coexists with --preset", async () => {
    await run(["agent", "payments", "--preset", "30d", "--context", "sandbox"])
    expect(loadCredentials).toHaveBeenCalledWith(expect.objectContaining({ context: "sandbox" }))
  })

  it("marketplace list: --context reaches loadCredentials", async () => {
    await run(["marketplace", "list", "--context", "sandbox"])
    expect(loadCredentials).toHaveBeenCalledWith(expect.objectContaining({ context: "sandbox" }))
  })

  // `card` subcommands are leaf commands (no parent/subcommand option merge),
  // but they thread the selector through the most call sites, so guard each.
  it("card issue: --context reaches loadCredentials", async () => {
    await run(["card", "issue", "--amount", "10", "--context", "sandbox"])
    expect(loadCredentials).toHaveBeenCalledWith(expect.objectContaining({ context: "sandbox" }))
  })

  it("card list: --context reaches loadCredentials", async () => {
    await run(["card", "list", "--context", "sandbox"])
    expect(loadCredentials).toHaveBeenCalledWith(expect.objectContaining({ context: "sandbox" }))
  })

  it("card details: --context reaches loadCredentials", async () => {
    await run(["card", "details", "some-card-id", "--context", "sandbox"])
    expect(loadCredentials).toHaveBeenCalledWith(expect.objectContaining({ context: "sandbox" }))
  })

  it("no --context: loadCredentials sees an empty/undefined selector", async () => {
    await run(["agent", "owner"])
    const arg = loadCredentials.mock.calls[0]?.[0]
    expect(arg?.context).toBeUndefined()
  })
})
