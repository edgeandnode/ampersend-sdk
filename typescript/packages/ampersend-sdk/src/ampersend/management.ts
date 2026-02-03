import { Schema } from "effect"
import type { Address, Hex } from "viem"
import { entryPoint07Address, getUserOperationHash } from "viem/account-abstraction"
import { privateKeyToAccount } from "viem/accounts"

import { Address as AddressSchema, ApiError } from "./types.js"

const DEFAULT_API_URL = "https://api.ampersend.ai"
const DEFAULT_CHAIN_ID = 84532 // Base Sepolia

// ERC-4337 v0.7 bigint fields that need conversion from hex strings
const USER_OP_BIGINT_FIELDS = new Set([
  "nonce",
  "callGasLimit",
  "verificationGasLimit",
  "preVerificationGas",
  "maxFeePerGas",
  "maxPriorityFeePerGas",
  "paymasterVerificationGasLimit",
  "paymasterPostOpGasLimit",
])

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
  /** Opaque token to pass back to the submit endpoint */
  token: Schema.NonEmptyTrimmedString,
  agent_address: AddressSchema,
  init_data: AgentInitData,
  nonce: Schema.String,
  recovery_address: AddressSchema,
  owners: Schema.Array(AddressSchema),
  unsigned_user_op: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
  user_op_hash: Schema.String,
  expires_at: Schema.Number,
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
  private chainId: number

  constructor(options: { apiKey: string; apiUrl?: string; timeout?: number; chainId?: number }) {
    this.apiKey = options.apiKey
    this.baseUrl = (options.apiUrl ?? DEFAULT_API_URL).replace(/\/$/, "")
    this.timeout = options.timeout ?? 30000
    this.chainId = options.chainId ?? DEFAULT_CHAIN_ID
  }

  /**
   * Create and deploy a new agent on-chain.
   *
   * Handles the full prepare → sign → submit flow.
   * Verifies the server response before signing to prevent malicious operations.
   */
  async createAgent(options: CreateAgentOptions): Promise<AgentResponse> {
    const account = privateKeyToAccount(options.privateKey)
    const agentKeyAddress = account.address

    // 1. Prepare unsigned UserOp (POST with JSON body)
    const prepareResponse = await this.fetch(
      "POST",
      "/api/v1/sdk/agents/prepare",
      { agent_key_address: agentKeyAddress },
      PrepareAgentResponse,
    )

    // 2. Verify the response before signing (Layer 1: basic sanity checks)
    this.verifyPrepareResponse(prepareResponse, agentKeyAddress)

    // 3. Sign the UserOp hash (personal_sign of the raw hash bytes)
    const userOpHash = prepareResponse.user_op_hash
    const signature = await account.signMessage({ message: { raw: userOpHash as Hex } })

    // 4. Build create payload (token-based, not full prepare_response)
    const payload = {
      token: prepareResponse.token,
      signature,
      name: options.name,
      spend_config: options.spendConfig ? serializeSpendConfig(options.spendConfig) : null,
      authorized_sellers: options.authorizedSellers ?? null,
    }

    // 5. Submit signed deployment
    return this.fetch("POST", "/api/v1/sdk/agents", payload, AgentResponse)
  }

  /**
   * Verify the prepare response before signing.
   * Layer 1: Basic sanity checks to prevent signing malicious operations.
   * Layer 2: Hash verification to ensure we sign what we expect.
   */
  private verifyPrepareResponse(response: PrepareAgentResponse, agentKeyAddress: Address): void {
    const userOp = response.unsigned_user_op

    // Layer 1, Check 1: This is a deployment (factory must be set)
    if (userOp.factory == null) {
      throw new ApiError("Invalid prepare response: not a deployment operation (factory is null)")
    }

    // Layer 1, Check 2: Deploying the expected address
    const sender = userOp.sender as string | undefined
    if (!sender || sender.toLowerCase() !== response.agent_address.toLowerCase()) {
      throw new ApiError(
        `Invalid prepare response: sender mismatch (expected ${response.agent_address}, got ${sender})`,
      )
    }

    // Layer 1, Check 3: Our key is in the owners list
    const ownerAddresses = response.owners.map((o) => o.toLowerCase())
    if (!ownerAddresses.includes(agentKeyAddress.toLowerCase())) {
      throw new ApiError(`Invalid prepare response: agent key ${agentKeyAddress} not in owners list`)
    }

    // Layer 2: Verify hash matches the UserOp we're signing
    const deserializedUserOp = this.deserializeUserOperation(userOp)
    const computedHash = getUserOperationHash({
      userOperation: deserializedUserOp as Parameters<typeof getUserOperationHash>[0]["userOperation"],
      entryPointAddress: entryPoint07Address,
      entryPointVersion: "0.7",
      chainId: this.chainId,
    })

    if (computedHash.toLowerCase() !== response.user_op_hash.toLowerCase()) {
      throw new ApiError(
        `Invalid prepare response: hash mismatch (computed ${computedHash}, server provided ${response.user_op_hash})`,
      )
    }
  }

  /**
   * Deserialize a UserOperation from API format (hex strings → bigints).
   */
  private deserializeUserOperation(serialized: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(serialized)) {
      if (USER_OP_BIGINT_FIELDS.has(key) && typeof value === "string") {
        result[key] = BigInt(value)
      } else {
        result[key] = value
      }
    }
    return result
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
