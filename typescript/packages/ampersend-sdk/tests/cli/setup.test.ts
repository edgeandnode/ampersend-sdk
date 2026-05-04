import { existsSync, rmSync } from "node:fs"
import { join } from "node:path"

import { executeSetupFinish, executeSetupStart } from "@/cli/commands/setup.ts"
import { computeApprovalExpiry, readConfig, storePendingApproval, writeConfig } from "@/cli/config.ts"
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
    it("should generate key, call API, and store pending approval", async () => {
      mockRequestAgentApproval.mockResolvedValue({
        token: "test-token-123",
        status_url: "https://api.ampersend.ai/api/v1/approve-action/test-token-123/status",
        user_approve_url: "https://app.ampersend.ai/approvals/create-agent/test-token-123",
      })

      await expect(
        executeSetupStart({ name: "test-agent", mode: "create", force: false, autoTopup: false }),
      ).rejects.toThrow(ExitError)

      expect(mockExit).toHaveBeenCalledWith(0)

      const output = getLastOutput() as {
        ok: boolean
        data: { token: string; user_approve_url: string; agentKeyAddress: string; verificationCode: string }
      }
      expect(output.ok).toBe(true)
      expect(output.data.token).toBe("test-token-123")
      expect(output.data.user_approve_url).toBe("https://app.ampersend.ai/approvals/create-agent/test-token-123")
      expect(output.data.agentKeyAddress).toMatch(/^0x[a-fA-F0-9]{40}$/)
      expect(output.data.verificationCode).toMatch(/^\d{6}$/)

      // Verify pending was stored
      const config = readConfig()
      expect(config?.pendingApproval).toBeDefined()
      expect(config?.pendingApproval?.token).toBe("test-token-123")
    })

    it("should refuse if non-expired pending exists without --force", async () => {
      const pendingKey = generatePrivateKey()
      storePendingApproval({
        token: "existing-token",
        agentKey: pendingKey,
        expiresAt: computeApprovalExpiry(),
      })

      await expect(executeSetupStart({ name: "test", mode: "create", force: false, autoTopup: false })).rejects.toThrow(
        ExitError,
      )

      expect(mockExit).toHaveBeenCalledWith(1)
      const output = getLastOutput() as { ok: boolean; error: { code: string } }
      expect(output.ok).toBe(false)
      expect(output.error.code).toBe("PENDING_EXISTS")

      // API should not have been called
      expect(mockRequestAgentApproval).not.toHaveBeenCalled()
    })

    it("should overwrite pending with --force", async () => {
      const pendingKey = generatePrivateKey()
      storePendingApproval({
        token: "old-token",
        agentKey: pendingKey,
        expiresAt: computeApprovalExpiry(),
      })

      mockRequestAgentApproval.mockResolvedValue({
        token: "new-token",
        status_url: "https://api.ampersend.ai/status",
        user_approve_url: "https://app.ampersend.ai/approve",
      })

      await expect(executeSetupStart({ name: "test", mode: "create", force: true, autoTopup: false })).rejects.toThrow(
        ExitError,
      )

      expect(mockExit).toHaveBeenCalledWith(0)

      const config = readConfig()
      expect(config?.pendingApproval?.token).toBe("new-token")
    })

    it("should overwrite expired pending without --force", async () => {
      storePendingApproval({
        token: "expired-token",
        agentKey: generatePrivateKey(),
        expiresAt: new Date(Date.now() - 1000).toISOString(),
      })

      mockRequestAgentApproval.mockResolvedValue({
        token: "fresh-token",
        status_url: "https://api.ampersend.ai/status",
        user_approve_url: "https://app.ampersend.ai/approve",
      })

      await expect(executeSetupStart({ name: "test", mode: "create", force: false, autoTopup: false })).rejects.toThrow(
        ExitError,
      )

      expect(mockExit).toHaveBeenCalledWith(0)
      const config = readConfig()
      expect(config?.pendingApproval?.token).toBe("fresh-token")
    })

    it("should handle API errors", async () => {
      mockRequestAgentApproval.mockRejectedValue(new Error("Network timeout"))

      await expect(executeSetupStart({ name: "test", mode: "create", force: false, autoTopup: false })).rejects.toThrow(
        ExitError,
      )

      expect(mockExit).toHaveBeenCalledWith(1)
      const output = getLastOutput() as { ok: boolean; error: { code: string; message: string } }
      expect(output.ok).toBe(false)
      expect(output.error.code).toBe("API_ERROR")
      expect(output.error.message).toContain("Network timeout")
    })

    it("should pass spend_config with all flags", async () => {
      mockRequestAgentApproval.mockResolvedValue({
        token: "token",
        status_url: "https://api.ampersend.ai/status",
        user_approve_url: "https://app.ampersend.ai/approve",
      })

      await expect(
        executeSetupStart({
          name: "test",
          mode: "create",
          force: false,
          autoTopup: true,
          dailyLimit: "1000000",
          monthlyLimit: "30000000",
          perTransactionLimit: "500000",
        }),
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
      mockRequestAgentApproval.mockResolvedValue({
        token: "token",
        status_url: "https://api.ampersend.ai/status",
        user_approve_url: "https://app.ampersend.ai/approve",
      })

      await expect(
        executeSetupStart({
          name: "test",
          mode: "create",
          force: false,
          autoTopup: false,
          dailyLimit: "1000000",
        }),
      ).rejects.toThrow(ExitError)

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
      mockRequestAgentApproval.mockResolvedValue({
        token: "token",
        status_url: "https://api.ampersend.ai/status",
        user_approve_url: "https://app.ampersend.ai/approve",
      })

      await expect(executeSetupStart({ name: "test", mode: "create", force: false, autoTopup: false })).rejects.toThrow(
        ExitError,
      )

      expect(mockRequestAgentApproval).toHaveBeenCalledWith(
        expect.objectContaining({
          spend_config: undefined,
        }),
      )
    })

    it("should preserve active config when storing pending", async () => {
      const activeKey = generatePrivateKey()
      writeConfig({
        agentKey: activeKey,
        agentAccount: "0x1111111111111111111111111111111111111111",
      })

      mockRequestAgentApproval.mockResolvedValue({
        token: "token",
        status_url: "https://api.ampersend.ai/status",
        user_approve_url: "https://app.ampersend.ai/approve",
      })

      await expect(executeSetupStart({ name: "test", mode: "create", force: false, autoTopup: false })).rejects.toThrow(
        ExitError,
      )

      const config = readConfig()
      expect(config?.agentKey).toBe(activeKey)
      expect(config?.agentAccount).toBe("0x1111111111111111111111111111111111111111")
      expect(config?.pendingApproval?.token).toBe("token")
    })

    it("should send mode 'connect' with --agent", async () => {
      mockRequestAgentApproval.mockResolvedValue({
        token: "token",
        status_url: "https://api.ampersend.ai/status",
        user_approve_url: "https://app.ampersend.ai/approve",
      })

      await expect(
        executeSetupStart({
          mode: "connect",
          agent: "0x1111111111111111111111111111111111111111",
          keyName: "my-key",
          force: false,
          autoTopup: false,
        }),
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
      mockRequestAgentApproval.mockResolvedValue({
        token: "token",
        status_url: "https://api.ampersend.ai/status",
        user_approve_url: "https://app.ampersend.ai/approve",
      })

      await expect(
        executeSetupStart({
          mode: "connect",
          keyName: "my-key",
          force: false,
          autoTopup: false,
        }),
      ).rejects.toThrow(ExitError)

      expect(mockExit).toHaveBeenCalledWith(0)
      expect(mockRequestAgentApproval).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: "connect_choose",
          key_name: "my-key",
        }),
      )
    })

    it("should pass --key-name in create mode", async () => {
      mockRequestAgentApproval.mockResolvedValue({
        token: "token",
        status_url: "https://api.ampersend.ai/status",
        user_approve_url: "https://app.ampersend.ai/approve",
      })

      await expect(
        executeSetupStart({
          name: "test",
          mode: "create",
          keyName: "my-key",
          force: false,
          autoTopup: false,
        }),
      ).rejects.toThrow(ExitError)

      expect(mockExit).toHaveBeenCalledWith(0)
      expect(mockRequestAgentApproval).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: "create",
          key_name: "my-key",
        }),
      )
    })

    it("should reject --name in connect mode", async () => {
      await expect(
        executeSetupStart({
          name: "my-agent",
          mode: "connect",
          force: false,
          autoTopup: false,
        }),
      ).rejects.toThrow(ExitError)

      expect(mockExit).toHaveBeenCalledWith(1)
      const output = getLastOutput() as { ok: boolean; error: { code: string } }
      expect(output.ok).toBe(false)
      expect(output.error.code).toBe("INVALID_FLAGS")
      expect(mockRequestAgentApproval).not.toHaveBeenCalled()
    })

    it("should reject spend config flags in connect mode", async () => {
      await expect(
        executeSetupStart({
          mode: "connect",
          agent: "0x1111111111111111111111111111111111111111",
          dailyLimit: "1000000",
          force: false,
          autoTopup: false,
        }),
      ).rejects.toThrow(ExitError)

      expect(mockExit).toHaveBeenCalledWith(1)
      const output = getLastOutput() as { ok: boolean; error: { code: string } }
      expect(output.ok).toBe(false)
      expect(output.error.code).toBe("INVALID_FLAGS")
      expect(mockRequestAgentApproval).not.toHaveBeenCalled()
    })

    it("should reject --agent in create mode", async () => {
      await expect(
        executeSetupStart({
          name: "test",
          mode: "create",
          agent: "0x1111111111111111111111111111111111111111",
          force: false,
          autoTopup: false,
        }),
      ).rejects.toThrow(ExitError)

      expect(mockExit).toHaveBeenCalledWith(1)
      const output = getLastOutput() as { ok: boolean; error: { code: string } }
      expect(output.ok).toBe(false)
      expect(output.error.code).toBe("INVALID_FLAGS")
      expect(mockRequestAgentApproval).not.toHaveBeenCalled()
    })

    it("should reject invalid --agent address", async () => {
      await expect(
        executeSetupStart({
          mode: "connect",
          agent: "not-an-address",
          force: false,
          autoTopup: false,
        }),
      ).rejects.toThrow(ExitError)

      expect(mockExit).toHaveBeenCalledWith(1)
      const output = getLastOutput() as { ok: boolean; error: { code: string } }
      expect(output.ok).toBe(false)
      expect(output.error.code).toBe("INVALID_ADDRESS")
      expect(mockRequestAgentApproval).not.toHaveBeenCalled()
    })

    it("should reject --auto-topup alone in connect mode", async () => {
      await expect(
        executeSetupStart({
          mode: "connect",
          agent: "0x1111111111111111111111111111111111111111",
          force: false,
          autoTopup: true,
        }),
      ).rejects.toThrow(ExitError)

      expect(mockExit).toHaveBeenCalledWith(1)
      const output = getLastOutput() as { ok: boolean; error: { code: string } }
      expect(output.ok).toBe(false)
      expect(output.error.code).toBe("INVALID_FLAGS")
      expect(mockRequestAgentApproval).not.toHaveBeenCalled()
    })
  })

  describe("setup finish", () => {
    it("should error when no pending approval exists", async () => {
      await expect(executeSetupFinish({ force: false, pollInterval: 0.1, timeout: 1 })).rejects.toThrow(ExitError)

      expect(mockExit).toHaveBeenCalledWith(1)
      const output = getLastOutput() as { ok: boolean; error: { code: string } }
      expect(output.error.code).toBe("NO_PENDING")
    })

    it("should error when already configured without --force", async () => {
      const activeKey = generatePrivateKey()
      const pendingKey = generatePrivateKey()
      writeConfig({
        agentKey: activeKey,
        agentAccount: "0x1111111111111111111111111111111111111111",
        pendingApproval: {
          token: "test-token",
          agentKey: pendingKey,
          expiresAt: computeApprovalExpiry(),
        },
      })

      await expect(executeSetupFinish({ force: false, pollInterval: 0.1, timeout: 1 })).rejects.toThrow(ExitError)

      expect(mockExit).toHaveBeenCalledWith(1)
      const output = getLastOutput() as { ok: boolean; error: { code: string } }
      expect(output.error.code).toBe("ALREADY_CONFIGURED")
    })

    it("should promote pending on resolved approval", async () => {
      const pendingKey = generatePrivateKey()
      const pendingKeyAddress = privateKeyToAddress(pendingKey)
      const agentAccount = "0x2222222222222222222222222222222222222222"

      writeConfig({
        pendingApproval: {
          token: "test-token",
          agentKey: pendingKey,
          expiresAt: computeApprovalExpiry(),
        },
      })

      mockGetApprovalStatus.mockResolvedValue({
        status: "resolved",
        agent: { address: agentAccount },
        resolved_at: new Date().toISOString(),
      })

      await expect(executeSetupFinish({ force: false, pollInterval: 0.1, timeout: 5 })).rejects.toThrow(ExitError)

      expect(mockExit).toHaveBeenCalledWith(0)

      const output = getLastOutput() as {
        ok: boolean
        data: { agentKeyAddress: string; agentAccount: string; status: string }
      }
      expect(output.ok).toBe(true)
      expect(output.data.agentKeyAddress).toBe(pendingKeyAddress)
      expect(output.data.agentAccount).toBe(agentAccount)
      expect(output.data.status).toBe("ready")

      // Verify config was promoted
      const config = readConfig()
      expect(config?.agentKey).toBe(pendingKey)
      expect(config?.agentAccount).toBe(agentAccount)
      expect(config?.pendingApproval).toBeUndefined()
    })

    it("should clear pending and error on rejection", async () => {
      const pendingKey = generatePrivateKey()
      writeConfig({
        pendingApproval: {
          token: "test-token",
          agentKey: pendingKey,
          expiresAt: computeApprovalExpiry(),
        },
      })

      mockGetApprovalStatus.mockResolvedValue({
        status: "rejected",
        resolved_at: new Date().toISOString(),
      })

      await expect(executeSetupFinish({ force: false, pollInterval: 0.1, timeout: 5 })).rejects.toThrow(ExitError)

      expect(mockExit).toHaveBeenCalledWith(1)
      const output = getLastOutput() as { ok: boolean; error: { code: string } }
      expect(output.error.code).toBe("APPROVAL_REJECTED")

      // Pending should be cleared
      const config = readConfig()
      expect(config?.pendingApproval).toBeUndefined()
    })

    it("should clear pending and error on blocked", async () => {
      writeConfig({
        pendingApproval: {
          token: "test-token",
          agentKey: generatePrivateKey(),
          expiresAt: computeApprovalExpiry(),
        },
      })

      mockGetApprovalStatus.mockResolvedValue({
        status: "blocked",
        resolved_at: new Date().toISOString(),
      })

      await expect(executeSetupFinish({ force: false, pollInterval: 0.1, timeout: 5 })).rejects.toThrow(ExitError)

      const output = getLastOutput() as { ok: boolean; error: { code: string } }
      expect(output.error.code).toBe("APPROVAL_REJECTED")
    })

    it("should error on agent_key_address mismatch", async () => {
      const pendingKey = generatePrivateKey()
      writeConfig({
        pendingApproval: {
          token: "test-token",
          agentKey: pendingKey,
          expiresAt: computeApprovalExpiry(),
        },
      })

      mockGetApprovalStatus.mockResolvedValue({
        status: "resolved",
        agent: {
          address: "0x2222222222222222222222222222222222222222",
          agent_key_address: "0x9999999999999999999999999999999999999999",
        },
        resolved_at: new Date().toISOString(),
      })

      await expect(executeSetupFinish({ force: false, pollInterval: 0.1, timeout: 5 })).rejects.toThrow(ExitError)

      expect(mockExit).toHaveBeenCalledWith(1)
      const output = getLastOutput() as { ok: boolean; error: { code: string } }
      expect(output.error.code).toBe("KEY_MISMATCH")
    })

    it("should accept agent_key_address with different checksum case", async () => {
      const pendingKey = generatePrivateKey()
      const pendingKeyAddress = privateKeyToAddress(pendingKey)
      const agentAccount = "0x2222222222222222222222222222222222222222"

      writeConfig({
        pendingApproval: {
          token: "test-token",
          agentKey: pendingKey,
          expiresAt: computeApprovalExpiry(),
        },
      })

      // API returns lowercase version of the same address
      mockGetApprovalStatus.mockResolvedValue({
        status: "resolved",
        agent: {
          address: agentAccount,
          agent_key_address: pendingKeyAddress.toLowerCase(),
        },
        resolved_at: new Date().toISOString(),
      })

      await expect(executeSetupFinish({ force: false, pollInterval: 0.1, timeout: 5 })).rejects.toThrow(ExitError)

      expect(mockExit).toHaveBeenCalledWith(0)
      const output = getLastOutput() as { ok: boolean; data: { status: string } }
      expect(output.ok).toBe(true)
      expect(output.data.status).toBe("ready")
    })

    it("should error when resolved without agent info", async () => {
      writeConfig({
        pendingApproval: {
          token: "test-token",
          agentKey: generatePrivateKey(),
          expiresAt: computeApprovalExpiry(),
        },
      })

      mockGetApprovalStatus.mockResolvedValue({
        status: "resolved",
        resolved_at: new Date().toISOString(),
      })

      await expect(executeSetupFinish({ force: false, pollInterval: 0.1, timeout: 5 })).rejects.toThrow(ExitError)

      expect(mockExit).toHaveBeenCalledWith(1)
      const output = getLastOutput() as { ok: boolean; error: { code: string } }
      expect(output.error.code).toBe("RESOLVE_NO_AGENT")

      // Pending should be preserved so user can retry
      const config = readConfig()
      expect(config?.pendingApproval).toBeDefined()
    })

    it("should timeout after waiting", async () => {
      writeConfig({
        pendingApproval: {
          token: "test-token",
          agentKey: generatePrivateKey(),
          expiresAt: computeApprovalExpiry(),
        },
      })

      mockGetApprovalStatus.mockResolvedValue({ status: "pending" })

      await expect(executeSetupFinish({ force: false, pollInterval: 0.05, timeout: 0.2 })).rejects.toThrow(ExitError)

      expect(mockExit).toHaveBeenCalledWith(1)
      const output = getLastOutput() as { ok: boolean; error: { code: string } }
      expect(output.error.code).toBe("TIMEOUT")

      // Pending should still exist (not cleared on timeout)
      const config = readConfig()
      expect(config?.pendingApproval).toBeDefined()
    })

    it("should handle API errors during polling", async () => {
      writeConfig({
        pendingApproval: {
          token: "test-token",
          agentKey: generatePrivateKey(),
          expiresAt: computeApprovalExpiry(),
        },
      })

      mockGetApprovalStatus.mockRejectedValue(new Error("API server error"))

      await expect(executeSetupFinish({ force: false, pollInterval: 0.1, timeout: 5 })).rejects.toThrow(ExitError)

      expect(mockExit).toHaveBeenCalledWith(1)
      const output = getLastOutput() as { ok: boolean; error: { code: string; message: string } }
      expect(output.error.code).toBe("API_ERROR")
      expect(output.error.message).toContain("API server error")

      // Pending should be preserved so user can retry
      const config = readConfig()
      expect(config?.pendingApproval).toBeDefined()
    })

    it("should proceed with --force when already configured", async () => {
      const activeKey = generatePrivateKey()
      const pendingKey = generatePrivateKey()
      const agentAccount = "0x3333333333333333333333333333333333333333"

      writeConfig({
        agentKey: activeKey,
        agentAccount: "0x1111111111111111111111111111111111111111",
        pendingApproval: {
          token: "test-token",
          agentKey: pendingKey,
          expiresAt: computeApprovalExpiry(),
        },
      })

      mockGetApprovalStatus.mockResolvedValue({
        status: "resolved",
        agent: { address: agentAccount },
        resolved_at: new Date().toISOString(),
      })

      await expect(executeSetupFinish({ force: true, pollInterval: 0.1, timeout: 5 })).rejects.toThrow(ExitError)

      expect(mockExit).toHaveBeenCalledWith(0)

      // Config should have been overwritten with pending key
      const config = readConfig()
      expect(config?.agentKey).toBe(pendingKey)
      expect(config?.agentAccount).toBe(agentAccount)
    })
  })
})
