import { Schema } from "effect"

import { ApiError, ApprovalResponse, ApprovalStatus, type AgentApprovalRequest } from "./types.js"

const DEFAULT_API_URL = "https://api.ampersend.ai"

export interface ApprovalClientOptions {
  apiUrl?: string
  timeout?: number
}

/**
 * Client for the approve-action flow.
 *
 * This client handles unauthenticated approval requests where an agent
 * programmatically requests setup (creation or key connection) and waits
 * for user approval via the Ampersend dashboard.
 *
 * @example
 * ```typescript
 * import { ApprovalClient } from "@ampersend_ai/ampersend-sdk/ampersend"
 *
 * const client = new ApprovalClient()
 *
 * // Request agent setup approval
 * const response = await client.requestAgentApproval({
 *   name: "my-agent",
 *   agent_key_address: "0x...",
 * })
 *
 * console.log("Have user visit:", response.user_approve_url)
 *
 * // Poll for status
 * const status = await client.getApprovalStatus(response.token)
 * if (status.status === "resolved" && "agent" in status) {
 *   console.log("Agent ready at:", status.agent.address)
 * }
 * ```
 */
export class ApprovalClient {
  private baseUrl: string
  private timeout: number

  constructor(options: ApprovalClientOptions = {}) {
    this.baseUrl = (options.apiUrl ?? DEFAULT_API_URL).replace(/\/$/, "")
    this.timeout = options.timeout ?? 30000
  }

  /**
   * Request approval to set up an agent (create new or connect key to existing).
   *
   * Returns URLs for the user to approve the action and to poll for status.
   */
  async requestAgentApproval(request: typeof AgentApprovalRequest.Encoded): Promise<ApprovalResponse> {
    const { agent_key_address, ...optional } = request
    // Map SDK field name to API wire format and strip undefined values
    const payload = Object.fromEntries(
      Object.entries({ session_key_address: agent_key_address, ...optional }).filter(([, v]) => v !== undefined),
    )
    return this.fetch("POST", "/api/v1/approve-action/agent", payload, ApprovalResponse)
  }

  /**
   * Get the current status of an approval request.
   *
   * @param token - The token from the approval response
   */
  async getApprovalStatus(token: string): Promise<ApprovalStatus> {
    return this.fetch("GET", `/api/v1/approve-action/${token}/status`, undefined, ApprovalStatus)
  }

  private async fetch<A, I>(method: string, path: string, body: unknown, schema: Schema.Schema<A, I>): Promise<A> {
    const url = `${this.baseUrl}${path}`
    const headers: Record<string, string> = {}
    if (body != null) {
      headers["Content-Type"] = "application/json"
    }

    try {
      const init: RequestInit = {
        method,
        headers,
        signal: AbortSignal.timeout(this.timeout),
      }
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

      const data = await response.json()
      return Schema.decodeUnknownSync(schema)(data)
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
