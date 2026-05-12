import type { HostedEndpointInput } from "../ampersend/hosted-endpoint.ts"

/**
 * Minimal OpenAPI 3.0/3.1 document shape used by the importer.
 * We intentionally don't validate the full spec — we only extract the
 * fields needed to build `HostedEndpointInput` records.
 */
interface OpenApiDocument {
  openapi?: string
  swagger?: string
  info?: { title?: string; description?: string }
  servers?: Array<{ url: string }>
  host?: string
  basePath?: string
  schemes?: Array<string>
  paths?: Record<string, Record<string, OpenApiOperation | unknown>>
}

interface OpenApiOperation {
  operationId?: string
  summary?: string
  description?: string
  [xKey: string]: unknown
}

const STANDARD_METHODS = ["get", "post", "put", "patch", "delete", "head", "options"] as const
type StandardMethod = (typeof STANDARD_METHODS)[number]

function isStandardMethod(m: string): m is StandardMethod {
  return (STANDARD_METHODS as ReadonlyArray<string>).includes(m.toLowerCase())
}

export interface OpenApiImportOptions {
  /** Override the server base URL from the spec (wins over `servers[0].url`). */
  baseUrl?: string
  /** Fallback per-endpoint price (USD) when the operation has no `x-ampersend-price`. */
  defaultPrice: number
  /** Optional proxy timeout override applied to every imported endpoint. */
  proxyTimeoutMs?: number
}

/**
 * Parse an OpenAPI 3.x (or Swagger 2.x) document and return a list of
 * `HostedEndpointInput` records — one per path+method pair.
 *
 * Recognised vendor extensions (per-operation):
 *   x-ampersend-price        (number, USD) — per-call price
 *   x-ampersend-name         (string)      — endpoint display name
 *   x-ampersend-description  (string)      — description override
 *   x-ampersend-rate-limit   (integer)     — rate limit per minute
 */
export function importFromOpenApi(raw: unknown, options: OpenApiImportOptions): Array<HostedEndpointInput> {
  if (typeof raw !== "object" || raw == null) {
    throw new Error("OpenAPI document must be a JSON object")
  }
  const doc = raw as OpenApiDocument

  if (!doc.openapi && !doc.swagger) {
    throw new Error('Not an OpenAPI document: missing "openapi" or "swagger" version field')
  }

  const base = resolveBaseUrl(doc, options.baseUrl)
  if (base == null) {
    throw new Error("Could not resolve a base URL. Pass --base-url to override.")
  }
  if (!/^https?:\/\//i.test(base)) {
    throw new Error(`Resolved base URL must be http(s): got "${base}"`)
  }

  const paths = doc.paths ?? {}
  const results: Array<HostedEndpointInput> = []

  for (const [path, methodMap] of Object.entries(paths)) {
    if (typeof methodMap !== "object" || methodMap == null) continue
    for (const [method, rawOp] of Object.entries(methodMap)) {
      if (!isStandardMethod(method)) continue
      if (typeof rawOp !== "object" || rawOp == null) continue
      const op = rawOp as OpenApiOperation

      const priceUsd = readNumberExtension(op, "x-ampersend-price") ?? options.defaultPrice
      if (!Number.isFinite(priceUsd) || priceUsd <= 0) {
        throw new Error(
          `Invalid price for ${method.toUpperCase()} ${path}: must be a positive number (got ${priceUsd})`,
        )
      }

      const rateLimit = readNumberExtension(op, "x-ampersend-rate-limit")
      const nameOverride = readStringExtension(op, "x-ampersend-name")
      const descriptionOverride = readStringExtension(op, "x-ampersend-description")

      const description = descriptionOverride ?? op.description ?? op.summary
      const input: HostedEndpointInput = {
        name: nameOverride ?? op.summary ?? op.operationId ?? `${method.toUpperCase()} ${path}`,
        price_usd: priceUsd,
        proxy_url: joinUrl(base, path),
        allowed_methods: [
          method.toUpperCase() as unknown as HostedEndpointInput["allowed_methods"] extends
            | ReadonlyArray<infer U>
            | undefined
            ? U
            : never,
        ],
        ...(description != null && description.length > 0 ? { description } : {}),
        ...(rateLimit != null && Number.isFinite(rateLimit) && rateLimit >= 0
          ? { rate_limit_per_minute: rateLimit }
          : {}),
        ...(options.proxyTimeoutMs != null ? { proxy_timeout_ms: options.proxyTimeoutMs } : {}),
      }

      results.push(input)
    }
  }

  return results
}

function resolveBaseUrl(doc: OpenApiDocument, override: string | undefined): string | undefined {
  if (override != null && override.length > 0) {
    return stripTrailingSlash(override)
  }
  if (doc.servers && doc.servers.length > 0 && doc.servers[0]?.url) {
    return stripTrailingSlash(doc.servers[0].url)
  }
  // Swagger 2.x fallback
  if (doc.host) {
    const scheme = doc.schemes?.[0] ?? "https"
    const basePath = doc.basePath ?? ""
    return stripTrailingSlash(`${scheme}://${doc.host}${basePath}`)
  }
  return undefined
}

function stripTrailingSlash(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url
}

function joinUrl(base: string, path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`
  return `${base}${p}`
}

function readNumberExtension(op: OpenApiOperation, key: string): number | undefined {
  const value = op[key]
  if (typeof value === "number") return value
  if (typeof value === "string") {
    const n = Number(value)
    if (Number.isFinite(n)) return n
  }
  return undefined
}

function readStringExtension(op: OpenApiOperation, key: string): string | undefined {
  const value = op[key]
  return typeof value === "string" && value.length > 0 ? value : undefined
}
