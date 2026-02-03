import { Schema } from "effect"
import type { Address, Hex } from "viem"
import { privateKeyToAccount } from "viem/accounts"

import { Address as AddressSchema, ApiError } from "./types.js"

const DEFAULT_API_URL = "https://api.ampersend.ai"

// ============ Response Schemas ============

export class AgentInitData extends Schema.Class<AgentInitData>("AgentInitData")({
  address: Schema.optional(Schema.String),
  factory: Schema.optional(Schema.String),
  factoryData: Schema.optional(Schema.String),
  intentExecutorInstalled: Schema.optional(Schema.Boolean),
}) {}

export class AgentResponse extends Schema.Class<AgentResponse>("AgentResponse")({
  address: AddressSchema,
  name: Schema.NonEmptyTrimmedString,
  user_id: Schema.String,
  balance: Schema.String,
  init_data: AgentInitData,
  nonce: Schema.String,
  created_at: Schema.Number,
  updated_at: Schema.Number,
}) {}

/** Response from the prepare endpoint, used to create a signed agent deployment. */
export class PrepareAgentResponse extends Schema.Class<PrepareAgentResponse>("PrepareAgentResponse")({
  agent_address: AddressSchema,
  init_data: AgentInitData,
  nonce: Schema.String,
  recovery_address: AddressSchema,
  owners: Schema.Array(AddressSchema),
  unsigned_user_op: Schema.Unknown,
  user_op_hash: Schema.String,
  expires_at: Schema.Number,
  server_signature: Schema.String,
}) {}

// ============ Request Types ============

export interface SpendConfig {
  autoTopupAllowed?: boolean
  dailyLimit?: bigint
  monthlyLimit?: bigint
  perTransactionLimit?: bigint
}

export interface CreateAgentOptions {
  name: string
  privateKey: Hex
  spendConfig?: SpendConfig
  authorizedSellers?: Array<Address>
}

// ============ Helpers ============

function serializeSpendConfig(sc: SpendConfig): Record<string, unknown> {
  return {
    auto_topup_allowed: sc.autoTopupAllowed ?? false,
    daily_limit: sc.dailyLimit != null ? String(sc.dailyLimit) : null,
    monthly_limit: sc.monthlyLimit != null ? String(sc.monthlyLimit) : null,
    per_transaction_limit: sc.perTransactionLimit != null ? String(sc.perTransactionLimit) : null,
  }
}

/**
 * Client for managing agents via API key authentication.
 *
 * Handles the prepare → sign → submit deployment flow.
 * The private key is used only locally to derive the address and sign
 * the deployment UserOp; it is never sent to the server.
 *
 * @example
 * ```typescript
 * const client = new AmpersendManagementClient({ apiKey: "amp_..." })
 * const agent = await client.createAgent({
 *   name: "my-agent",
 *   privateKey: "0x...",
 * })
 * ```
 */
export class AmpersendManagementClient {
  private apiKey: string
  private baseUrl: string
  private timeout: number

  constructor(options: { apiKey: string; apiUrl?: string; timeout?: number }) {
    this.apiKey = options.apiKey
    this.baseUrl = (options.apiUrl ?? DEFAULT_API_URL).replace(/\/$/, "")
    this.timeout = options.timeout ?? 30000
  }

  /**
   * Create and deploy a new agent on-chain.
   *
   * Handles the full prepare → sign → submit flow.
   */
  async createAgent(options: CreateAgentOptions): Promise<AgentResponse> {
    const account = privateKeyToAccount(options.privateKey)
    const agentKeyAddress = account.address

    // 1. Prepare unsigned UserOp
    const params = new URLSearchParams({ agent_key_address: agentKeyAddress })
    const prepareResponse = await this.fetch(
      "GET",
      `/api/v1/sdk/agents/prepare?${params.toString()}`,
      undefined,
      PrepareAgentResponse,
    )

    // 2. Sign the UserOp hash (personal_sign of the raw hash bytes)
    const userOpHash = prepareResponse.user_op_hash
    const signature = await account.signMessage({ message: { raw: userOpHash as Hex } })

    // 3. Build create payload
    const payload = {
      signature,
      prepare_response: prepareResponse,
      name: options.name,
      keys: [{ address: agentKeyAddress, permission_id: null }],
      spend_config: options.spendConfig ? serializeSpendConfig(options.spendConfig) : null,
      authorized_sellers: options.authorizedSellers ?? null,
    }

    // 4. Submit signed deployment
    return this.fetch("POST", "/api/v1/sdk/agents", payload, AgentResponse)
  }

  /**
   * List all agents belonging to the authenticated user.
   */
  async listAgents(): Promise<Array<AgentResponse>> {
    const data = await this.fetchRaw("GET", "/api/v1/sdk/agents")
    return (data as Array<unknown>).map((agent) => Schema.decodeUnknownSync(AgentResponse)(agent))
  }

  private async fetch<A, I>(method: string, path: string, body: unknown, schema: Schema.Schema<A, I>): Promise<A> {
    const data = await this.fetchRaw(method, path, body)
    return Schema.decodeUnknownSync(schema)(data)
  }

  private async fetchRaw(method: string, path: string, body?: unknown): Promise<unknown> {
    const url = `${this.baseUrl}${path}`
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
    }
    if (body != null) {
      headers["Content-Type"] = "application/json"
    }

    try {
      const init: RequestInit = { method, headers, signal: AbortSignal.timeout(this.timeout) }
      if (body != null) {
        init.body = JSON.stringify(body)
      }
      const response = await globalThis.fetch(url, init)

      if (!response.ok) {
        let errorMessage = `HTTP ${response.status} ${response.statusText}`
        try {
          const errorBody = await response.text()
          if (errorBody) {
            errorMessage += `: ${errorBody}`
          }
        } catch {
          // Ignore error body parsing failures
        }
        throw new ApiError(errorMessage, response.status, response)
      }

      return response.json()
    } catch (error) {
      if (error instanceof ApiError) {
        throw error
      }
      if (error instanceof Error && error.name === "AbortError") {
        throw new ApiError(`Request timeout after ${this.timeout}ms`)
      }
      throw new ApiError(`Request failed: ${error}`)
    }
  }
}
