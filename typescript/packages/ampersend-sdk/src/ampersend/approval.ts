import { Schema } from "effect"

import { ApiError, ApprovalResponse, ApprovalStatus, type CreateAgentApprovalRequest } from "./types.js"

const DEFAULT_API_URL = "https://api.ampersend.ai"

export interface ApprovalClientOptions {
  apiUrl?: string
  timeout?: number
}

/**
 * Client for the approve-action flow.
 *
 * This client handles unauthenticated approval requests where an agent
 * programmatically requests creation and waits for user approval via
 * the Ampersend dashboard.
 *
 * @example
 * ```typescript
 * import { ApprovalClient } from "@ampersend_ai/ampersend-sdk/ampersend"
 *
 * const client = new ApprovalClient()
 *
 * // Request agent creation approval
 * const response = await client.requestAgentCreation({
 *   name: "my-agent",
 *   agent_key_address: "0x...",
 * })
 *
 * console.log("Have user visit:", response.user_approve_url)
 *
 * // Poll for status
 * const status = await client.getApprovalStatus(response.token)
 * if (status.status === "resolved" && "agent" in status) {
 *   console.log("Agent created at:", status.agent.address)
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
   * Request approval to create a new agent.
   *
   * Returns URLs for the user to approve the action and to poll for status.
   */
  async requestAgentCreation(request: typeof CreateAgentApprovalRequest.Encoded): Promise<ApprovalResponse> {
    // Map SDK field names to API wire format
    const payload: Record<string, unknown> = {
      name: request.name,
      session_key_address: request.agent_key_address,
    }
    if (request.spend_config !== undefined) {
      payload.spend_config = request.spend_config
    }
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
