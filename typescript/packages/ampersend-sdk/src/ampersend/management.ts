import type { Address, Hex } from "viem"
import { privateKeyToAccount } from "viem/accounts"

import { ApiError } from "./types.js"

const DEFAULT_API_URL = "https://api.ampersend.ai"

export interface SpendConfig {
  autoTopupAllowed?: boolean
  dailyLimit?: number
  monthlyLimit?: number
  perTransactionLimit?: number
}

export interface CreateAgentOptions {
  name: string
  privateKey: Hex
  spendConfig?: SpendConfig
  authorizedSellers?: Array<Address>
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
  async createAgent(options: CreateAgentOptions): Promise<Record<string, unknown>> {
    const account = privateKeyToAccount(options.privateKey)
    const agentKeyAddress = account.address

    // 1. Prepare unsigned UserOp
    const prepareResponse = await this.fetch("GET", `/api/v1/sdk/agents/prepare?agent_key_address=${agentKeyAddress}`)

    // 2. Sign the UserOp hash (personal_sign of the raw hash bytes)
    const userOpHash: string = prepareResponse.user_op_hash
    const signature = await account.signMessage({ message: { raw: userOpHash as Hex } })

    // 3. Build create payload
    let spendConfig: Record<string, unknown> | undefined
    if (options.spendConfig) {
      const sc = options.spendConfig
      spendConfig = {
        auto_topup_allowed: sc.autoTopupAllowed ?? false,
        daily_limit: sc.dailyLimit != null ? String(sc.dailyLimit) : null,
        monthly_limit: sc.monthlyLimit != null ? String(sc.monthlyLimit) : null,
        per_transaction_limit: sc.perTransactionLimit != null ? String(sc.perTransactionLimit) : null,
      }
    }

    const payload = {
      signature,
      prepare_response: prepareResponse,
      name: options.name,
      keys: [{ address: agentKeyAddress, permission_id: null }],
      spend_config: spendConfig ?? null,
      authorized_sellers: options.authorizedSellers ?? null,
    }

    // 4. Submit signed deployment
    return this.fetch("POST", "/api/v1/sdk/agents", payload)
  }

  /**
   * List all agents belonging to the authenticated user.
   */
  async listAgents(): Promise<Array<Record<string, unknown>>> {
    return this.fetch("GET", "/api/v1/sdk/agents") as Promise<Array<Record<string, unknown>>>
  }

  private async fetch(method: string, path: string, body?: unknown): Promise<any> {
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
