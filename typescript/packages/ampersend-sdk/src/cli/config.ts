import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

import { Schema } from "effect"
import { isAddress } from "viem"
import { privateKeyToAddress } from "viem/accounts"

import { parseEnvConfig } from "../ampersend/env.ts"
import { err, ok, type ConfigStatus, type JsonEnvelope } from "./envelope.ts"

/**
 * Resolved credentials for an authenticated command. Tries env vars first
 * (so a deploy can override without touching the local config file), then
 * the config file written by `setup` / `config set`.
 */
export interface ResolvedCredentials {
  agentAccount: `0x${string}`
  agentKey: `0x${string}`
  apiUrl?: string
}

/**
 * Shared by every CLI command that needs to talk to the API as an agent.
 * Returns an `err` envelope when the local config isn't ready, so the
 * caller can print it and exit.
 */
export function loadCredentials():
  | { ok: true; credentials: ResolvedCredentials }
  | { ok: false; error: JsonEnvelope<never> } {
  try {
    const envConfig = parseEnvConfig()
    return {
      ok: true,
      credentials: {
        agentAccount: envConfig.AGENT_ACCOUNT as `0x${string}`,
        agentKey: envConfig.AGENT_KEY as `0x${string}`,
        ...(envConfig.API_URL ? { apiUrl: envConfig.API_URL } : {}),
      },
    }
  } catch {
    // Fall back to config file
  }

  const fileConfig = getRuntimeConfig()
  if (fileConfig?.status === "ready" && fileConfig.agentAccount && fileConfig.agentKey) {
    const apiUrl = process.env.AMPERSEND_API_URL ?? fileConfig.apiUrl
    return {
      ok: true,
      credentials: {
        agentAccount: fileConfig.agentAccount,
        agentKey: fileConfig.agentKey,
        ...(apiUrl ? { apiUrl } : {}),
      },
    }
  }

  const status = fileConfig?.status ?? "not_initialized"
  const code = status === "not_initialized" ? "NOT_CONFIGURED" : "SETUP_INCOMPLETE"
  return {
    ok: false,
    error: err(code, 'Run "ampersend setup start" or "ampersend config set" to configure', { status }),
  }
}

/** Config directory and file paths */
const CONFIG_DIR = join(homedir(), ".ampersend")
export const CONFIG_FILE = join(CONFIG_DIR, "config.json")

/** Current config version */
const CONFIG_VERSION = 1

/** Hard-coded approval expiration: 30 minutes */
const APPROVAL_EXPIRY_MS = 30 * 60 * 1000

// Re-export ConfigStatus for consumers
export type { ConfigStatus }

/** Default API URL (production) */
export const DEFAULT_API_URL = "https://api.ampersend.ai"

/** Pending approval stored in config */
export interface PendingApproval {
  token: string
  agentKey: `0x${string}`
  expiresAt: string // ISO timestamp — informational, `setup start` enforces locally; `setup finish` lets API decide
}

const HexString = Schema.TemplateLiteral(Schema.Literal("0x"), Schema.String)

/**
 * Cached Laso Bearer token for `card details`/`list`, so a warm read costs
 * nothing. Stamped with the identity (`agentKey`) and `apiUrl` it was minted
 * under: `readLasoToken` treats it as absent if either no longer matches the
 * active config (covers env-var overrides) or it has expired. Self-correcting,
 * so the identity/URL write paths only need to drop it, not re-thread it.
 *
 * Schema is the source of truth; the `LasoToken` type is derived from it so the
 * two can't drift (the same pattern as the schemas in `src/ampersend/`).
 */
const LasoTokenSchema = Schema.Struct({
  idToken: Schema.String,
  expiresAt: Schema.String, // ISO timestamp
  agentKey: HexString,
  apiUrl: Schema.optional(Schema.String),
})

export type LasoToken = typeof LasoTokenSchema.Type

/** Stored configuration V1 */
export interface StoredConfigV1 {
  version: 1
  agentKey?: `0x${string}`
  agentAccount?: `0x${string}`
  apiUrl?: string
  pendingApproval?: PendingApproval
  lasoToken?: LasoToken
}

/** Current stored config type */
export type StoredConfig = StoredConfigV1

/** Schema for validating stored config read from disk.
 *
 * Effect Schema strips unknown keys, so legacy fields like `network` written
 * by older versions are silently dropped on next write. */
const StoredConfigSchema = Schema.Struct({
  version: Schema.Literal(1),
  agentKey: Schema.optional(HexString),
  agentAccount: Schema.optional(HexString),
  apiUrl: Schema.optional(Schema.String),
  pendingApproval: Schema.optional(
    Schema.Struct({
      token: Schema.String,
      agentKey: HexString,
      expiresAt: Schema.String,
    }),
  ),
  lasoToken: Schema.optional(LasoTokenSchema),
})

/** Runtime configuration with derived fields */
export interface RuntimeConfig {
  agentKey?: `0x${string}`
  agentAccount?: `0x${string}`
  apiUrl?: string
  pendingApproval?: PendingApproval
  lasoToken?: LasoToken
  status: ConfigStatus
}

/**
 * Ensure config directory exists with secure permissions
 */
function ensureConfigDir(): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { mode: 0o700, recursive: true })
  }
}

/**
 * Read config file if it exists.
 * Returns null if the file is missing or corrupt.
 */
export function readConfig(): StoredConfig | null {
  if (!existsSync(CONFIG_FILE)) {
    return null
  }
  const content = readFileSync(CONFIG_FILE, "utf-8")
  try {
    const parsed = JSON.parse(content)
    return Schema.decodeUnknownSync(StoredConfigSchema)(parsed) as StoredConfig
  } catch {
    // Corrupt or unrecognised config — treat as absent so commands can re-initialise
    return null
  }
}

/**
 * Write config file with secure permissions
 */
export function writeConfig(config: Omit<StoredConfig, "version">): void {
  ensureConfigDir()
  const withVersion: StoredConfig = { version: CONFIG_VERSION, ...config }
  writeFileSync(CONFIG_FILE, JSON.stringify(withVersion, null, 2), { mode: 0o600 })
}

/**
 * Get runtime config with status
 */
export function getRuntimeConfig(): RuntimeConfig | null {
  const stored = readConfig()
  if (!stored) {
    return null
  }

  const { version: _, ...rest } = stored
  const status: ConfigStatus = rest.agentKey && rest.agentAccount ? "ready" : "pending_agent"

  return { ...rest, status }
}

/**
 * Get configuration status for error messages
 */
export function getConfigStatus(): { status: ConfigStatus } {
  const config = getRuntimeConfig()
  if (!config) {
    return { status: "not_initialized" }
  }
  return { status: config.status }
}

/**
 * Check if a pending approval has expired locally.
 */
export function isPendingExpired(pending: PendingApproval): boolean {
  return new Date(pending.expiresAt).getTime() <= Date.now()
}

/**
 * Compute the expiration ISO string for a new approval (now + 30min).
 */
export function computeApprovalExpiry(): string {
  return new Date(Date.now() + APPROVAL_EXPIRY_MS).toISOString()
}

/**
 * Set active config directly using "agentKey:::agentAccount" format.
 * Replaces the old `config init` + `config set-agent` flow.
 */
export function setConfig(
  secret: string,
): JsonEnvelope<{ agentKeyAddress: string; agentAccount: string; status: ConfigStatus }> {
  const parts = secret.split(":::")
  if (parts.length !== 2) {
    return err("INVALID_FORMAT", 'Expected format: "agentKey:::agentAccount"')
  }

  const [agentKey, agentAccount] = parts
  if (!agentKey.startsWith("0x") || agentKey.length !== 66) {
    return err("INVALID_KEY", "Agent key must be a 0x-prefixed 32-byte hex string (66 chars)")
  }
  if (!isAddress(agentAccount)) {
    return err("INVALID_ADDRESS", "Invalid Ethereum address format for agent account")
  }

  const existing = readConfig()
  // lasoToken intentionally not carried over: changing the active identity
  // invalidates any cached Laso token (it's stamped with the old agentKey).
  writeConfig({
    agentKey: agentKey as `0x${string}`,
    agentAccount: agentAccount as `0x${string}`,
    ...(existing?.apiUrl ? { apiUrl: existing.apiUrl } : {}),
    // Preserve pending approval if any
    ...(existing?.pendingApproval ? { pendingApproval: existing.pendingApproval } : {}),
  })

  const agentKeyAddress = privateKeyToAddress(agentKey as `0x${string}`)

  return ok({
    agentKeyAddress,
    agentAccount,
    status: "ready" as ConfigStatus,
  })
}

/**
 * Set API URL in config. Pass undefined to clear (revert to production default).
 */
export function setApiUrl(apiUrl: string | undefined): JsonEnvelope<{ apiUrl: string }> {
  if (apiUrl != null) {
    try {
      new URL(apiUrl)
    } catch {
      return err("INVALID_URL", "Invalid URL format.")
    }
  }

  const existing = readConfig()
  // lasoToken intentionally not carried over: changing the API URL points reads
  // at a different Laso/facilitator context, so a token minted under the old
  // URL no longer applies.
  writeConfig({
    ...(existing?.agentKey ? { agentKey: existing.agentKey } : {}),
    ...(existing?.agentAccount ? { agentAccount: existing.agentAccount } : {}),
    ...(existing?.pendingApproval ? { pendingApproval: existing.pendingApproval } : {}),
    ...(apiUrl != null ? { apiUrl } : {}),
  })

  return ok({ apiUrl: apiUrl ?? DEFAULT_API_URL })
}

/**
 * Store a pending approval in config.
 * Called by `setup start`.
 */
export function storePendingApproval(pending: PendingApproval): void {
  const existing = readConfig()
  writeConfig({
    ...(existing?.agentKey ? { agentKey: existing.agentKey } : {}),
    ...(existing?.agentAccount ? { agentAccount: existing.agentAccount } : {}),
    ...(existing?.apiUrl ? { apiUrl: existing.apiUrl } : {}),
    // Active identity is unchanged by a pending approval, so a cached Laso
    // token stays valid — preserve it.
    ...(existing?.lasoToken ? { lasoToken: existing.lasoToken } : {}),
    pendingApproval: pending,
  })
}

/**
 * Clear pending approval from config.
 */
export function clearPendingApproval(): void {
  const existing = readConfig()
  if (!existing) return
  const { pendingApproval: _, version: __, ...rest } = existing
  writeConfig(rest)
}

/**
 * Promote a pending approval to active config.
 * Called by `setup finish` when the approval is resolved.
 */
export function promotePending(agentAccount: `0x${string}`): JsonEnvelope<{
  agentKeyAddress: string
  agentAccount: string
  status: ConfigStatus
}> {
  const existing = readConfig()
  if (!existing?.pendingApproval) {
    return err("NO_PENDING", "No pending approval to promote")
  }

  // Drop lasoToken alongside the old key: the active identity changes here, so
  // a token minted under the previous key no longer matches. readLasoToken
  // would reject it anyway; dropping it keeps the file honest.
  const { agentKey: _oldKey, lasoToken: _lasoToken, pendingApproval, version: _version, ...rest } = existing
  const agentKeyAddress = privateKeyToAddress(pendingApproval.agentKey)

  // Promote: pending key becomes active, pending cleared
  writeConfig({
    ...rest,
    agentKey: pendingApproval.agentKey,
    agentAccount,
    // pendingApproval intentionally omitted — cleared on promote
  })

  return ok({
    agentKeyAddress,
    agentAccount,
    status: "ready" as ConfigStatus,
  })
}

/**
 * Cache a Laso Bearer token, preserving the rest of the config file.
 * The token is stamped with the identity/URL it was minted under so
 * `readLasoToken` can reject it after an env-var or config change.
 *
 * No-op when credentials come purely from env vars (no file to write): the
 * config file is the only cache, and we don't create one just to hold a token.
 */
export function storeLasoToken(token: LasoToken): void {
  const existing = readConfig()
  if (!existing) return
  const { version: _version, ...rest } = existing
  writeConfig({ ...rest, lasoToken: token })
}

/**
 * Read the cached Laso token, or null if there's no usable one. Treated as
 * absent when: no token cached, expired, or its stamped `agentKey`/`apiUrl`
 * no longer match the active credentials (covers env-var overrides and any
 * write path that forgot to drop it). Self-correcting by construction.
 */
export function readLasoToken(active: ResolvedCredentials): LasoToken | null {
  const stored = readConfig()?.lasoToken
  if (!stored) return null
  if (new Date(stored.expiresAt).getTime() <= Date.now()) return null
  if (stored.agentKey !== active.agentKey) return null
  // apiUrl absent on either side means production default; normalize so an
  // explicit prod URL and an implicit one are treated as the same context.
  const storedUrl = stored.apiUrl ?? DEFAULT_API_URL
  const activeUrl = active.apiUrl ?? DEFAULT_API_URL
  if (storedUrl !== activeUrl) return null
  return stored
}

/** Configuration source */
export type CredentialSource = "env" | "file" | "none"

/** Data returned by getStatus */
export interface StatusData {
  status: ConfigStatus
  credentialSource: CredentialSource
  configPath?: string
  agentKeyAddress?: string
  agentAccount?: string
  apiUrl?: string
  pendingApproval?: {
    agentKeyAddress: string
    expired: boolean
  }
}

/**
 * Get current configuration status.
 * Checks env vars first (takes precedence), then config file.
 */
export function getStatus(): JsonEnvelope<StatusData> {
  // Check env vars first (takes precedence)
  try {
    const envConfig = parseEnvConfig()
    const apiUrl = envConfig.API_URL
    const agentKeyAddress = privateKeyToAddress(envConfig.AGENT_KEY as `0x${string}`)
    const agentAccount = envConfig.AGENT_ACCOUNT

    const result: StatusData = {
      status: "ready",
      credentialSource: "env",
      agentKeyAddress,
      agentAccount,
    }

    if (existsSync(CONFIG_FILE)) {
      result.configPath = CONFIG_FILE
    }

    if (apiUrl && apiUrl !== DEFAULT_API_URL) {
      result.apiUrl = apiUrl
    }

    return ok(result)
  } catch {
    // No env vars, check file
  }

  // Check config file
  const config = getRuntimeConfig()
  if (!config) {
    return ok({ status: "not_initialized", credentialSource: "none" })
  }

  // Determine effective API URL (env var takes precedence over file)
  const envApiUrl = process.env.AMPERSEND_API_URL
  const effectiveApiUrl = envApiUrl ?? config.apiUrl

  const result: StatusData = {
    status: config.status,
    credentialSource: "file",
    configPath: CONFIG_FILE,
  }

  if (config.agentKey) {
    result.agentKeyAddress = privateKeyToAddress(config.agentKey)
  }

  if (config.agentAccount) {
    result.agentAccount = config.agentAccount
  }

  if (effectiveApiUrl && effectiveApiUrl !== DEFAULT_API_URL) {
    result.apiUrl = effectiveApiUrl
  }

  // Always show pending approval info if present
  if (config.pendingApproval) {
    const pendingKeyAddress = privateKeyToAddress(config.pendingApproval.agentKey)
    result.pendingApproval = {
      agentKeyAddress: pendingKeyAddress,
      expired: isPendingExpired(config.pendingApproval),
    }
  }

  return ok(result)
}
