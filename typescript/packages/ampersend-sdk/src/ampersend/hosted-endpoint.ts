import { Schema } from "effect"

import { Address, ApiError } from "./types.js"

// ============ Schemas ============

export const Network = Schema.Literal("base", "base-sepolia")
export type Network = typeof Network.Type

export const AllowedMethod = Schema.Literal("GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS")
export type AllowedMethod = typeof AllowedMethod.Type

export const Instructions = Schema.Struct({ markdown: Schema.String })
export type Instructions = typeof Instructions.Type

export const HostedEndpointInput = Schema.Struct({
  name: Schema.NonEmptyTrimmedString,
  price_usd: Schema.Number.pipe(Schema.positive()),
  proxy_url: Schema.NonEmptyTrimmedString,
  allowed_methods: Schema.optional(Schema.Array(AllowedMethod)),
  description: Schema.optional(Schema.String),
  instructions: Schema.optional(Schema.NullOr(Instructions)),
  proxy_headers: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.String })),
  proxy_timeout_ms: Schema.optional(Schema.Number.pipe(Schema.between(5000, 60000))),
  rate_limit_per_minute: Schema.optional(Schema.NonNegativeInt),
  required_headers: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.Unknown })),
})
export type HostedEndpointInput = typeof HostedEndpointInput.Type

export const HostedEndpointUpdate = Schema.Struct({
  allowed_methods: Schema.optional(Schema.Array(AllowedMethod)),
  description: Schema.optional(Schema.String),
  enabled: Schema.optional(Schema.Boolean),
  instructions: Schema.optional(Schema.NullOr(Instructions)),
  name: Schema.optional(Schema.NonEmptyTrimmedString),
  price_usd: Schema.optional(Schema.Number.pipe(Schema.positive())),
  proxy_timeout_ms: Schema.optional(Schema.Number.pipe(Schema.between(5000, 60000))),
  proxy_url: Schema.optional(Schema.NonEmptyTrimmedString),
  rate_limit_per_minute: Schema.optional(Schema.NonNegativeInt),
})
export type HostedEndpointUpdate = typeof HostedEndpointUpdate.Type

export const AddProxyHeaderRequest = Schema.Struct({
  name: Schema.NonEmptyTrimmedString,
  value: Schema.String,
})
export type AddProxyHeaderRequest = typeof AddProxyHeaderRequest.Type

export const AddRequiredHeaderRequest = Schema.Struct({
  name: Schema.NonEmptyTrimmedString,
})
export type AddRequiredHeaderRequest = typeof AddRequiredHeaderRequest.Type

// Server transports epoch millis as either number or numeric string across JSON.
const ConvertedTimestamp = Schema.Union(
  Schema.NonNegativeInt,
  Schema.NumberFromString.pipe(Schema.int(), Schema.nonNegative()),
)

export class HostedEndpointDTO extends Schema.Class<HostedEndpointDTO>("HostedEndpointDTO")({
  id: Schema.NonEmptyTrimmedString,
  agent_address: Address,
  agent_slug: Schema.NullOr(Schema.NonEmptyTrimmedString),
  /** Null until the owner's namespace + agent slug are claimed; treat null as "not yet reachable". */
  access_url: Schema.NullOr(Schema.NonEmptyTrimmedString),
  slug: Schema.NonEmptyTrimmedString,
  name: Schema.NonEmptyTrimmedString,
  description: Schema.String,
  price_usd: Schema.Number,
  network: Network,
  proxy_url: Schema.NonEmptyTrimmedString,
  proxy_timeout_ms: Schema.NonNegativeInt,
  allowed_methods: Schema.Array(Schema.NonEmptyTrimmedString),
  proxy_header_names: Schema.Array(Schema.NonEmptyTrimmedString),
  required_header_names: Schema.Array(Schema.NonEmptyTrimmedString),
  rate_limit_per_minute: Schema.NonNegativeInt,
  instructions: Schema.NullOr(Instructions),
  enabled: Schema.Boolean,
  created_at: ConvertedTimestamp,
  updated_at: ConvertedTimestamp,
  deleted_at: Schema.NullOr(ConvertedTimestamp),
}) {}

export const HostedEndpointList = Schema.Array(HostedEndpointDTO)
export type HostedEndpointList = typeof HostedEndpointList.Type

export const BulkCreateResponse = Schema.Array(HostedEndpointDTO)
export type BulkCreateResponse = typeof BulkCreateResponse.Type

export const TestResponse = Schema.Struct({
  latencyMs: Schema.Number,
  status: Schema.Number,
})
export type TestResponse = typeof TestResponse.Type

export const RotateSecretResponse = Schema.Struct({
  signingSecret: Schema.NonEmptyTrimmedString,
})
export type RotateSecretResponse = typeof RotateSecretResponse.Type

// ============ Client ============

export interface HostedEndpointClientOptions {
  apiUrl: string
  /**
   * Bearer token provider. Can return a cached token or refresh as needed
   * (e.g., delegate to `ApiClient.getAuthToken()`).
   */
  getToken: () => Promise<string>
  timeout?: number
}

/**
 * Authenticated client for the per-agent hosted-endpoint REST API.
 *
 * All routes are scoped by the agent address provided per call.
 * The bearer token must belong to a session key authorized for that agent;
 * cross-agent access returns 403 Forbidden.
 *
 * @example
 * ```typescript
 * import { ApiClient, HostedEndpointClient } from "@ampersend_ai/ampersend-sdk/ampersend"
 *
 * const api = new ApiClient({ baseUrl, agentAddress, sessionKeyPrivateKey })
 * const endpoints = new HostedEndpointClient({
 *   apiUrl: baseUrl,
 *   getToken: () => api.getAuthToken(),
 * })
 *
 * const created = await endpoints.create(agentAddress, {
 *   name: "My Endpoint",
 *   price_usd: 0.01,
 *   proxy_url: "https://api.example.com/data",
 * })
 * ```
 */
export class HostedEndpointClient {
  private readonly baseUrl: string
  private readonly getToken: () => Promise<string>
  private readonly timeout: number

  constructor(options: HostedEndpointClientOptions) {
    this.baseUrl = options.apiUrl.replace(/\/$/, "")
    this.getToken = options.getToken
    this.timeout = options.timeout ?? 30000
  }

  // ── CRUD ────────────────────────────────────────────────────────────────────

  async list(agentAddress: Address): Promise<HostedEndpointList> {
    return this.request("GET", `/api/v1/agents/${agentAddress}/hosted-endpoints`, undefined, HostedEndpointList)
  }

  async get(agentAddress: Address, id: string): Promise<HostedEndpointDTO> {
    return this.request("GET", `/api/v1/agents/${agentAddress}/hosted-endpoints/${id}`, undefined, HostedEndpointDTO)
  }

  async create(agentAddress: Address, payload: HostedEndpointInput): Promise<HostedEndpointDTO> {
    // Server's InsertHostedEndpoint requires agent_address in the body even though
    // the URL is agent-scoped. Keep the path param canonical and mirror it into the body.
    return this.request(
      "POST",
      `/api/v1/agents/${agentAddress}/hosted-endpoints`,
      { ...payload, agent_address: agentAddress },
      HostedEndpointDTO,
    )
  }

  /**
   * Bulk create endpoints in a single transaction.
   * Any validation or uniqueness failure rolls back the entire batch.
   */
  async bulkCreate(agentAddress: Address, endpoints: ReadonlyArray<HostedEndpointInput>): Promise<BulkCreateResponse> {
    return this.request(
      "POST",
      `/api/v1/agents/${agentAddress}/hosted-endpoints/bulk`,
      { endpoints: endpoints.map((e) => ({ ...e, agent_address: agentAddress })) },
      BulkCreateResponse,
    )
  }

  async update(agentAddress: Address, id: string, payload: HostedEndpointUpdate): Promise<HostedEndpointDTO> {
    return this.request("PATCH", `/api/v1/agents/${agentAddress}/hosted-endpoints/${id}`, payload, HostedEndpointDTO)
  }

  async delete(agentAddress: Address, id: string): Promise<void> {
    await this.request("DELETE", `/api/v1/agents/${agentAddress}/hosted-endpoints/${id}`, undefined, Schema.Unknown)
  }

  async test(agentAddress: Address, id: string): Promise<TestResponse> {
    return this.request("POST", `/api/v1/agents/${agentAddress}/hosted-endpoints/${id}/test`, {}, TestResponse)
  }

  // ── Headers ─────────────────────────────────────────────────────────────────

  async addProxyHeader(agentAddress: Address, id: string, header: AddProxyHeaderRequest): Promise<HostedEndpointDTO> {
    return this.request(
      "POST",
      `/api/v1/agents/${agentAddress}/hosted-endpoints/${id}/proxy-headers`,
      header,
      HostedEndpointDTO,
    )
  }

  async removeProxyHeader(agentAddress: Address, id: string, name: string): Promise<HostedEndpointDTO> {
    return this.request(
      "DELETE",
      `/api/v1/agents/${agentAddress}/hosted-endpoints/${id}/proxy-headers/${encodeURIComponent(name)}`,
      undefined,
      HostedEndpointDTO,
    )
  }

  async addRequiredHeader(
    agentAddress: Address,
    id: string,
    header: AddRequiredHeaderRequest,
  ): Promise<HostedEndpointDTO> {
    return this.request(
      "POST",
      `/api/v1/agents/${agentAddress}/hosted-endpoints/${id}/required-headers`,
      header,
      HostedEndpointDTO,
    )
  }

  async removeRequiredHeader(agentAddress: Address, id: string, name: string): Promise<HostedEndpointDTO> {
    return this.request(
      "DELETE",
      `/api/v1/agents/${agentAddress}/hosted-endpoints/${id}/required-headers/${encodeURIComponent(name)}`,
      undefined,
      HostedEndpointDTO,
    )
  }

  // ── Secrets ─────────────────────────────────────────────────────────────────

  async rotateSigningSecret(agentAddress: Address, id: string): Promise<RotateSecretResponse> {
    return this.request(
      "POST",
      `/api/v1/agents/${agentAddress}/hosted-endpoints/${id}/rotate-secret`,
      {},
      RotateSecretResponse,
    )
  }

  // ── Internal ────────────────────────────────────────────────────────────────

  private async request<A, I>(method: string, path: string, body: unknown, schema: Schema.Schema<A, I>): Promise<A> {
    const token = await this.getToken()
    const url = `${this.baseUrl}${path}`
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
    }
    if (body !== undefined) {
      headers["Content-Type"] = "application/json"
    }

    try {
      const init: RequestInit = {
        method,
        headers,
        signal: AbortSignal.timeout(this.timeout),
      }
      if (body !== undefined) {
        init.body = JSON.stringify(body)
      }

      const response = await globalThis.fetch(url, init)

      if (!response.ok) {
        const errorBody = await response.text().catch(() => "")
        const errorMessage = errorBody
          ? `HTTP ${response.status} ${response.statusText}: ${errorBody}`
          : `HTTP ${response.status} ${response.statusText}`
        throw new ApiError(errorMessage, response.status, response)
      }

      // DELETE and a few others may return empty bodies; tolerate that when caller passes Schema.Unknown
      if (response.status === 204 || response.headers.get("content-length") === "0") {
        return undefined as A
      }

      // Tolerate 200 with empty body (common for side-effecting endpoints that omit Content-Length)
      const rawBody = await response.text()
      if (rawBody.length === 0) {
        return undefined as A
      }

      let data: unknown
      try {
        data = JSON.parse(rawBody)
      } catch (parseError) {
        throw new ApiError(`Invalid JSON response: ${parseError}`, response.status, response)
      }

      try {
        return Schema.decodeUnknownSync(schema)(data)
      } catch (decodeError) {
        throw new ApiError(`Invalid response shape: ${decodeError}`, response.status, response)
      }
    } catch (error) {
      if (error instanceof ApiError) {
        throw error
      }
      // AbortSignal.timeout() yields a DOMException named "TimeoutError"; keep "AbortError" for legacy/other abort paths.
      if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
        throw new ApiError(`Request timeout after ${this.timeout}ms`)
      }
      throw new ApiError(`Request failed: ${error}`)
    }
  }
}
