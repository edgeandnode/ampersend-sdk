import { existsSync, rmSync } from "node:fs"
import { join } from "node:path"

import {
  clearPendingApproval,
  computeApprovalExpiry,
  getStatus,
  isPendingExpired,
  promotePending,
  readConfig,
  setConfig,
  storePendingApproval,
  writeConfig,
} from "@/cli/config.ts"
import { generatePrivateKey, privateKeyToAddress } from "viem/accounts"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// Use a unique temp dir to avoid conflicts with other test files
const TEMP_DIR = join(process.env.TMPDIR ?? "/tmp", "ampersend-config-test")

vi.mock("node:os", () => ({
  homedir: () => join(process.env.TMPDIR ?? "/tmp", "ampersend-config-test"),
  tmpdir: () => join(process.env.TMPDIR ?? "/tmp", "ampersend-config-test"),
}))

describe("CLI Config", () => {
  const configDir = join(TEMP_DIR, ".ampersend")

  beforeEach(() => {
    if (existsSync(configDir)) {
      rmSync(configDir, { recursive: true })
    }
  })

  afterEach(() => {
    if (existsSync(configDir)) {
      rmSync(configDir, { recursive: true })
    }
    delete process.env.AMPERSEND_AGENT_SECRET
    delete process.env.AMPERSEND_AGENT_ACCOUNT
    delete process.env.AMPERSEND_AGENT_KEY
    delete process.env.AMPERSEND_API_URL
  })

  describe("setConfig", () => {
    it("should accept valid key:::account format", () => {
      const agentKey = generatePrivateKey()
      const agentAccount = "0x1234567890123456789012345678901234567890"
      const result = setConfig(`${agentKey}:::${agentAccount}`)

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.status).toBe("ready")
        expect(result.data.agentAccount).toBe(agentAccount)
        expect(result.data.agentKeyAddress).toMatch(/^0x[a-fA-F0-9]{40}$/)
      }
    })

    it("should store config with version field", () => {
      const agentKey = generatePrivateKey()
      setConfig(`${agentKey}:::0x1234567890123456789012345678901234567890`)

      const config = readConfig()
      expect(config).not.toBeNull()
      expect(config?.version).toBe(1)
      expect(config?.agentKey).toBe(agentKey)
      expect(config?.agentAccount).toBe("0x1234567890123456789012345678901234567890")
    })

    it("should reject invalid format (missing separator)", () => {
      const result = setConfig("0x1234567890123456789012345678901234567890")
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.code).toBe("INVALID_FORMAT")
      }
    })

    it("should reject invalid key length", () => {
      const result = setConfig("0x1234:::0x1234567890123456789012345678901234567890")
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.code).toBe("INVALID_KEY")
      }
    })

    it("should reject invalid address", () => {
      const agentKey = generatePrivateKey()
      const result = setConfig(`${agentKey}:::not-an-address`)
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.code).toBe("INVALID_ADDRESS")
      }
    })

    it("should preserve existing apiUrl", () => {
      writeConfig({ apiUrl: "https://api.staging.ampersend.ai" })

      const agentKey = generatePrivateKey()
      setConfig(`${agentKey}:::0x1234567890123456789012345678901234567890`)

      const config = readConfig()
      expect(config?.apiUrl).toBe("https://api.staging.ampersend.ai")
    })
  })

  describe("pendingApproval", () => {
    it("should store and read pending approval", () => {
      const agentKey = generatePrivateKey()
      storePendingApproval({
        token: "test-token-abc",
        agentKey,
        expiresAt: computeApprovalExpiry(),
      })

      const config = readConfig()
      expect(config?.pendingApproval).toBeDefined()
      expect(config?.pendingApproval?.token).toBe("test-token-abc")
      expect(config?.pendingApproval?.agentKey).toBe(agentKey)
    })

    it("should preserve active config when storing pending", () => {
      const activeKey = generatePrivateKey()
      writeConfig({
        agentKey: activeKey,
        agentAccount: "0x1111111111111111111111111111111111111111",
      })

      const pendingKey = generatePrivateKey()
      storePendingApproval({
        token: "test-token",
        agentKey: pendingKey,
        expiresAt: computeApprovalExpiry(),
      })

      const config = readConfig()
      expect(config?.agentKey).toBe(activeKey)
      expect(config?.agentAccount).toBe("0x1111111111111111111111111111111111111111")
      expect(config?.pendingApproval?.agentKey).toBe(pendingKey)
    })

    it("should detect expired pending approvals", () => {
      const pending = {
        token: "expired-token",
        agentKey: generatePrivateKey(),
        expiresAt: new Date(Date.now() - 1000).toISOString(), // 1 second ago
      }
      expect(isPendingExpired(pending)).toBe(true)
    })

    it("should detect non-expired pending approvals", () => {
      const pending = {
        token: "valid-token",
        agentKey: generatePrivateKey(),
        expiresAt: computeApprovalExpiry(),
      }
      expect(isPendingExpired(pending)).toBe(false)
    })

    it("should clear pending approval", () => {
      const activeKey = generatePrivateKey()
      writeConfig({
        agentKey: activeKey,
        agentAccount: "0x1111111111111111111111111111111111111111",
        pendingApproval: {
          token: "test-token",
          agentKey: generatePrivateKey(),
          expiresAt: computeApprovalExpiry(),
        },
      })

      clearPendingApproval()

      const config = readConfig()
      expect(config?.pendingApproval).toBeUndefined()
      expect(config?.agentKey).toBe(activeKey) // active config preserved
    })

    it("should promote pending to active", () => {
      const pendingKey = generatePrivateKey()
      const pendingKeyAddress = privateKeyToAddress(pendingKey)

      writeConfig({
        pendingApproval: {
          token: "test-token",
          agentKey: pendingKey,
          expiresAt: computeApprovalExpiry(),
        },
      })

      const agentAccount = "0x2222222222222222222222222222222222222222" as `0x${string}`
      const result = promotePending(agentAccount)

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.agentKeyAddress).toBe(pendingKeyAddress)
        expect(result.data.agentAccount).toBe(agentAccount)
        expect(result.data.status).toBe("ready")
      }

      // Verify config was updated
      const config = readConfig()
      expect(config?.agentKey).toBe(pendingKey)
      expect(config?.agentAccount).toBe(agentAccount)
      expect(config?.pendingApproval).toBeUndefined()
    })

    it("should error when promoting with no pending", () => {
      writeConfig({
        agentKey: generatePrivateKey(),
      })

      const result = promotePending("0x2222222222222222222222222222222222222222")
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.code).toBe("NO_PENDING")
      }
    })
  })

  describe("getStatus", () => {
    it("should return not_initialized when no config exists", () => {
      const result = getStatus()

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.status).toBe("not_initialized")
        expect(result.data.credentialSource).toBe("none")
      }
    })

    it("should return pending_agent status for config without account", () => {
      writeConfig({ agentKey: generatePrivateKey() })
      const result = getStatus()

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.status).toBe("pending_agent")
        expect(result.data.credentialSource).toBe("file")
        expect(result.data.agentKeyAddress).toMatch(/^0x[a-fA-F0-9]{40}$/)
      }
    })

    it("should return ready status for full config", () => {
      const agentKey = generatePrivateKey()
      setConfig(`${agentKey}:::0x1234567890123456789012345678901234567890`)

      const result = getStatus()

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.status).toBe("ready")
        expect(result.data.credentialSource).toBe("file")
        expect(result.data.agentKeyAddress).toMatch(/^0x[a-fA-F0-9]{40}$/)
        expect(result.data.agentAccount).toBe("0x1234567890123456789012345678901234567890")
      }
    })

    it("should prefer env vars over file config", () => {
      const agentKey = generatePrivateKey()
      setConfig(`${agentKey}:::0x1111111111111111111111111111111111111111`)

      process.env.AMPERSEND_AGENT_SECRET =
        "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef:::0x2222222222222222222222222222222222222222"

      const result = getStatus()

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.status).toBe("ready")
        expect(result.data.credentialSource).toBe("env")
        expect(result.data.agentKeyAddress).toMatch(/^0x[a-fA-F0-9]{40}$/)
        expect(result.data.agentAccount).toBe("0x2222222222222222222222222222222222222222")
      }
    })

    it("should show pending approval info", () => {
      const pendingKey = generatePrivateKey()
      storePendingApproval({
        token: "test-token",
        agentKey: pendingKey,
        expiresAt: computeApprovalExpiry(),
      })

      const result = getStatus()

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.pendingApproval).toBeDefined()
        expect(result.data.pendingApproval?.agentKeyAddress).toMatch(/^0x[a-fA-F0-9]{40}$/)
        expect(result.data.pendingApproval?.expired).toBe(false)
      }
    })

    it("should show expired pending approval", () => {
      storePendingApproval({
        token: "expired-token",
        agentKey: generatePrivateKey(),
        expiresAt: new Date(Date.now() - 1000).toISOString(),
      })

      const result = getStatus()

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.pendingApproval?.expired).toBe(true)
      }
    })
  })
})
