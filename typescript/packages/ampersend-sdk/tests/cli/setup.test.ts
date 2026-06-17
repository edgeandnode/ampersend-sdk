import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { executeSetupFinish, executeSetupStart } from "@/cli/commands/setup.ts"
import {
  computeApprovalExpiry,
  CONFIG_FILE,
  readConfig,
  startContext,
  writeConfig,
  type Context,
} from "@/cli/config.ts"
import { generatePrivateKey, privateKeyToAddress } from "viem/accounts"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// Use a unique temp dir to avoid conflicts with other test files
const TEMP_DIR = join(process.env.TMPDIR ?? "/tmp", "ampersend-setup-test")

vi.mock("node:os", () => ({
  homedir: () => join(process.env.TMPDIR ?? "/tmp", "ampersend-setup-test"),
  tmpdir: () => join(process.env.TMPDIR ?? "/tmp", "ampersend-setup-test"),
}))

// Mock ApprovalClient
const mockRequestAgentApproval = vi.fn()
const mockGetApprovalStatus = vi.fn()

vi.mock("@/ampersend/approval.ts", () => ({
  ApprovalClient: class {
    requestAgentApproval = mockRequestAgentApproval
    getApprovalStatus = mockGetApprovalStatus
  },
}))

// Capture console.log output
let consoleOutput: Array<string> = []
const mockConsoleLog = vi.spyOn(console, "log").mockImplementation((...args: Array<unknown>) => {
  consoleOutput.push(args.map(String).join(" "))
})

// Mock process.exit
const mockExit = vi.spyOn(process, "exit").mockImplementation((code) => {
  throw new ExitError(code as number)
})

class ExitError extends Error {
  constructor(public code: number) {
    super(`process.exit(${code})`)
  }
}

function getLastOutput(): Record<string, unknown> {
  const last = consoleOutput[consoleOutput.length - 1]
  return JSON.parse(last) as Record<string, unknown>
}

/** Default options for executeSetupStart in tests. */
function startOpts(
  overrides: Partial<Parameters<typeof executeSetupStart>[0]> = {},
): Parameters<typeof executeSetupStart>[0] {
  return { mode: "create", force: false, autoTopup: false, ...overrides }
}

/** A pending context shorthand. */
function pendingContext(token: string, agentKey = generatePrivateKey(), expiresAt = computeApprovalExpiry()): Context {
  return { status: "pending", agentKey, token, expiresAt, createdAt: new Date().toISOString() }
}

/** A ready context shorthand. */
function readyContext(
  agentKey = generatePrivateKey(),
  agentAccount = "0x1111111111111111111111111111111111111111",
): Context {
  return { status: "ready", agentKey, agentAccount: agentAccount as `0x${string}`, createdAt: new Date().toISOString() }
}

describe("CLI Setup Commands", () => {
  const configDir = join(TEMP_DIR, ".ampersend")

  beforeEach(() => {
    if (existsSync(configDir)) {
      rmSync(configDir, { recursive: true })
    }
    consoleOutput = []
    mockRequestAgentApproval.mockReset()
    mockGetApprovalStatus.mockReset()
    mockExit.mockClear()
    mockConsoleLog.mockClear()
  })

  afterEach(() => {
    if (existsSync(configDir)) {
      rmSync(configDir, { recursive: true })
    }
    delete process.env.AMPERSEND_API_URL
  })

  describe("setup start", () => {
    it("should generate key, call API, and store a pending context", async () => {
      mockRequestAgentApproval.mockResolvedValue({
        token: "test-token-123",
        status_url: "https://api.ampersend.ai/api/v1/approve-action/test-token-123/status",
        user_approve_url: "https://app.ampersend.ai/approvals/create-agent/test-token-123",
      })

      await expect(executeSetupStart(startOpts({ name: "test-agent" }))).rejects.toThrow(ExitError)

      expect(mockExit).toHaveBeenCalledWith(0)

      const output = getLastOutput() as {
        ok: boolean
        data: {
          token: string
          user_approve_url: string
          agentKeyAddress: string
          verificationCode: string
          context: string
        }
      }
      expect(output.ok).toBe(true)
      expect(output.data.token).toBe("test-token-123")
      expect(output.data.user_approve_url).toBe("https://app.ampersend.ai/approvals/create-agent/test-token-123")
      expect(output.data.agentKeyAddress).toMatch(/^0x[a-fA-F0-9]{40}$/)
      expect(output.data.verificationCode).toMatch(/^\d{6}$/)
      // No --context: auto-named from the generated key (prod → bare ctx-<hex>).
      expect(output.data.context).toMatch(/^ctx-[a-f0-9]{4}$/)

      // Verify a pending context was stored under that name and made active
      const config = readConfig()
      expect(config?.activeContext).toBe(output.data.context)
      const ctx = config?.contexts[output.data.context]
      expect(ctx?.status).toBe("pending")
      if (ctx?.status === "pending") expect(ctx.token).toBe("test-token-123")
    })

    it("should name the context verbatim with --context", async () => {
      mockRequestAgentApproval.mockResolvedValue({ token: "tok", status_url: "x", user_approve_url: "y" })

      await expect(executeSetupStart(startOpts({ name: "test", context: "sandbox" }))).rejects.toThrow(ExitError)

      expect(mockExit).toHaveBeenCalledWith(0)
      expect(readConfig()?.contexts.sandbox?.status).toBe("pending")
    })

    it("should prepend the host for an auto-named context against a non-prod --api-url", async () => {
      mockRequestAgentApproval.mockResolvedValue({ token: "tok", status_url: "x", user_approve_url: "y" })

      await expect(
        executeSetupStart(startOpts({ name: "test", apiUrl: "https://api.sandbox.ampersend.ai" })),
      ).rejects.toThrow(ExitError)

      const output = getLastOutput() as { data: { context: string } }
      const name = output.data.context
      // Non-prod URL → host-prefixed auto-name, e.g. api.sandbox.ampersend.ai-ctx-1a2b.
      expect(name).toMatch(/^api\.sandbox\.ampersend\.ai-ctx-[a-f0-9]{4}$/)
      const config = readConfig()
      expect(config?.contexts[name]?.status).toBe("pending")
      expect(config?.contexts[name]?.apiUrl).toBe("https://api.sandbox.ampersend.ai")
      expect(config?.activeContext).toBe(name)
    })

    it("should target prod with --env prod (bare auto-name, no stored apiUrl)", async () => {
      mockRequestAgentApproval.mockResolvedValue({ token: "tok", status_url: "x", user_approve_url: "y" })

      await expect(executeSetupStart(startOpts({ name: "test", env: "prod" }))).rejects.toThrow(ExitError)

      const output = getLastOutput() as { ok: boolean; data: { context: string } }
      expect(output.ok).toBe(true)
      const name = output.data.context
      // Prod is the default URL → bare auto-name, and no apiUrl is persisted.
      expect(name).toMatch(/^ctx-[a-f0-9]{4}$/)
      expect(readConfig()?.contexts[name]?.apiUrl).toBeUndefined()
    })

    it("should target sandbox with --env sandbox (host-prefixed name + stored apiUrl)", async () => {
      mockRequestAgentApproval.mockResolvedValue({ token: "tok", status_url: "x", user_approve_url: "y" })

      await expect(executeSetupStart(startOpts({ name: "test", env: "sandbox" }))).rejects.toThrow(ExitError)

      const output = getLastOutput() as { data: { context: string } }
      const name = output.data.context
      expect(name).toMatch(/^api\.sandbox\.ampersend\.ai-ctx-[a-f0-9]{4}$/)
      expect(readConfig()?.contexts[name]?.apiUrl).toBe("https://api.sandbox.ampersend.ai")
    })

    it("should let --env win over AMPERSEND_API_URL (flag beats env, 12-factor)", async () => {
      process.env.AMPERSEND_API_URL = "https://api.sandbox.ampersend.ai"
      mockRequestAgentApproval.mockResolvedValue({ token: "tok", status_url: "x", user_approve_url: "y" })

      await expect(executeSetupStart(startOpts({ name: "test", env: "prod" }))).rejects.toThrow(ExitError)

      const output = getLastOutput() as { data: { context: string } }
      const name = output.data.context
      // --env prod resolves to the prod URL despite the sandbox env override.
      expect(name).toMatch(/^ctx-[a-f0-9]{4}$/)
      expect(readConfig()?.contexts[name]?.apiUrl).toBeUndefined()
    })

    it("should reject --env together with --api-url", async () => {
      await expect(
        executeSetupStart(startOpts({ name: "test", env: "prod", apiUrl: "https://api.sandbox.ampersend.ai" })),
      ).rejects.toThrow(ExitError)

      expect(mockExit).toHaveBeenCalledWith(1)
      const output = getLastOutput() as { ok: boolean; error: { code: string } }
      expect(output.ok).toBe(false)
      expect(output.error.code).toBe("INVALID_FLAGS")
      // No approval call should have been made.
      expect(mockRequestAgentApproval).not.toHaveBeenCalled()
    })

    it("should reject an unknown --env value", async () => {
      await expect(executeSetupStart(startOpts({ name: "test", env: "staging" }))).rejects.toThrow(ExitError)

      expect(mockExit).toHaveBeenCalledWith(1)
      const output = getLastOutput() as { ok: boolean; error: { code: string } }
      expect(output.ok).toBe(false)
      expect(output.error.code).toBe("INVALID_ENV")
      expect(mockRequestAgentApproval).not.toHaveBeenCalled()
    })

    it("should not activate a detached context", async () => {
      writeConfig({ activeContext: "default", contexts: { default: readyContext() } })
      mockRequestAgentApproval.mockResolvedValue({ token: "tok", status_url: "x", user_approve_url: "y" })

      await expect(executeSetupStart(startOpts({ name: "test", context: "probe", detach: true }))).rejects.toThrow(
        ExitError,
      )

      const config = readConfig()
      expect(config?.activeContext).toBe("default") // unchanged
      expect(config?.contexts.probe?.status).toBe("pending")
    })

    it("should refuse to clobber a ready context without --force", async () => {
      writeConfig({ activeContext: "default", contexts: { default: readyContext() } })

      await expect(executeSetupStart(startOpts({ name: "test", context: "default" }))).rejects.toThrow(ExitError)

      expect(mockExit).toHaveBeenCalledWith(1)
      const output = getLastOutput() as { ok: boolean; error: { code: string } }
      expect(output.error.code).toBe("CONTEXT_EXISTS")
      expect(mockRequestAgentApproval).not.toHaveBeenCalled()
    })

    it("should replace a ready context with --force", async () => {
      writeConfig({ activeContext: "default", contexts: { default: readyContext() } })
      mockRequestAgentApproval.mockResolvedValue({ token: "new-token", status_url: "x", user_approve_url: "y" })

      await expect(executeSetupStart(startOpts({ name: "test", context: "default", force: true }))).rejects.toThrow(
        ExitError,
      )

      expect(mockExit).toHaveBeenCalledWith(0)
      expect(readConfig()?.contexts.default?.status).toBe("pending")
    })

    it("should refuse a non-expired pending context of the same name without --force", async () => {
      startContext("default", {
        token: "existing-token",
        agentKey: generatePrivateKey(),
        expiresAt: computeApprovalExpiry(),
      })

      await expect(executeSetupStart(startOpts({ name: "test", context: "default" }))).rejects.toThrow(ExitError)

      expect(mockExit).toHaveBeenCalledWith(1)
      const output = getLastOutput() as { ok: boolean; error: { code: string } }
      expect(output.error.code).toBe("PENDING_EXISTS")
      expect(mockRequestAgentApproval).not.toHaveBeenCalled()
    })

    it("should overwrite an expired pending context without --force", async () => {
      // Seed the raw file with an already-expired pending context (writeConfig
      // would otherwise prune it). `setup start` should treat it as overwritable.
      mkdirSync(configDir, { recursive: true })
      writeFileSync(
        CONFIG_FILE,
        JSON.stringify({
          version: 2,
          activeContext: "default",
          contexts: {
            default: {
              status: "pending",
              agentKey: generatePrivateKey(),
              token: "expired-token",
              expiresAt: new Date(Date.now() - 1000).toISOString(),
            },
          },
        }),
      )

      mockRequestAgentApproval.mockResolvedValue({ token: "fresh-token", status_url: "x", user_approve_url: "y" })

      await expect(executeSetupStart(startOpts({ name: "test", context: "default" }))).rejects.toThrow(ExitError)

      expect(mockExit).toHaveBeenCalledWith(0)
      const ctx = readConfig()?.contexts.default
      if (ctx?.status === "pending") expect(ctx.token).toBe("fresh-token")
    })

    it("should handle API errors", async () => {
      mockRequestAgentApproval.mockRejectedValue(new Error("Network timeout"))

      await expect(executeSetupStart(startOpts({ name: "test" }))).rejects.toThrow(ExitError)

      expect(mockExit).toHaveBeenCalledWith(1)
      const output = getLastOutput() as { ok: boolean; error: { code: string; message: string } }
      expect(output.ok).toBe(false)
      expect(output.error.code).toBe("API_ERROR")
      expect(output.error.message).toContain("Network timeout")
    })

    it("should pass spend_config with all flags", async () => {
      mockRequestAgentApproval.mockResolvedValue({ token: "token", status_url: "x", user_approve_url: "y" })

      await expect(
        executeSetupStart(
          startOpts({
            name: "test",
            autoTopup: true,
            dailyLimit: "1000000",
            monthlyLimit: "30000000",
            perTransactionLimit: "500000",
          }),
        ),
      ).rejects.toThrow(ExitError)

      expect(mockRequestAgentApproval).toHaveBeenCalledWith(
        expect.objectContaining({
          spend_config: {
            auto_topup_allowed: true,
            daily_limit: "1000000",
            monthly_limit: "30000000",
            per_transaction_limit: "500000",
          },
        }),
      )
    })

    it("should pass spend_config with only daily_limit", async () => {
      mockRequestAgentApproval.mockResolvedValue({ token: "token", status_url: "x", user_approve_url: "y" })

      await expect(executeSetupStart(startOpts({ name: "test", dailyLimit: "1000000" }))).rejects.toThrow(ExitError)

      expect(mockRequestAgentApproval).toHaveBeenCalledWith(
        expect.objectContaining({
          spend_config: {
            auto_topup_allowed: false,
            daily_limit: "1000000",
            monthly_limit: null,
            per_transaction_limit: null,
          },
        }),
      )
    })

    it("should not send spend_config when no limit flags provided", async () => {
      mockRequestAgentApproval.mockResolvedValue({ token: "token", status_url: "x", user_approve_url: "y" })

      await expect(executeSetupStart(startOpts({ name: "test" }))).rejects.toThrow(ExitError)

      expect(mockRequestAgentApproval).toHaveBeenCalledWith(expect.objectContaining({ spend_config: undefined }))
    })

    it("should keep an existing context when creating a new one", async () => {
      const activeKey = generatePrivateKey()
      writeConfig({ activeContext: "prod", contexts: { prod: readyContext(activeKey) } })

      mockRequestAgentApproval.mockResolvedValue({ token: "token", status_url: "x", user_approve_url: "y" })

      await expect(executeSetupStart(startOpts({ name: "test", context: "sandbox" }))).rejects.toThrow(ExitError)

      const config = readConfig()
      expect(config?.contexts.prod?.agentKey).toBe(activeKey)
      expect(config?.contexts.sandbox?.status).toBe("pending")
    })

    it("should send mode 'connect' with --agent", async () => {
      mockRequestAgentApproval.mockResolvedValue({ token: "token", status_url: "x", user_approve_url: "y" })

      await expect(
        executeSetupStart(
          startOpts({ mode: "connect", agent: "0x1111111111111111111111111111111111111111", keyName: "my-key" }),
        ),
      ).rejects.toThrow(ExitError)

      expect(mockExit).toHaveBeenCalledWith(0)
      expect(mockRequestAgentApproval).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: "connect",
          agent_address: "0x1111111111111111111111111111111111111111",
          key_name: "my-key",
        }),
      )
    })

    it("should send mode 'connect_choose' without --agent", async () => {
      mockRequestAgentApproval.mockResolvedValue({ token: "token", status_url: "x", user_approve_url: "y" })

      await expect(executeSetupStart(startOpts({ mode: "connect", keyName: "my-key" }))).rejects.toThrow(ExitError)

      expect(mockExit).toHaveBeenCalledWith(0)
      expect(mockRequestAgentApproval).toHaveBeenCalledWith(
        expect.objectContaining({ mode: "connect_choose", key_name: "my-key" }),
      )
    })

    it("should pass --key-name in create mode", async () => {
      mockRequestAgentApproval.mockResolvedValue({ token: "token", status_url: "x", user_approve_url: "y" })

      await expect(executeSetupStart(startOpts({ name: "test", keyName: "my-key" }))).rejects.toThrow(ExitError)

      expect(mockExit).toHaveBeenCalledWith(0)
      expect(mockRequestAgentApproval).toHaveBeenCalledWith(
        expect.objectContaining({ mode: "create", key_name: "my-key" }),
      )
    })

    it("should reject --name in connect mode", async () => {
      await expect(executeSetupStart(startOpts({ name: "my-agent", mode: "connect" }))).rejects.toThrow(ExitError)

      expect(mockExit).toHaveBeenCalledWith(1)
      const output = getLastOutput() as { ok: boolean; error: { code: string } }
      expect(output.error.code).toBe("INVALID_FLAGS")
      expect(mockRequestAgentApproval).not.toHaveBeenCalled()
    })

    it("should reject spend config flags in connect mode", async () => {
      await expect(
        executeSetupStart(
          startOpts({ mode: "connect", agent: "0x1111111111111111111111111111111111111111", dailyLimit: "1000000" }),
        ),
      ).rejects.toThrow(ExitError)

      expect(mockExit).toHaveBeenCalledWith(1)
      const output = getLastOutput() as { ok: boolean; error: { code: string } }
      expect(output.error.code).toBe("INVALID_FLAGS")
      expect(mockRequestAgentApproval).not.toHaveBeenCalled()
    })

    it("should reject --agent in create mode", async () => {
      await expect(
        executeSetupStart(startOpts({ name: "test", agent: "0x1111111111111111111111111111111111111111" })),
      ).rejects.toThrow(ExitError)

      expect(mockExit).toHaveBeenCalledWith(1)
      const output = getLastOutput() as { ok: boolean; error: { code: string } }
      expect(output.error.code).toBe("INVALID_FLAGS")
      expect(mockRequestAgentApproval).not.toHaveBeenCalled()
    })

    it("should reject invalid --agent address", async () => {
      await expect(executeSetupStart(startOpts({ mode: "connect", agent: "not-an-address" }))).rejects.toThrow(
        ExitError,
      )

      expect(mockExit).toHaveBeenCalledWith(1)
      const output = getLastOutput() as { ok: boolean; error: { code: string } }
      expect(output.error.code).toBe("INVALID_ADDRESS")
      expect(mockRequestAgentApproval).not.toHaveBeenCalled()
    })

    it("should reject an invalid --api-url", async () => {
      await expect(executeSetupStart(startOpts({ name: "test", apiUrl: "not a url" }))).rejects.toThrow(ExitError)

      expect(mockExit).toHaveBeenCalledWith(1)
      const output = getLastOutput() as { ok: boolean; error: { code: string } }
      expect(output.error.code).toBe("INVALID_URL")
      expect(mockRequestAgentApproval).not.toHaveBeenCalled()
    })

    it("should reject --auto-topup alone in connect mode", async () => {
      await expect(
        executeSetupStart(
          startOpts({ mode: "connect", agent: "0x1111111111111111111111111111111111111111", autoTopup: true }),
        ),
      ).rejects.toThrow(ExitError)

      expect(mockExit).toHaveBeenCalledWith(1)
      const output = getLastOutput() as { ok: boolean; error: { code: string } }
      expect(output.error.code).toBe("INVALID_FLAGS")
      expect(mockRequestAgentApproval).not.toHaveBeenCalled()
    })
  })

  describe("setup finish", () => {
    it("should error when no pending context exists", async () => {
      await expect(executeSetupFinish({ pollInterval: 0.1, timeout: 1 })).rejects.toThrow(ExitError)

      expect(mockExit).toHaveBeenCalledWith(1)
      const output = getLastOutput() as { ok: boolean; error: { code: string } }
      expect(output.error.code).toBe("NO_PENDING")
    })

    it("should error when --context names a context that is already ready", async () => {
      writeConfig({ activeContext: "default", contexts: { default: readyContext() } })

      await expect(executeSetupFinish({ context: "default", pollInterval: 0.1, timeout: 1 })).rejects.toThrow(ExitError)

      expect(mockExit).toHaveBeenCalledWith(1)
      const output = getLastOutput() as { ok: boolean; error: { code: string } }
      expect(output.error.code).toBe("NOT_PENDING")
    })

    it("should error when --context names an unknown context", async () => {
      await expect(executeSetupFinish({ context: "nope", pollInterval: 0.1, timeout: 1 })).rejects.toThrow(ExitError)

      const output = getLastOutput() as { ok: boolean; error: { code: string } }
      expect(output.error.code).toBe("UNKNOWN_CONTEXT")
    })

    it("should promote the active pending context on resolved approval", async () => {
      const pendingKey = generatePrivateKey()
      const pendingKeyAddress = privateKeyToAddress(pendingKey)
      const agentAccount = "0x2222222222222222222222222222222222222222"

      startContext("default", { token: "test-token", agentKey: pendingKey, expiresAt: computeApprovalExpiry() })

      mockGetApprovalStatus.mockResolvedValue({
        status: "resolved",
        agent: { address: agentAccount },
        resolved_at: new Date().toISOString(),
      })

      await expect(executeSetupFinish({ pollInterval: 0.1, timeout: 5 })).rejects.toThrow(ExitError)

      expect(mockExit).toHaveBeenCalledWith(0)
      const output = getLastOutput() as {
        ok: boolean
        data: { agentKeyAddress: string; agentAccount: string; context: string; status: string }
      }
      expect(output.ok).toBe(true)
      expect(output.data.agentKeyAddress).toBe(pendingKeyAddress)
      expect(output.data.agentAccount).toBe(agentAccount)
      expect(output.data.context).toBe("default")
      expect(output.data.status).toBe("ready")

      const ctx = readConfig()?.contexts.default
      expect(ctx?.status).toBe("ready")
      expect(ctx?.agentKey).toBe(pendingKey)
      if (ctx?.status === "ready") expect(ctx.agentAccount).toBe(agentAccount)
    })

    it("should resolve and activate a named pending context with --context", async () => {
      const activeKey = generatePrivateKey()
      const pendingKey = generatePrivateKey()
      const agentAccount = "0x3333333333333333333333333333333333333333"

      writeConfig({
        activeContext: "prod",
        contexts: {
          prod: readyContext(activeKey),
          sandbox: pendingContext("sandbox-token", pendingKey),
        },
      })

      mockGetApprovalStatus.mockResolvedValue({
        status: "resolved",
        agent: { address: agentAccount },
        resolved_at: new Date().toISOString(),
      })

      await expect(executeSetupFinish({ context: "sandbox", pollInterval: 0.1, timeout: 5 })).rejects.toThrow(ExitError)

      expect(mockExit).toHaveBeenCalledWith(0)
      const config = readConfig()
      expect(config?.activeContext).toBe("sandbox")
      expect(config?.contexts.sandbox?.status).toBe("ready")
      expect(config?.contexts.prod?.agentKey).toBe(activeKey) // prod untouched
    })

    it("should clear the pending context and error on rejection", async () => {
      const pendingKey = generatePrivateKey()
      startContext("default", { token: "test-token", agentKey: pendingKey, expiresAt: computeApprovalExpiry() })

      mockGetApprovalStatus.mockResolvedValue({ status: "rejected", resolved_at: new Date().toISOString() })

      await expect(executeSetupFinish({ pollInterval: 0.1, timeout: 5 })).rejects.toThrow(ExitError)

      expect(mockExit).toHaveBeenCalledWith(1)
      const output = getLastOutput() as { ok: boolean; error: { code: string } }
      expect(output.error.code).toBe("APPROVAL_REJECTED")
      expect(readConfig()?.contexts.default).toBeUndefined()
    })

    it("should clear the pending context and error on blocked", async () => {
      startContext("default", {
        token: "test-token",
        agentKey: generatePrivateKey(),
        expiresAt: computeApprovalExpiry(),
      })

      mockGetApprovalStatus.mockResolvedValue({ status: "blocked", resolved_at: new Date().toISOString() })

      await expect(executeSetupFinish({ pollInterval: 0.1, timeout: 5 })).rejects.toThrow(ExitError)

      const output = getLastOutput() as { ok: boolean; error: { code: string } }
      expect(output.error.code).toBe("APPROVAL_REJECTED")
    })

    it("should error on agent_key_address mismatch", async () => {
      const pendingKey = generatePrivateKey()
      startContext("default", { token: "test-token", agentKey: pendingKey, expiresAt: computeApprovalExpiry() })

      mockGetApprovalStatus.mockResolvedValue({
        status: "resolved",
        agent: {
          address: "0x2222222222222222222222222222222222222222",
          agent_key_address: "0x9999999999999999999999999999999999999999",
        },
        resolved_at: new Date().toISOString(),
      })

      await expect(executeSetupFinish({ pollInterval: 0.1, timeout: 5 })).rejects.toThrow(ExitError)

      expect(mockExit).toHaveBeenCalledWith(1)
      const output = getLastOutput() as { ok: boolean; error: { code: string } }
      expect(output.error.code).toBe("KEY_MISMATCH")
    })

    it("should accept agent_key_address with different checksum case", async () => {
      const pendingKey = generatePrivateKey()
      const pendingKeyAddress = privateKeyToAddress(pendingKey)
      const agentAccount = "0x2222222222222222222222222222222222222222"

      startContext("default", { token: "test-token", agentKey: pendingKey, expiresAt: computeApprovalExpiry() })

      mockGetApprovalStatus.mockResolvedValue({
        status: "resolved",
        agent: { address: agentAccount, agent_key_address: pendingKeyAddress.toLowerCase() },
        resolved_at: new Date().toISOString(),
      })

      await expect(executeSetupFinish({ pollInterval: 0.1, timeout: 5 })).rejects.toThrow(ExitError)

      expect(mockExit).toHaveBeenCalledWith(0)
      const output = getLastOutput() as { ok: boolean; data: { status: string } }
      expect(output.ok).toBe(true)
      expect(output.data.status).toBe("ready")
    })

    it("should error when resolved without agent info", async () => {
      startContext("default", {
        token: "test-token",
        agentKey: generatePrivateKey(),
        expiresAt: computeApprovalExpiry(),
      })

      mockGetApprovalStatus.mockResolvedValue({ status: "resolved", resolved_at: new Date().toISOString() })

      await expect(executeSetupFinish({ pollInterval: 0.1, timeout: 5 })).rejects.toThrow(ExitError)

      expect(mockExit).toHaveBeenCalledWith(1)
      const output = getLastOutput() as { ok: boolean; error: { code: string } }
      expect(output.error.code).toBe("RESOLVE_NO_AGENT")

      // Pending should be preserved so user can retry
      expect(readConfig()?.contexts.default?.status).toBe("pending")
    })

    it("should timeout after waiting", async () => {
      startContext("default", {
        token: "test-token",
        agentKey: generatePrivateKey(),
        expiresAt: computeApprovalExpiry(),
      })

      mockGetApprovalStatus.mockResolvedValue({ status: "pending" })

      await expect(executeSetupFinish({ pollInterval: 0.05, timeout: 0.2 })).rejects.toThrow(ExitError)

      expect(mockExit).toHaveBeenCalledWith(1)
      const output = getLastOutput() as { ok: boolean; error: { code: string } }
      expect(output.error.code).toBe("TIMEOUT")

      // Pending should still exist (not cleared on timeout)
      expect(readConfig()?.contexts.default?.status).toBe("pending")
    })

    it("should handle API errors during polling", async () => {
      startContext("default", {
        token: "test-token",
        agentKey: generatePrivateKey(),
        expiresAt: computeApprovalExpiry(),
      })

      mockGetApprovalStatus.mockRejectedValue(new Error("API server error"))

      await expect(executeSetupFinish({ pollInterval: 0.1, timeout: 5 })).rejects.toThrow(ExitError)

      expect(mockExit).toHaveBeenCalledWith(1)
      const output = getLastOutput() as { ok: boolean; error: { code: string; message: string } }
      expect(output.error.code).toBe("API_ERROR")
      expect(output.error.message).toContain("API server error")

      // Pending should be preserved so user can retry
      expect(readConfig()?.contexts.default?.status).toBe("pending")
    })
  })
})
