import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import {
  autoContextName,
  clearPendingContext,
  computeApprovalExpiry,
  CONFIG_FILE,
  finishContext,
  getActiveApiUrl,
  getStatus,
  isPendingExpired,
  loadCredentials,
  readConfig,
  readLasoToken,
  removeContext,
  resolveContextName,
  setConfig,
  startContext,
  storeLasoToken,
  uniqueContextName,
  useContext,
  writeConfig,
  type Context,
  type ContextSummary,
  type LasoToken,
  type ResolvedCredentials,
  type StoredConfigV2,
} from "@/cli/config.ts"
import { generatePrivateKey, privateKeyToAddress } from "viem/accounts"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// Use a unique temp dir to avoid conflicts with other test files
const TEMP_DIR = join(process.env.TMPDIR ?? "/tmp", "ampersend-config-test")

vi.mock("node:os", () => ({
  homedir: () => join(process.env.TMPDIR ?? "/tmp", "ampersend-config-test"),
  tmpdir: () => join(process.env.TMPDIR ?? "/tmp", "ampersend-config-test"),
}))

/** Build a ready context shorthand. */
function readyContext(overrides: Partial<Extract<Context, { status: "ready" }>> = {}): Context {
  return {
    status: "ready",
    agentKey: generatePrivateKey(),
    agentAccount: "0x1111111111111111111111111111111111111111",
    createdAt: new Date().toISOString(),
    ...overrides,
  }
}

/** Build a pending context shorthand. */
function pendingContext(overrides: Partial<Extract<Context, { status: "pending" }>> = {}): Context {
  return {
    status: "pending",
    agentKey: generatePrivateKey(),
    token: "t",
    expiresAt: computeApprovalExpiry(),
    createdAt: new Date().toISOString(),
    ...overrides,
  }
}

/** Write a single-context config with that context active. */
function writeSingle(name: string, context: Context): void {
  writeConfig({ activeContext: name, contexts: { [name]: context } })
}

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
    delete process.env.AMPERSEND_CONTEXT
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
        // No `default` context: a bare set auto-names from the key.
        expect(result.data.context).toBe(autoContextName(undefined, result.data.agentKeyAddress))
        expect(result.data.agentKeyAddress).toMatch(/^0x[a-fA-F0-9]{40}$/)
      }
    })

    it("should store config as an active ready context under its auto-name", () => {
      const agentKey = generatePrivateKey()
      const result = setConfig(`${agentKey}:::0x1234567890123456789012345678901234567890`)
      if (!result.ok) throw new Error("expected ok")

      const config = readConfig()
      expect(config).not.toBeNull()
      expect(config?.version).toBe(2)
      expect(config?.activeContext).toBe(result.data.context)
      const ctx = config?.contexts[result.data.context]
      expect(ctx?.status).toBe("ready")
      expect(ctx?.agentKey).toBe(agentKey)
      if (ctx?.status === "ready") {
        expect(ctx.agentAccount).toBe("0x1234567890123456789012345678901234567890")
        expect(ctx.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
      }
    })

    it("should write to a named context with --context", () => {
      const agentKey = generatePrivateKey()
      const result = setConfig(`${agentKey}:::0x1234567890123456789012345678901234567890`, { name: "sandbox" })

      expect(result.ok).toBe(true)
      const config = readConfig()
      expect(config?.activeContext).toBe("sandbox")
      expect(config?.contexts.sandbox?.agentKey).toBe(agentKey)
    })

    it("auto-names a fresh context on each bare set (never overwrites)", () => {
      const a = setConfig(`${generatePrivateKey()}:::0x1111111111111111111111111111111111111111`)
      const b = setConfig(`${generatePrivateKey()}:::0x2222222222222222222222222222222222222222`)
      if (!a.ok || !b.ok) throw new Error("expected ok")

      expect(a.data.context).not.toBe(b.data.context)
      const config = readConfig()
      expect(Object.keys(config?.contexts ?? {})).toHaveLength(2)
      expect(config?.activeContext).toBe(b.data.context) // latest wins
    })

    it("disambiguates an auto-name collision with a counter", () => {
      // Two keys that hash to the same 4-hex prefix would collide; force it by
      // pre-seeding the base name, then setting an identity that derives it.
      const agentKey = generatePrivateKey()
      const base = autoContextName(undefined, privateKeyToAddress(agentKey))
      writeSingle(base, readyContext())

      const result = setConfig(`${agentKey}:::0x2222222222222222222222222222222222222222`)
      if (!result.ok) throw new Error("expected ok")
      expect(result.data.context).toBe(`${base}-2`)
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

    it("preserves an overwritten named context's existing apiUrl", () => {
      // Overwriting a named context's identity (no new --api-url) keeps its URL.
      writeSingle("sandbox", readyContext({ apiUrl: "https://api.staging.ampersend.ai" }))

      const agentKey = generatePrivateKey()
      setConfig(`${agentKey}:::0x1234567890123456789012345678901234567890`, { name: "sandbox" })

      const ctx = readConfig()?.contexts.sandbox
      expect(ctx?.apiUrl).toBe("https://api.staging.ampersend.ai")
    })

    it("sets apiUrl on the named context at creation", () => {
      // `--context X --api-url Y` lands on X with Y as its fixed URL.
      const prod = setConfig(`${generatePrivateKey()}:::0x1111111111111111111111111111111111111111`)
      if (!prod.ok) throw new Error("expected ok")
      setConfig(`${generatePrivateKey()}:::0x2222222222222222222222222222222222222222`, {
        name: "sandbox",
        apiUrl: "https://api.sandbox.ampersend.ai",
      })

      const config = readConfig()
      expect(config?.contexts[prod.data.context]?.apiUrl).toBeUndefined()
      expect(config?.contexts.sandbox?.apiUrl).toBe("https://api.sandbox.ampersend.ai")
    })

    it("rejects an invalid apiUrl", () => {
      const result = setConfig(`${generatePrivateKey()}:::0x1111111111111111111111111111111111111111`, {
        apiUrl: "not a url",
      })
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.code).toBe("INVALID_URL")
    })
  })

  describe("pending contexts", () => {
    it("should create and read a pending context as active", () => {
      const agentKey = generatePrivateKey()
      startContext("default", { token: "test-token-abc", agentKey, expiresAt: computeApprovalExpiry() })

      const config = readConfig()
      expect(config?.activeContext).toBe("default")
      const ctx = config?.contexts.default
      expect(ctx?.status).toBe("pending")
      if (ctx?.status === "pending") {
        expect(ctx.token).toBe("test-token-abc")
        expect(ctx.agentKey).toBe(agentKey)
      }
    })

    it("should not activate a detached pending context", () => {
      const agentKey = generatePrivateKey()
      const seeded = setConfig(`${generatePrivateKey()}:::0x1111111111111111111111111111111111111111`)
      if (!seeded.ok) throw new Error("expected ok")
      startContext("probe", { token: "t", agentKey, expiresAt: computeApprovalExpiry() }, { detach: true })

      const config = readConfig()
      expect(config?.activeContext).toBe(seeded.data.context) // unchanged
      expect(config?.contexts.probe?.status).toBe("pending")
    })

    it("should keep other contexts when creating a pending one", () => {
      const activeKey = generatePrivateKey()
      writeSingle("default", readyContext({ agentKey: activeKey }))

      const pendingKey = generatePrivateKey()
      startContext("sandbox", { token: "test-token", agentKey: pendingKey, expiresAt: computeApprovalExpiry() })

      const config = readConfig()
      expect(config?.contexts.default?.agentKey).toBe(activeKey)
      expect(config?.contexts.sandbox?.agentKey).toBe(pendingKey)
    })

    it("should detect expired pending approvals", () => {
      expect(isPendingExpired({ expiresAt: new Date(Date.now() - 1000).toISOString() })).toBe(true)
    })

    it("should detect non-expired pending approvals", () => {
      expect(isPendingExpired({ expiresAt: computeApprovalExpiry() })).toBe(false)
    })

    it("should prune expired pending contexts on write", () => {
      writeConfig({
        activeContext: "prod",
        contexts: {
          prod: readyContext(),
          stale: pendingContext({ expiresAt: new Date(Date.now() - 1000).toISOString() }),
        },
      })

      const config = readConfig()
      expect(config?.contexts.stale).toBeUndefined()
      expect(config?.contexts.prod).toBeDefined()
    })

    it("should clear a pending context", () => {
      const activeKey = generatePrivateKey()
      writeConfig({
        activeContext: "prod",
        contexts: {
          prod: readyContext({ agentKey: activeKey }),
          sandbox: pendingContext({ token: "test-token" }),
        },
      })

      clearPendingContext("sandbox")

      const config = readConfig()
      expect(config?.contexts.sandbox).toBeUndefined()
      expect(config?.contexts.prod?.agentKey).toBe(activeKey) // other context preserved
    })

    it("should promote a pending context to ready and active, preserving createdAt", () => {
      const pendingKey = generatePrivateKey()
      const pendingKeyAddress = privateKeyToAddress(pendingKey)
      const createdAt = "2026-01-01T00:00:00.000Z"

      writeConfig({
        contexts: { sandbox: pendingContext({ agentKey: pendingKey, token: "test-token", createdAt }) },
      })

      const agentAccount = "0x2222222222222222222222222222222222222222" as `0x${string}`
      const result = finishContext("sandbox", agentAccount)

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.agentKeyAddress).toBe(pendingKeyAddress)
        expect(result.data.agentAccount).toBe(agentAccount)
        expect(result.data.context).toBe("sandbox")
        expect(result.data.status).toBe("ready")
      }

      const config = readConfig()
      expect(config?.activeContext).toBe("sandbox")
      const ctx = config?.contexts.sandbox
      expect(ctx?.status).toBe("ready")
      expect(ctx?.agentKey).toBe(pendingKey)
      if (ctx?.status === "ready") {
        expect(ctx.agentAccount).toBe(agentAccount)
        expect(ctx.createdAt).toBe(createdAt) // carried over from the pending context
      }
    })

    it("should error when finishing an unknown context", () => {
      const result = finishContext("nope", "0x2222222222222222222222222222222222222222")
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.code).toBe("UNKNOWN_CONTEXT")
    })

    it("should error when finishing an already-ready context", () => {
      writeSingle("default", readyContext())
      const result = finishContext("default", "0x2222222222222222222222222222222222222222")
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.code).toBe("NOT_PENDING")
    })
  })

  describe("useContext / removeContext", () => {
    it("switches the active context", () => {
      writeConfig({
        activeContext: "prod",
        contexts: { prod: readyContext(), sandbox: readyContext() },
      })

      const result = useContext("sandbox")
      expect(result.ok).toBe(true)
      expect(readConfig()?.activeContext).toBe("sandbox")
    })

    it("errors on an unknown context name for use", () => {
      writeSingle("prod", readyContext())
      const result = useContext("nope")
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.code).toBe("UNKNOWN_CONTEXT")
    })

    it("deletes a non-active context, leaving active intact", () => {
      writeConfig({
        activeContext: "prod",
        contexts: { prod: readyContext(), sandbox: readyContext() },
      })

      const result = removeContext("sandbox")
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.data.wasActive).toBe(false)
      const config = readConfig()
      expect(config?.contexts.sandbox).toBeUndefined()
      expect(config?.activeContext).toBe("prod")
    })

    it("clears the active selection when deleting the active context", () => {
      writeSingle("prod", readyContext())

      const result = removeContext("prod")
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.data.wasActive).toBe(true)
      const config = readConfig()
      expect(config?.contexts.prod).toBeUndefined()
      expect(config?.activeContext).toBeUndefined()
    })

    it("errors on an unknown context name for rm", () => {
      const result = removeContext("nope")
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.code).toBe("UNKNOWN_CONTEXT")
    })
  })

  describe("autoContextName / uniqueContextName", () => {
    const ADDR = "0x1a2b3c4d5e6f00000000000000000000000000ab"

    it("derives ctx-<4 hex of key> for production URLs", () => {
      expect(autoContextName(undefined, ADDR)).toBe("ctx-1a2b")
      expect(autoContextName("https://api.ampersend.ai", ADDR)).toBe("ctx-1a2b")
    })

    it("prepends the host for non-production URLs", () => {
      expect(autoContextName("https://api.sandbox.ampersend.ai", ADDR)).toBe("api.sandbox.ampersend.ai-ctx-1a2b")
    })

    it("returns the base name when free", () => {
      const config: StoredConfigV2 = { version: 2, contexts: {} }
      expect(uniqueContextName(config, undefined, ADDR)).toBe("ctx-1a2b")
    })

    it("appends a counter on collision", () => {
      const config: StoredConfigV2 = {
        version: 2,
        contexts: { "ctx-1a2b": readyContext(), "ctx-1a2b-2": readyContext() },
      }
      expect(uniqueContextName(config, undefined, ADDR)).toBe("ctx-1a2b-3")
    })
  })

  describe("getActiveApiUrl", () => {
    it("returns the active context's apiUrl", () => {
      writeSingle("default", readyContext({ apiUrl: "https://api.staging.ampersend.ai" }))
      expect(getActiveApiUrl()).toBe("https://api.staging.ampersend.ai")
    })

    it("env var overrides the active context's apiUrl", () => {
      writeSingle("default", readyContext({ apiUrl: "https://api.staging.ampersend.ai" }))
      process.env.AMPERSEND_API_URL = "https://api.sandbox.ampersend.ai"
      expect(getActiveApiUrl()).toBe("https://api.sandbox.ampersend.ai")
    })

    it("falls back to the production default", () => {
      expect(getActiveApiUrl()).toBe("https://api.ampersend.ai")
    })

    it("uses the --context-selected context's apiUrl over the active one", () => {
      writeConfig({
        activeContext: "prod",
        contexts: {
          prod: readyContext(),
          sandbox: readyContext({ apiUrl: "https://api.sandbox.ampersend.ai" }),
        },
      })
      expect(getActiveApiUrl({ context: "sandbox" })).toBe("https://api.sandbox.ampersend.ai")
    })

    it("AMPERSEND_API_URL is a hard bypass over a --context-selected context", () => {
      writeConfig({
        activeContext: "prod",
        contexts: { prod: readyContext(), sandbox: readyContext({ apiUrl: "https://api.sandbox.ampersend.ai" }) },
      })
      process.env.AMPERSEND_API_URL = "https://api.hardbypass.ampersend.ai"
      expect(getActiveApiUrl({ context: "sandbox" })).toBe("https://api.hardbypass.ampersend.ai")
    })
  })

  describe("context selection (resolveContextName)", () => {
    it("--context flag wins over env and active", () => {
      writeConfig({ activeContext: "prod", contexts: { prod: readyContext(), sandbox: readyContext() } })
      process.env.AMPERSEND_CONTEXT = "sandbox"
      expect(resolveContextName({ context: "explicit" })).toBe("explicit")
    })

    it("AMPERSEND_CONTEXT wins over the persisted active when no flag", () => {
      writeConfig({ activeContext: "prod", contexts: { prod: readyContext(), sandbox: readyContext() } })
      process.env.AMPERSEND_CONTEXT = "sandbox"
      expect(resolveContextName()).toBe("sandbox")
    })

    it("falls back to the persisted active context", () => {
      writeConfig({ activeContext: "prod", contexts: { prod: readyContext() } })
      expect(resolveContextName()).toBe("prod")
    })

    it("returns undefined when nothing resolves", () => {
      expect(resolveContextName()).toBeUndefined()
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

    it("should return pending_agent status when the active context is pending", () => {
      startContext("sandbox", { token: "t", agentKey: generatePrivateKey(), expiresAt: computeApprovalExpiry() })
      const result = getStatus()

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.status).toBe("pending_agent")
        expect(result.data.credentialSource).toBe("file")
        expect(result.data.activeContext?.name).toBe("sandbox")
        expect(result.data.activeContext?.agentKeyAddress).toMatch(/^0x[a-fA-F0-9]{40}$/)
      }
    })

    it("should return ready status and list contexts for full config", () => {
      const agentKey = generatePrivateKey()
      const set = setConfig(`${agentKey}:::0x1234567890123456789012345678901234567890`)
      if (!set.ok) throw new Error("expected ok")

      const result = getStatus()

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.status).toBe("ready")
        expect(result.data.credentialSource).toBe("file")
        expect(result.data.activeContext?.name).toBe(set.data.context)
        expect(result.data.activeContext?.agentKeyAddress).toMatch(/^0x[a-fA-F0-9]{40}$/)
        expect(result.data.activeContext?.agentAccount).toBe("0x1234567890123456789012345678901234567890")
        expect(result.data.contexts).toHaveLength(1)
        expect(result.data.contexts?.[0]).toMatchObject({ name: set.data.context, status: "ready", active: true })
        expect(result.data.contexts?.[0]?.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
      }
    })

    it("should list every context with its status, oldest first", () => {
      writeConfig({
        activeContext: "prod",
        contexts: {
          // sandbox created earlier than prod — should sort ahead of it.
          prod: readyContext({ createdAt: "2026-02-01T00:00:00.000Z" }),
          sandbox: pendingContext({ createdAt: "2026-01-01T00:00:00.000Z" }),
        },
      })

      const result = getStatus()
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.contexts?.map((c: ContextSummary) => c.name)).toEqual(["sandbox", "prod"])
        const sandbox = result.data.contexts?.find((c: ContextSummary) => c.name === "sandbox")
        expect(sandbox?.status).toBe("pending_agent")
        expect(sandbox?.pendingExpired).toBe(false)
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
        expect(result.data.activeContext?.name).toBeUndefined()
        expect(result.data.activeContext?.agentKeyAddress).toMatch(/^0x[a-fA-F0-9]{40}$/)
        expect(result.data.activeContext?.agentAccount).toBe("0x2222222222222222222222222222222222222222")
      }
    })
  })

  describe("loadCredentials", () => {
    const VALID_ACCOUNT = "0x1111111111111111111111111111111111111111" as `0x${string}`

    it("returns NOT_CONFIGURED when no env and no file", () => {
      const result = loadCredentials()

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.error.code).toBe("NOT_CONFIGURED")
        expect(result.error.error.status).toBe("not_initialized")
      }
    })

    it("returns SETUP_INCOMPLETE when the active context is pending", () => {
      startContext("default", { token: "t", agentKey: generatePrivateKey(), expiresAt: computeApprovalExpiry() })

      const result = loadCredentials()

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.error.code).toBe("SETUP_INCOMPLETE")
        expect(result.error.error.status).toBe("pending_agent")
      }
    })

    it("reads from the active context when ready", () => {
      const agentKey = generatePrivateKey()
      setConfig(`${agentKey}:::${VALID_ACCOUNT}`)

      const result = loadCredentials()

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.credentials.agentKey).toBe(agentKey)
        expect(result.credentials.agentAccount).toBe(VALID_ACCOUNT)
        expect(result.credentials.apiUrl).toBeUndefined()
      }
    })

    it("env vars take precedence over file", () => {
      const fileKey = generatePrivateKey()
      setConfig(`${fileKey}:::${VALID_ACCOUNT}`)

      const envKey = "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef" as const
      const envAccount = "0x2222222222222222222222222222222222222222" as const
      process.env.AMPERSEND_AGENT_SECRET = `${envKey}:::${envAccount}`

      const result = loadCredentials()

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.credentials.agentKey).toBe(envKey)
        expect(result.credentials.agentAccount).toBe(envAccount)
      }
    })

    it("AMPERSEND_API_URL overrides the active context's apiUrl", () => {
      writeSingle("default", readyContext({ agentAccount: VALID_ACCOUNT, apiUrl: "https://api.staging.ampersend.ai" }))
      process.env.AMPERSEND_API_URL = "https://api.sandbox.ampersend.ai"

      const result = loadCredentials()

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.credentials.apiUrl).toBe("https://api.sandbox.ampersend.ai")
      }
    })

    it("falls back to the active context's apiUrl when env var is unset", () => {
      writeSingle("default", readyContext({ agentAccount: VALID_ACCOUNT, apiUrl: "https://api.staging.ampersend.ai" }))

      const result = loadCredentials()

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.credentials.apiUrl).toBe("https://api.staging.ampersend.ai")
      }
    })

    it("reads credentials from the active context, not other contexts", () => {
      const prodKey = generatePrivateKey()
      const sandboxKey = generatePrivateKey()
      writeConfig({
        activeContext: "sandbox",
        contexts: {
          prod: readyContext({ agentKey: prodKey, agentAccount: VALID_ACCOUNT }),
          sandbox: readyContext({
            agentKey: sandboxKey,
            agentAccount: "0x3333333333333333333333333333333333333333",
            apiUrl: "https://api.sandbox.ampersend.ai",
          }),
        },
      })

      const result = loadCredentials()
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.credentials.agentKey).toBe(sandboxKey)
        expect(result.credentials.apiUrl).toBe("https://api.sandbox.ampersend.ai")
      }
    })

    it("--context override reads a non-active context", () => {
      const prodKey = generatePrivateKey()
      const sandboxKey = generatePrivateKey()
      writeConfig({
        activeContext: "prod",
        contexts: {
          prod: readyContext({ agentKey: prodKey, agentAccount: VALID_ACCOUNT }),
          sandbox: readyContext({
            agentKey: sandboxKey,
            agentAccount: "0x3333333333333333333333333333333333333333",
            apiUrl: "https://api.sandbox.ampersend.ai",
          }),
        },
      })

      const result = loadCredentials({ context: "sandbox" })
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.credentials.agentKey).toBe(sandboxKey)
        expect(result.credentials.apiUrl).toBe("https://api.sandbox.ampersend.ai")
      }
    })

    it("AMPERSEND_CONTEXT selects the context when no flag is passed", () => {
      const prodKey = generatePrivateKey()
      const sandboxKey = generatePrivateKey()
      writeConfig({
        activeContext: "prod",
        contexts: {
          prod: readyContext({ agentKey: prodKey, agentAccount: VALID_ACCOUNT }),
          sandbox: readyContext({ agentKey: sandboxKey, agentAccount: "0x3333333333333333333333333333333333333333" }),
        },
      })
      process.env.AMPERSEND_CONTEXT = "sandbox"

      const result = loadCredentials()
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.credentials.agentKey).toBe(sandboxKey)
    })

    it("SETUP_INCOMPLETE when the --context-selected context is pending", () => {
      writeConfig({
        activeContext: "prod",
        contexts: {
          prod: readyContext({ agentAccount: VALID_ACCOUNT }),
          sandbox: pendingContext(),
        },
      })

      const result = loadCredentials({ context: "sandbox" })
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.error.code).toBe("SETUP_INCOMPLETE")
    })
  })

  describe("v1 → v2 migration", () => {
    function writeRawV1(v1: Record<string, unknown>): void {
      mkdirSync(configDir, { recursive: true })
      writeFileSync(CONFIG_FILE, JSON.stringify({ version: 1, ...v1 }, null, 2))
    }

    it("migrates a complete v1 identity into an active auto-named ready context", () => {
      const agentKey = generatePrivateKey()
      const apiUrl = "https://api.staging.ampersend.ai"
      const name = autoContextName(apiUrl, privateKeyToAddress(agentKey))
      writeRawV1({ agentKey, agentAccount: "0x1111111111111111111111111111111111111111", apiUrl })

      const config = readConfig()
      expect(config?.version).toBe(2)
      expect(config?.activeContext).toBe(name)
      const ctx = config?.contexts[name]
      expect(ctx?.status).toBe("ready")
      expect(ctx?.agentKey).toBe(agentKey)
      expect(ctx?.apiUrl).toBe(apiUrl)
      // No creation timestamp in v1 — migration stamps one.
      if (ctx?.status === "ready") expect(ctx.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    })

    it("carries the v1 lasoToken onto the migrated context", () => {
      const agentKey = generatePrivateKey()
      const name = autoContextName(undefined, privateKeyToAddress(agentKey))
      const lasoToken = {
        idToken: "tok-v1",
        expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        agentKey,
      }
      writeRawV1({ agentKey, agentAccount: "0x1111111111111111111111111111111111111111", lasoToken })

      const ctx = readConfig()?.contexts[name]
      if (ctx?.status === "ready") expect(ctx.lasoToken?.idToken).toBe("tok-v1")
    })

    it("migrates a standalone v1 pending approval into an auto-named pending context", () => {
      const pendingKey = generatePrivateKey()
      const name = autoContextName(undefined, privateKeyToAddress(pendingKey))
      writeRawV1({
        pendingApproval: { token: "pending-tok", agentKey: pendingKey, expiresAt: computeApprovalExpiry() },
      })

      const config = readConfig()
      expect(config?.activeContext).toBe(name)
      const ctx = config?.contexts[name]
      expect(ctx?.status).toBe("pending")
      if (ctx?.status === "pending") expect(ctx.token).toBe("pending-tok")
    })

    it("migrates both an identity and a pending approval, identity stays active", () => {
      const agentKey = generatePrivateKey()
      const pendingKey = generatePrivateKey()
      const readyName = autoContextName(undefined, privateKeyToAddress(agentKey))
      const pendingName = autoContextName(undefined, privateKeyToAddress(pendingKey))
      writeRawV1({
        agentKey,
        agentAccount: "0x1111111111111111111111111111111111111111",
        pendingApproval: { token: "pending-tok", agentKey: pendingKey, expiresAt: computeApprovalExpiry() },
      })

      const config = readConfig()
      expect(config?.activeContext).toBe(readyName)
      expect(config?.contexts[readyName]?.status).toBe("ready")
      expect(config?.contexts[pendingName]?.status).toBe("pending")
    })

    it("drops an orphan key-only v1 file (no account)", () => {
      writeRawV1({ agentKey: generatePrivateKey() })

      const config = readConfig()
      expect(config?.contexts).toEqual({})
      expect(config?.activeContext).toBeUndefined()
    })

    it("rewrites the file as v2 on the next write", () => {
      const agentKey = generatePrivateKey()
      const name = autoContextName(undefined, privateKeyToAddress(agentKey))
      writeRawV1({ agentKey, agentAccount: "0x1111111111111111111111111111111111111111" })

      // Trigger a write through a normal path.
      useContext(name)

      const config = readConfig()
      expect(config?.version).toBe(2)
    })
  })

  describe("lasoToken", () => {
    const VALID_ACCOUNT = "0x1111111111111111111111111111111111111111" as `0x${string}`
    const agentKey = generatePrivateKey()
    const creds: ResolvedCredentials = { agentAccount: VALID_ACCOUNT, agentKey }

    function freshToken(overrides: Partial<LasoToken> = {}): LasoToken {
      return {
        idToken: "tok-123",
        expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        agentKey,
        ...overrides,
      }
    }

    /** Seed the active identity and return its auto-derived context name. */
    function seedIdentity(): string {
      const result = setConfig(`${agentKey}:::${VALID_ACCOUNT}`)
      if (!result.ok) throw new Error("expected ok")
      return result.data.context
    }

    it("stores and reads back a valid token for the active context", () => {
      seedIdentity()
      storeLasoToken(freshToken())

      expect(readLasoToken(creds)?.idToken).toBe("tok-123")
    })

    it("treats an expired token as absent", () => {
      seedIdentity()
      storeLasoToken(freshToken({ expiresAt: new Date(Date.now() - 1000).toISOString() }))

      expect(readLasoToken(creds)).toBeNull()
    })

    it("treats a token stamped with a different agentKey as absent", () => {
      seedIdentity()
      storeLasoToken(freshToken())

      const otherCreds: ResolvedCredentials = { agentAccount: VALID_ACCOUNT, agentKey: generatePrivateKey() }
      expect(readLasoToken(otherCreds)).toBeNull()
    })

    it("treats a token stamped with a different apiUrl as absent", () => {
      seedIdentity()
      storeLasoToken(freshToken({ apiUrl: "https://api.staging.ampersend.ai" }))

      // Active creds default to production; stamped staging URL no longer matches.
      expect(readLasoToken(creds)).toBeNull()
    })

    it("normalizes absent vs explicit production URL as the same context", () => {
      seedIdentity()
      storeLasoToken(freshToken({ apiUrl: "https://api.ampersend.ai" }))

      expect(readLasoToken(creds)?.idToken).toBe("tok-123")
    })

    it("is a no-op when there is no active ready context", () => {
      // No identity seeded → no file. storeLasoToken must not create one.
      storeLasoToken(freshToken())
      expect(readConfig()).toBeNull()
    })

    it("keeps each context's token across config use (no cross-context leakage)", () => {
      // prod gets a token; switching to sandbox and back must keep prod's token.
      const prodKey = generatePrivateKey()
      const prodCreds: ResolvedCredentials = { agentAccount: VALID_ACCOUNT, agentKey: prodKey }
      writeConfig({
        activeContext: "prod",
        contexts: {
          prod: readyContext({ agentKey: prodKey, agentAccount: VALID_ACCOUNT }),
          sandbox: readyContext(),
        },
      })
      storeLasoToken({
        idToken: "prod-tok",
        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
        agentKey: prodKey,
      })

      useContext("sandbox")
      expect(readLasoToken(prodCreds)).toBeNull() // sandbox active, prod's token not visible

      useContext("prod")
      expect(readLasoToken(prodCreds)?.idToken).toBe("prod-tok") // prod's token intact
    })

    it("stores and reads a token against a --context-selected context", () => {
      const prodKey = generatePrivateKey()
      const sandboxKey = generatePrivateKey()
      const sandboxCreds: ResolvedCredentials = { agentAccount: VALID_ACCOUNT, agentKey: sandboxKey }
      writeConfig({
        activeContext: "prod",
        contexts: {
          prod: readyContext({ agentKey: prodKey, agentAccount: VALID_ACCOUNT }),
          sandbox: readyContext({ agentKey: sandboxKey, agentAccount: VALID_ACCOUNT }),
        },
      })

      // Store against sandbox while prod is active; read it back via the selector.
      storeLasoToken(
        { idToken: "sandbox-tok", expiresAt: new Date(Date.now() + 3600_000).toISOString(), agentKey: sandboxKey },
        { context: "sandbox" },
      )

      expect(readLasoToken(sandboxCreds, { context: "sandbox" })?.idToken).toBe("sandbox-tok")
      // The active (prod) context has no token of its own.
      const prodCtx = readConfig()?.contexts.prod
      if (prodCtx?.status === "ready") expect(prodCtx.lasoToken).toBeUndefined()
    })

    it("overwriting a context's identity drops its token (config set --context)", () => {
      // Overwriting a named context with a new key invalidates its cached token.
      const name = seedIdentity()
      storeLasoToken(freshToken())

      setConfig(`${generatePrivateKey()}:::${VALID_ACCOUNT}`, { name })

      const ctx = readConfig()?.contexts[name]
      if (ctx?.status === "ready") expect(ctx.lasoToken).toBeUndefined()
    })

    it("drops the token on finishContext (pending → ready, fresh identity)", () => {
      // A pending context has no lasoToken; finishing produces a ready context
      // with no token. (No carry-over by construction.)
      startContext("sandbox", {
        token: "approval-token",
        agentKey: generatePrivateKey(),
        expiresAt: computeApprovalExpiry(),
      })
      finishContext("sandbox", VALID_ACCOUNT)

      const ctx = readConfig()?.contexts.sandbox
      if (ctx?.status === "ready") expect(ctx.lasoToken).toBeUndefined()
    })
  })
})
