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
 * the active context in the config file written by `setup` / `config set`.
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
export function loadCredentials(
  opts: ContextSelector = {},
): { ok: true; credentials: ResolvedCredentials } | { ok: false; error: JsonEnvelope<never> } {
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

  const selected = getSelectedContext(opts)
  if (selected?.context.status === "ready") {
    // AMPERSEND_API_URL is a hard bypass: if set, it always wins.
    const apiUrl = process.env.AMPERSEND_API_URL ?? selected.context.apiUrl
    return {
      ok: true,
      credentials: {
        agentAccount: selected.context.agentAccount,
        agentKey: selected.context.agentKey,
        ...(apiUrl ? { apiUrl } : {}),
      },
    }
  }

  const status = getConfigStatus(opts).status
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
const CONFIG_VERSION = 2

/** Hard-coded approval expiration: 30 minutes */
const APPROVAL_EXPIRY_MS = 30 * 60 * 1000

// Re-export ConfigStatus for consumers
export type { ConfigStatus }

/** Default API URL (production) */
export const DEFAULT_API_URL = "https://api.ampersend.ai"

const HexString = Schema.TemplateLiteral(Schema.Literal("0x"), Schema.String)

/**
 * Cached Laso Bearer token for `card details`/`list`, so a warm read costs
 * nothing. Stamped with the identity (`agentKey`) and `apiUrl` it was minted
 * under: `readLasoToken` treats it as absent if either no longer matches the
 * active context (covers env-var overrides) or it has expired. Self-correcting,
 * so the identity/URL write paths only need to drop it, not re-thread it.
 *
 * Lives inside the context it was minted under, so switching the active context
 * (`config use`) keeps each context's token intact without any explicit drop.
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

// ─── Context model (V2) ──────────────────────────────────────────────────────

/**
 * A named identity in the config. A context is either:
 *  - `ready`:   resolved, carrying an active key + on-chain account (+ optional
 *               per-context apiUrl and cached lasoToken).
 *  - `pending`: an in-flight `setup start` — a generated key plus the approval
 *               token and its local expiry, but no account yet. `setup finish`
 *               promotes it to `ready`.
 *
 * Each context carries its own `apiUrl`, so e.g. a sandbox and a prod context
 * can coexist pointed at different environments.
 */
const ReadyContextSchema = Schema.Struct({
  status: Schema.Literal("ready"),
  agentKey: HexString,
  agentAccount: HexString,
  createdAt: Schema.String, // ISO timestamp the context was first created
  apiUrl: Schema.optional(Schema.String),
  lasoToken: Schema.optional(LasoTokenSchema),
})

const PendingContextSchema = Schema.Struct({
  status: Schema.Literal("pending"),
  agentKey: HexString,
  token: Schema.String,
  expiresAt: Schema.String, // ISO timestamp — informational; `setup finish` lets the API decide
  createdAt: Schema.String, // ISO timestamp the context was first created
  apiUrl: Schema.optional(Schema.String),
})

const ContextSchema = Schema.Union([ReadyContextSchema, PendingContextSchema])

export type ReadyContext = typeof ReadyContextSchema.Type
export type PendingContext = typeof PendingContextSchema.Type
export type Context = typeof ContextSchema.Type

/** Stored configuration V2 — the multi-context model. */
export interface StoredConfigV2 {
  version: 2
  activeContext?: string
  contexts: Record<string, Context>
}

/** Current stored config type */
export type StoredConfig = StoredConfigV2

const StoredConfigV2Schema = Schema.Struct({
  version: Schema.Literal(2),
  activeContext: Schema.optional(Schema.String),
  contexts: Schema.Record(Schema.String, ContextSchema),
})

// ─── Legacy V1 (read-only, for migration) ─────────────────────────────────────

/** Stored configuration V1 (single-account). Read-only — migrated to V2 on load. */
interface StoredConfigV1 {
  version: 1
  agentKey?: `0x${string}`
  agentAccount?: `0x${string}`
  apiUrl?: string
  pendingApproval?: { token: string; agentKey: `0x${string}`; expiresAt: string }
  lasoToken?: LasoToken
}

const StoredConfigV1Schema = Schema.Struct({
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

/** Decodes either version; V1 is normalized to V2 by `readConfig`. */
const StoredConfigSchema = Schema.Union([StoredConfigV2Schema, StoredConfigV1Schema])

/**
 * Migrate a legacy single-account V1 config to the V2 context model. There is
 * no `default` context in V2 — both migrated contexts are auto-named from their
 * key (the same scheme `setup`/`config set` use), and `createdAt` is stamped to
 * the migration time since a V1 file carries no creation timestamp.
 *
 *  - A complete identity (key + account) becomes a `ready` context carrying the
 *    old top-level apiUrl/lasoToken; it becomes active.
 *  - A standalone pending approval becomes a `pending` context. If there was no
 *    active identity, the pending context becomes active.
 *  - A key-only V1 file (no account, no pending) was already non-functional for
 *    reads, so we drop the orphan key and migrate to an empty (not_initialized)
 *    config.
 */
function migrateV1toV2(v1: StoredConfigV1): StoredConfigV2 {
  const config: StoredConfigV2 = { version: 2, contexts: {} }
  const createdAt = new Date().toISOString()

  if (v1.agentKey && v1.agentAccount) {
    const name = uniqueContextName(config, v1.apiUrl, privateKeyToAddress(v1.agentKey))
    config.contexts[name] = {
      status: "ready",
      agentKey: v1.agentKey,
      agentAccount: v1.agentAccount,
      createdAt,
      ...(v1.apiUrl ? { apiUrl: v1.apiUrl } : {}),
      ...(v1.lasoToken ? { lasoToken: v1.lasoToken } : {}),
    }
    config.activeContext = name
  }

  if (v1.pendingApproval) {
    const name = uniqueContextName(config, v1.apiUrl, privateKeyToAddress(v1.pendingApproval.agentKey))
    config.contexts[name] = {
      status: "pending",
      agentKey: v1.pendingApproval.agentKey,
      token: v1.pendingApproval.token,
      expiresAt: v1.pendingApproval.expiresAt,
      createdAt,
      ...(v1.apiUrl ? { apiUrl: v1.apiUrl } : {}),
    }
    config.activeContext ??= name
  }

  return config
}

/** Pending approval payload passed to `startContext` by `setup start`. */
export interface PendingApproval {
  token: string
  agentKey: `0x${string}`
  expiresAt: string
}

/** A context with its name, as returned by lookups. */
export interface NamedContext {
  name: string
  context: Context
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
 * Read config file if it exists, normalized to the V2 context model.
 * Returns null if the file is missing or corrupt.
 */
export function readConfig(): StoredConfigV2 | null {
  if (!existsSync(CONFIG_FILE)) {
    return null
  }
  const content = readFileSync(CONFIG_FILE, "utf-8")
  try {
    const parsed = JSON.parse(content)
    const decoded = Schema.decodeUnknownSync(StoredConfigSchema)(parsed)
    return decoded.version === 1 ? migrateV1toV2(decoded as StoredConfigV1) : (decoded as StoredConfigV2)
  } catch {
    // Corrupt or unrecognised config — treat as absent so commands can re-initialise
    return null
  }
}

/**
 * Drop expired *pending* contexts so the map can't grow without bound. Ready
 * contexts are never auto-pruned (only `config rm` removes them). If the active
 * context is pruned, `activeContext` is cleared.
 */
function prunePendingExpired(config: StoredConfigV2): StoredConfigV2 {
  const contexts: Record<string, Context> = {}
  for (const [name, ctx] of Object.entries(config.contexts)) {
    if (ctx.status === "pending" && isPendingExpired(ctx)) continue
    contexts[name] = ctx
  }
  const activeContext = config.activeContext && contexts[config.activeContext] ? config.activeContext : undefined
  return { version: 2, ...(activeContext ? { activeContext } : {}), contexts }
}

/**
 * Write config file with secure permissions. Always writes V2 and prunes
 * expired pending contexts on the way out.
 */
export function writeConfig(config: Omit<StoredConfigV2, "version">): void {
  ensureConfigDir()
  const pruned = prunePendingExpired({ version: CONFIG_VERSION, ...config })
  writeFileSync(CONFIG_FILE, JSON.stringify(pruned, null, 2), { mode: 0o600 })
}

/**
 * Per-invocation context selection. A `--context <name>` flag wins; otherwise
 * `AMPERSEND_CONTEXT`; otherwise the persisted `activeContext`. Carried by every
 * command so it can target a non-active context without switching.
 */
export interface ContextSelector {
  context?: string | undefined
}

/**
 * The context name to use this invocation: `--context` flag > `AMPERSEND_CONTEXT`
 * env > persisted `activeContext`. Returns undefined if none resolves.
 */
export function resolveContextName(opts: ContextSelector = {}): string | undefined {
  return opts.context ?? process.env.AMPERSEND_CONTEXT ?? readConfig()?.activeContext ?? undefined
}

/**
 * The selected context (name + value) after applying flag/env/active precedence,
 * or null if no config file exists or the resolved name has no context.
 */
export function getSelectedContext(opts: ContextSelector = {}): NamedContext | null {
  const config = readConfig()
  const name = resolveContextName(opts)
  if (!config || !name) return null
  const context = config.contexts[name]
  if (!context) return null
  return { name, context }
}

/**
 * Effective API URL for unauthenticated calls and setup flows.
 * Precedence: AMPERSEND_API_URL (hard bypass) > selected context's apiUrl > default.
 */
export function getActiveApiUrl(opts: ContextSelector = {}): string {
  return process.env.AMPERSEND_API_URL ?? getSelectedContext(opts)?.context.apiUrl ?? DEFAULT_API_URL
}

/**
 * Per-context status for the selected context, for error messages and `status`.
 */
export function getConfigStatus(opts: ContextSelector = {}): { status: ConfigStatus } {
  const selected = getSelectedContext(opts)
  if (!selected) return { status: "not_initialized" }
  return { status: selected.context.status === "ready" ? "ready" : "pending_agent" }
}

/**
 * Check if a pending approval has expired locally.
 */
export function isPendingExpired(pending: { expiresAt: string }): boolean {
  return new Date(pending.expiresAt).getTime() <= Date.now()
}

/**
 * Compute the expiration ISO string for a new approval (now + 30min).
 */
export function computeApprovalExpiry(): string {
  return new Date(Date.now() + APPROVAL_EXPIRY_MS).toISOString()
}

/** Empty V2 config used when starting from scratch. */
function emptyConfig(): StoredConfigV2 {
  return { version: 2, contexts: {} }
}

/** Return a copy of `record` without `key` (avoids dynamic `delete`). */
function omitKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  const { [key]: _omitted, ...rest } = record
  return rest
}

/**
 * Production = the default URL, or no URL at all. Auto-derived context names get
 * the URL host prepended only for non-production environments.
 */
export function isProductionUrl(apiUrl: string | undefined): boolean {
  return !apiUrl || apiUrl === DEFAULT_API_URL
}

/**
 * Auto-derive a context name from the agent key when `--context` is omitted.
 * The base is `ctx-<4 hex of key address>`; non-production URLs prepend the host
 * so contexts targeting different environments stay distinct (e.g.
 * `api.sandbox.ampersend.ai-ctx-1a2b`). Not guaranteed unique on its own —
 * callers go through `uniqueContextName` to disambiguate.
 */
export function autoContextName(apiUrl: string | undefined, keyAddress: string): string {
  const base = `ctx-${keyAddress.slice(2, 6).toLowerCase()}`
  if (isProductionUrl(apiUrl)) return base
  try {
    return `${new URL(apiUrl as string).host}-${base}`
  } catch {
    return base
  }
}

/**
 * An auto-derived context name guaranteed free in `config`. Appends `-2`, `-3`,
 * … if the base name (or a prior counter) is already taken.
 */
export function uniqueContextName(config: StoredConfigV2, apiUrl: string | undefined, keyAddress: string): string {
  const base = autoContextName(apiUrl, keyAddress)
  if (!config.contexts[base]) return base
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`
    if (!config.contexts[candidate]) return candidate
  }
}

/**
 * Set a context's identity directly using "agentKey:::agentAccount" format and
 * make it active. With `--context <name>` the identity is written to that named
 * context (creating or overwriting it); without one, a fresh auto-named context
 * is minted. A context's `apiUrl` is fixed at creation — `setConfig` only sets
 * it on a brand-new context, never edits an existing one's URL.
 */
export function setConfig(
  secret: string,
  opts: { name?: string | undefined; apiUrl?: string | undefined } = {},
): JsonEnvelope<{ agentKeyAddress: string; agentAccount: string; context: string; status: ConfigStatus }> {
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
  if (opts.apiUrl != null) {
    try {
      new URL(opts.apiUrl)
    } catch {
      return err("INVALID_URL", "Invalid URL format.")
    }
  }

  const agentKeyAddress = privateKeyToAddress(agentKey as `0x${string}`)
  const config = readConfig() ?? emptyConfig()
  // Explicit --context names the target (create or overwrite); otherwise mint a
  // fresh auto-named context.
  const name = opts.name ?? uniqueContextName(config, opts.apiUrl, agentKeyAddress)
  const existing = config.contexts[name]
  // The URL is set only on a new context; an explicit opt on creation wins,
  // otherwise inherit the URL an overwritten context already had. lasoToken is
  // intentionally dropped: changing the identity invalidates a token stamped
  // with the old key. createdAt is preserved when overwriting a named context.
  const apiUrl = opts.apiUrl ?? existing?.apiUrl

  config.contexts[name] = {
    status: "ready",
    agentKey: agentKey as `0x${string}`,
    agentAccount: agentAccount as `0x${string}`,
    createdAt: existing?.createdAt ?? new Date().toISOString(),
    ...(apiUrl ? { apiUrl } : {}),
  }
  config.activeContext = name
  writeConfig(config)

  return ok({ agentKeyAddress, agentAccount, context: name, status: "ready" as ConfigStatus })
}

/**
 * Switch the active context without re-running setup. Errors if the name is
 * unknown.
 */
export function useContext(name: string): JsonEnvelope<{ context: string; status: ConfigStatus }> {
  const config = readConfig()
  const context = config?.contexts[name]
  if (!config || !context) {
    return err("UNKNOWN_CONTEXT", `No context named "${name}". Run "ampersend config status" to list contexts.`)
  }
  config.activeContext = name
  writeConfig(config)
  return ok({ context: name, status: context.status === "ready" ? "ready" : "pending_agent" })
}

/**
 * Delete a context. If it was the active one, the active selection is cleared.
 * Errors if the name is unknown.
 */
export function removeContext(name: string): JsonEnvelope<{ context: string; wasActive: boolean }> {
  const config = readConfig()
  if (!config || !config.contexts[name]) {
    return err("UNKNOWN_CONTEXT", `No context named "${name}". Run "ampersend config status" to list contexts.`)
  }
  const wasActive = config.activeContext === name
  config.contexts = omitKey(config.contexts, name)
  if (wasActive) delete config.activeContext
  writeConfig(config)
  return ok({ context: name, wasActive })
}

/**
 * Create a `pending` context from a freshly-requested approval.
 * Called by `setup start`. Makes it active unless `detach` is set.
 */
export function startContext(
  name: string,
  pending: PendingApproval,
  opts: { apiUrl?: string | undefined; detach?: boolean | undefined } = {},
): void {
  const config = readConfig() ?? emptyConfig()
  config.contexts[name] = {
    status: "pending",
    agentKey: pending.agentKey,
    token: pending.token,
    expiresAt: pending.expiresAt,
    createdAt: config.contexts[name]?.createdAt ?? new Date().toISOString(),
    ...(opts.apiUrl && !isProductionUrl(opts.apiUrl) ? { apiUrl: opts.apiUrl } : {}),
  }
  if (!opts.detach) config.activeContext = name
  writeConfig(config)
}

/**
 * Promote a `pending` context to `ready` (key stays, account filled in).
 * Called by `setup finish`. Makes the context active.
 */
export function finishContext(
  name: string,
  agentAccount: `0x${string}`,
): JsonEnvelope<{ agentKeyAddress: string; agentAccount: string; context: string; status: ConfigStatus }> {
  const config = readConfig()
  const context = config?.contexts[name]
  if (!config || !context) {
    return err("UNKNOWN_CONTEXT", `No context named "${name}".`)
  }
  if (context.status !== "pending") {
    return err("NOT_PENDING", `Context "${name}" is already ready. Use "ampersend config use ${name}" to select it.`)
  }

  const agentKeyAddress = privateKeyToAddress(context.agentKey)
  config.contexts[name] = {
    status: "ready",
    agentKey: context.agentKey,
    agentAccount,
    createdAt: context.createdAt,
    ...(context.apiUrl ? { apiUrl: context.apiUrl } : {}),
  }
  config.activeContext = name
  writeConfig(config)

  return ok({ agentKeyAddress, agentAccount, context: name, status: "ready" as ConfigStatus })
}

/**
 * Remove a pending context (e.g. when an approval is rejected). No-op if the
 * context is missing or no longer pending.
 */
export function clearPendingContext(name: string): void {
  const config = readConfig()
  const context = config?.contexts[name]
  if (!config || !context || context.status !== "pending") return
  config.contexts = omitKey(config.contexts, name)
  if (config.activeContext === name) delete config.activeContext
  writeConfig(config)
}

/**
 * Cache a Laso Bearer token on the selected context, preserving the rest of the
 * config. The token is stamped with the identity/URL it was minted under so
 * `readLasoToken` can reject it after an env-var or context change.
 *
 * No-op when the selected context isn't a ready one (e.g. env-only credentials):
 * the config file is the only cache, and we don't create one just to hold a token.
 */
export function storeLasoToken(token: LasoToken, opts: ContextSelector = {}): void {
  const config = readConfig()
  const selected = getSelectedContext(opts)
  if (!config || selected?.context.status !== "ready") return
  config.contexts[selected.name] = { ...selected.context, lasoToken: token }
  writeConfig(config)
}

/**
 * Read the selected context's cached Laso token, or null if there's no usable
 * one. Treated as absent when: no token cached, expired, or its stamped
 * `agentKey`/`apiUrl` no longer match the active credentials (covers env-var
 * overrides). Self-correcting by construction.
 */
export function readLasoToken(active: ResolvedCredentials, opts: ContextSelector = {}): LasoToken | null {
  const ctx = getSelectedContext(opts)?.context
  const stored = ctx?.status === "ready" ? ctx.lasoToken : undefined
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

/** Summary of a single context for `config status`. */
export interface ContextSummary {
  name: string
  status: ConfigStatus
  active: boolean
  createdAt: string
  agentKeyAddress?: string
  agentAccount?: string
  apiUrl?: string
  pendingExpired?: boolean
}

/** Data returned by getStatus */
export interface StatusData {
  status: ConfigStatus
  credentialSource: CredentialSource
  configPath?: string
  agentKeyAddress?: string
  agentAccount?: string
  apiUrl?: string
  activeContext?: string
  contexts?: Array<ContextSummary>
}

/** Build a status summary for one context. */
function summarizeContext(name: string, context: Context, activeName: string | undefined): ContextSummary {
  const summary: ContextSummary = {
    name,
    status: context.status === "ready" ? "ready" : "pending_agent",
    active: name === activeName,
    createdAt: context.createdAt,
    agentKeyAddress: privateKeyToAddress(context.agentKey),
  }
  if (context.status === "ready") {
    summary.agentAccount = context.agentAccount
  } else {
    summary.pendingExpired = isPendingExpired(context)
  }
  if (context.apiUrl && context.apiUrl !== DEFAULT_API_URL) {
    summary.apiUrl = context.apiUrl
  }
  return summary
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
  const config = readConfig()
  if (!config || Object.keys(config.contexts).length === 0) {
    return ok({ status: "not_initialized", credentialSource: "none" })
  }

  // Oldest-first so `config status` lists contexts in a stable creation order.
  const contexts = Object.entries(config.contexts)
    .map(([name, ctx]) => summarizeContext(name, ctx, config.activeContext))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))

  // Hoist the active context's fields to the top level, reusing its summary
  // (built above) rather than re-deriving the key address and account.
  const activeSummary = contexts.find((c) => c.active)
  const result: StatusData = {
    status: activeSummary?.status ?? "not_initialized",
    credentialSource: "file",
    configPath: CONFIG_FILE,
    ...(config.activeContext ? { activeContext: config.activeContext } : {}),
    contexts,
  }

  if (activeSummary) {
    if (activeSummary.agentKeyAddress) result.agentKeyAddress = activeSummary.agentKeyAddress
    if (activeSummary.agentAccount) result.agentAccount = activeSummary.agentAccount
    // Effective API URL for the active context (env var takes precedence).
    const effectiveApiUrl = process.env.AMPERSEND_API_URL ?? activeSummary.apiUrl
    if (effectiveApiUrl && effectiveApiUrl !== DEFAULT_API_URL) {
      result.apiUrl = effectiveApiUrl
    }
  }

  return ok(result)
}
