import { readFileSync } from "node:fs"

import type { Command } from "commander"

import { ApiClient } from "../../ampersend/client.ts"
import { parseEnvConfig } from "../../ampersend/env.ts"
import {
  HostedEndpointClient,
  type AllowedMethod,
  type HostedEndpointInput,
  type HostedEndpointUpdate,
} from "../../ampersend/hosted-endpoint.ts"
import { DEFAULT_API_URL, getConfigStatus, getRuntimeConfig } from "../config.ts"
import { err, ok, type JsonEnvelope } from "../envelope.ts"
import { importFromOpenApi } from "../openapi-import.ts"

const ALLOWED_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const
const ALLOWED_METHOD_SET = new Set<string>(ALLOWED_METHODS)

// ── Config loader (mirror fetch.ts) ──────────────────────────────────────────

interface ResolvedConfig {
  agentAccount: `0x${string}`
  agentKey: `0x${string}`
  apiUrl: string
}

function loadConfig(): { ok: true; config: ResolvedConfig } | { ok: false; error: JsonEnvelope<never> } {
  try {
    const envConfig = parseEnvConfig()
    return {
      ok: true,
      config: {
        agentAccount: envConfig.AGENT_ACCOUNT as `0x${string}`,
        agentKey: envConfig.AGENT_KEY as `0x${string}`,
        apiUrl: envConfig.API_URL ?? DEFAULT_API_URL,
      },
    }
  } catch {
    // Fall through to file config
  }

  const fileConfig = getRuntimeConfig()
  if (fileConfig?.status === "ready" && fileConfig.agentAccount && fileConfig.agentKey) {
    const apiUrl = process.env.AMPERSEND_API_URL ?? fileConfig.apiUrl ?? DEFAULT_API_URL
    return {
      ok: true,
      config: {
        agentAccount: fileConfig.agentAccount,
        agentKey: fileConfig.agentKey,
        apiUrl,
      },
    }
  }

  const status = getConfigStatus()
  return {
    ok: false,
    error: err(
      status.status === "not_initialized" ? "NOT_CONFIGURED" : "SETUP_INCOMPLETE",
      'Run "ampersend setup start" or "ampersend config set" to configure',
      { status: status.status },
    ),
  }
}

function buildClients(config: ResolvedConfig): { api: ApiClient; endpoints: HostedEndpointClient } {
  const api = new ApiClient({
    baseUrl: config.apiUrl,
    agentAddress: config.agentAccount,
    sessionKeyPrivateKey: config.agentKey,
  })
  const endpoints = new HostedEndpointClient({
    apiUrl: config.apiUrl,
    getToken: () => api.getAuthToken(),
  })
  return { api, endpoints }
}

async function printAndExit<T>(envelope: JsonEnvelope<T>): Promise<never> {
  console.log(JSON.stringify(envelope, null, 2))
  process.exit(envelope.ok ? 0 : 1)
}

async function withClients<T>(
  operation: (deps: { config: ResolvedConfig; endpoints: HostedEndpointClient }) => Promise<JsonEnvelope<T>>,
): Promise<never> {
  const result = loadConfig()
  if (!result.ok) {
    return printAndExit(result.error)
  }
  try {
    const { endpoints } = buildClients(result.config)
    const envelope = await operation({ config: result.config, endpoints })
    return printAndExit(envelope)
  } catch (error) {
    return printAndExit(err("API_ERROR", error instanceof Error ? error.message : String(error)))
  }
}

// ── Parsing helpers ──────────────────────────────────────────────────────────

function parseHeadersArg(values: Array<string> | undefined): Record<string, string> {
  const headers: Record<string, string> = {}
  for (const h of values ?? []) {
    const idx = h.indexOf(":")
    if (idx === -1) {
      throw new Error(`Invalid header "${h}" — expected "Key: Value"`)
    }
    headers[h.slice(0, idx).trim()] = h.slice(idx + 1).trim()
  }
  return headers
}

function parseMethods(value: string | undefined): Array<AllowedMethod> | undefined {
  if (value == null) return undefined
  const methods = value
    .split(",")
    .map((m) => m.trim().toUpperCase())
    .filter((m) => m.length > 0)
  const invalid = methods.filter((m) => !ALLOWED_METHOD_SET.has(m))
  if (invalid.length > 0) {
    throw new Error(
      `--methods contains unsupported value(s): ${invalid.join(", ")}. Allowed: ${ALLOWED_METHODS.join(", ")}`,
    )
  }
  return methods as Array<AllowedMethod>
}

// ── Subcommand handlers ──────────────────────────────────────────────────────

interface CreateOptions {
  name: string
  priceUsd: string
  proxyUrl: string
  description?: string
  methods?: string
  timeout?: string
  rateLimit?: string
  proxyHeader?: Array<string>
  requiredHeader?: Array<string>
}

function buildCreateInput(options: CreateOptions): HostedEndpointInput {
  const priceUsd = Number(options.priceUsd)
  if (!Number.isFinite(priceUsd) || priceUsd <= 0) {
    throw new Error("--price-usd must be a positive number")
  }

  const proxyHeaders = parseHeadersArg(options.proxyHeader)
  const requiredHeaderNames = (options.requiredHeader ?? []).map((h) => h.trim()).filter((h) => h.length > 0)
  const required_headers: Record<string, string> = {}
  for (const name of requiredHeaderNames) {
    required_headers[name] = ""
  }

  const methods = parseMethods(options.methods)

  let timeout: number | undefined
  if (options.timeout != null) {
    timeout = Number(options.timeout)
    if (!Number.isFinite(timeout)) throw new Error("--timeout must be a number (ms)")
  }

  let rateLimit: number | undefined
  if (options.rateLimit != null) {
    rateLimit = Number(options.rateLimit)
    if (!Number.isFinite(rateLimit) || rateLimit < 0) {
      throw new Error("--rate-limit must be a non-negative integer")
    }
  }

  return {
    name: options.name,
    price_usd: priceUsd,
    proxy_url: options.proxyUrl,
    ...(options.description != null ? { description: options.description } : {}),
    ...(methods && methods.length > 0 ? { allowed_methods: methods } : {}),
    ...(timeout != null ? { proxy_timeout_ms: timeout } : {}),
    ...(rateLimit != null ? { rate_limit_per_minute: rateLimit } : {}),
    ...(Object.keys(proxyHeaders).length > 0 ? { proxy_headers: proxyHeaders } : {}),
    ...(Object.keys(required_headers).length > 0 ? { required_headers } : {}),
  }
}

interface UpdateOptions {
  name?: string
  priceUsd?: string
  proxyUrl?: string
  description?: string
  methods?: string
  timeout?: string
  rateLimit?: string
  enabled?: boolean
}

function buildUpdatePayload(options: UpdateOptions): HostedEndpointUpdate {
  let price: number | undefined
  if (options.priceUsd != null) {
    price = Number(options.priceUsd)
    if (!Number.isFinite(price) || price <= 0) throw new Error("--price-usd must be a positive number")
  }

  let timeout: number | undefined
  if (options.timeout != null) {
    timeout = Number(options.timeout)
    if (!Number.isFinite(timeout)) throw new Error("--timeout must be a number (ms)")
  }

  let rateLimit: number | undefined
  if (options.rateLimit != null) {
    rateLimit = Number(options.rateLimit)
    if (!Number.isFinite(rateLimit) || rateLimit < 0) {
      throw new Error("--rate-limit must be a non-negative integer")
    }
  }

  const methods = options.methods != null ? parseMethods(options.methods) : undefined

  return {
    ...(options.name != null ? { name: options.name } : {}),
    ...(price != null ? { price_usd: price } : {}),
    ...(options.proxyUrl != null ? { proxy_url: options.proxyUrl } : {}),
    ...(options.description != null ? { description: options.description } : {}),
    ...(methods && methods.length > 0 ? { allowed_methods: methods } : {}),
    ...(timeout != null ? { proxy_timeout_ms: timeout } : {}),
    ...(rateLimit != null ? { rate_limit_per_minute: rateLimit } : {}),
    ...(options.enabled != null ? { enabled: options.enabled } : {}),
  }
}

// ── Registration ─────────────────────────────────────────────────────────────

export function registerEndpointCommand(program: Command): void {
  const endpoint = program.command("endpoint").description("Manage hosted endpoints for this agent")

  endpoint
    .command("list")
    .description("List hosted endpoints for the configured agent")
    .action(async () => {
      await withClients(async ({ config, endpoints }) => {
        const list = await endpoints.list(config.agentAccount)
        return ok({ endpoints: list })
      })
    })

  endpoint
    .command("get <id>")
    .description("Show a single hosted endpoint by ID")
    .action(async (id: string) => {
      await withClients(async ({ config, endpoints }) => {
        const ep = await endpoints.get(config.agentAccount, id)
        return ok(ep)
      })
    })

  endpoint
    .command("create")
    .description("Create a new hosted endpoint")
    .requiredOption("--name <name>", "Display name")
    .requiredOption("--price-usd <price>", "Price per call in USD (e.g. 0.01)")
    .requiredOption("--proxy-url <url>", "Backend HTTPS URL the gateway will forward to")
    .option("--description <text>", "Description shown in discovery / 402 response")
    .option("--methods <csv>", "Allowed HTTP methods, comma-separated (default: GET)")
    .option("--timeout <ms>", "Proxy timeout in milliseconds (5000–60000, default 30000)")
    .option("--rate-limit <per-minute>", "Global rate limit per minute")
    .option("--proxy-header <header...>", 'Proxy header to forward (format: "Key: Value")')
    .option("--required-header <name...>", "Required header name (without value) that buyers must send")
    .action(async (options: CreateOptions) => {
      await withClients(async ({ config, endpoints }) => {
        const input = buildCreateInput(options)
        const created = await endpoints.create(config.agentAccount, input)
        return ok(created)
      })
    })

  endpoint
    .command("update <id>")
    .description("Update fields on a hosted endpoint")
    .option("--name <name>")
    .option("--price-usd <price>")
    .option("--proxy-url <url>")
    .option("--description <text>")
    .option("--methods <csv>")
    .option("--timeout <ms>")
    .option("--rate-limit <per-minute>")
    .option("--enabled <bool>", "true or false", (value) => value === "true")
    .action(async (id: string, options: UpdateOptions) => {
      await withClients(async ({ config, endpoints }) => {
        const payload = buildUpdatePayload(options)
        const updated = await endpoints.update(config.agentAccount, id, payload)
        return ok(updated)
      })
    })

  endpoint
    .command("delete <id>")
    .description("Soft-delete a hosted endpoint (sets deleted_at)")
    .action(async (id: string) => {
      await withClients(async ({ config, endpoints }) => {
        await endpoints.delete(config.agentAccount, id)
        return ok({ deleted: id })
      })
    })

  endpoint
    .command("enable <id>")
    .description("Enable a hosted endpoint")
    .action(async (id: string) => {
      await withClients(async ({ config, endpoints }) => {
        const updated = await endpoints.update(config.agentAccount, id, { enabled: true })
        return ok(updated)
      })
    })

  endpoint
    .command("disable <id>")
    .description("Disable a hosted endpoint")
    .action(async (id: string) => {
      await withClients(async ({ config, endpoints }) => {
        const updated = await endpoints.update(config.agentAccount, id, { enabled: false })
        return ok(updated)
      })
    })

  endpoint
    .command("test <id>")
    .description("Run a synthetic test request against the endpoint's backend")
    .action(async (id: string) => {
      await withClients(async ({ config, endpoints }) => {
        const result = await endpoints.test(config.agentAccount, id)
        return ok(result)
      })
    })

  const headers = endpoint.command("headers").description("Manage proxy and required headers on an endpoint")

  headers
    .command("add-proxy <id>")
    .description("Add a forwarded proxy header")
    .requiredOption("--name <name>", "Header name (RFC 7230 token chars only)")
    .requiredOption("--value <value>", "Header value")
    .action(async (id: string, options: { name: string; value: string }) => {
      await withClients(async ({ config, endpoints }) => {
        const updated = await endpoints.addProxyHeader(config.agentAccount, id, {
          name: options.name,
          value: options.value,
        })
        return ok(updated)
      })
    })

  headers
    .command("remove-proxy <id> <name>")
    .description("Remove a forwarded proxy header by name")
    .action(async (id: string, name: string) => {
      await withClients(async ({ config, endpoints }) => {
        const updated = await endpoints.removeProxyHeader(config.agentAccount, id, name)
        return ok(updated)
      })
    })

  headers
    .command("add-required <id>")
    .description("Add a required header that buyers must send")
    .requiredOption("--name <name>", "Header name")
    .action(async (id: string, options: { name: string }) => {
      await withClients(async ({ config, endpoints }) => {
        const updated = await endpoints.addRequiredHeader(config.agentAccount, id, { name: options.name })
        return ok(updated)
      })
    })

  headers
    .command("remove-required <id> <name>")
    .description("Remove a required header by name")
    .action(async (id: string, name: string) => {
      await withClients(async ({ config, endpoints }) => {
        const updated = await endpoints.removeRequiredHeader(config.agentAccount, id, name)
        return ok(updated)
      })
    })

  endpoint
    .command("rotate-secret <id>")
    .description("Rotate the endpoint's HMAC signing secret")
    .action(async (id: string) => {
      await withClients(async ({ config, endpoints }) => {
        const result = await endpoints.rotateSigningSecret(config.agentAccount, id)
        return ok(result)
      })
    })

  endpoint
    .command("import <spec>")
    .description("Bulk import endpoints from an OpenAPI 3.0/3.1 spec file")
    .option("--base-url <url>", "Override the server base URL from the spec")
    .option("--default-price <usd>", "Default price per endpoint when the spec has no x-ampersend-price", "0.01")
    .option("--timeout <ms>", "Proxy timeout in milliseconds for every imported endpoint")
    .option("--dry-run", "Parse and print the planned endpoints without calling the API", false)
    .action(
      async (
        specPath: string,
        options: { baseUrl?: string; defaultPrice: string; timeout?: string; dryRun: boolean },
      ) => {
        await withClients<{
          dryRun: boolean
          count: number
          created?: number
          endpoints: ReadonlyArray<unknown>
        }>(async ({ config, endpoints }) => {
          let spec: unknown
          try {
            const raw = readFileSync(specPath, "utf-8")
            spec = specPath.endsWith(".json") ? JSON.parse(raw) : tryYamlOrJson(raw)
          } catch (error) {
            return err("SPEC_READ_ERROR", `Failed to read spec: ${error instanceof Error ? error.message : error}`)
          }

          let planned: Array<HostedEndpointInput>
          try {
            planned = importFromOpenApi(spec, {
              ...(options.baseUrl != null ? { baseUrl: options.baseUrl } : {}),
              defaultPrice: Number(options.defaultPrice),
              ...(options.timeout != null ? { proxyTimeoutMs: Number(options.timeout) } : {}),
            })
          } catch (error) {
            return err("SPEC_PARSE_ERROR", error instanceof Error ? error.message : String(error))
          }

          if (options.dryRun) {
            return ok({ dryRun: true, count: planned.length, endpoints: planned })
          }

          if (planned.length === 0) {
            return err("NO_ENDPOINTS", "OpenAPI spec produced zero endpoints")
          }

          const created = await endpoints.bulkCreate(config.agentAccount, planned)
          return ok({
            dryRun: false,
            count: created.length,
            created: created.length,
            endpoints: created,
          })
        })
      },
    )
}

function tryYamlOrJson(raw: string): unknown {
  // Minimal JSON-only fallback. YAML support can be added later if needed.
  // We prefer explicit JSON parsing to avoid adding a YAML dependency for MVP.
  return JSON.parse(raw)
}
