import { Schema } from "effect"

import {
  AgentActivityResponse,
  AgentAutoCollectConfigDTO,
  AgentFundingLinkDTO,
  AgentOwnerDTO,
  AgentSelfDTO,
  AgentSelfPaymentDTO,
  AgentSelfSpendConfigDTO,
} from "./agent.ts"
import { ApiClient } from "./client.ts"
import { Address, type ApiClientOptions } from "./types.ts"

export interface AgentReadClientOptions extends ApiClientOptions {}

/**
 * Read-only client for an agent's own state on the Ampersend service.
 *
 * Wraps the `/v1/agents/self/*` endpoints. Auth is the standard
 * agent SIWE session token, reused from {@link ApiClient}; the session
 * pins which agent the server will answer for, so none of these methods
 * take an agent address.
 *
 * Each response is decoded against the canonical DTO from `./agent.ts`.
 * The server imports those same DTOs, so there is no drift surface
 * between client and server for the agent-led read endpoints.
 *
 * @example
 * ```ts
 * const agent = new AgentReadClient({
 *   baseUrl: "https://api.ampersend.ai",
 *   agentAddress,
 *   sessionKeyPrivateKey,
 * })
 * const snapshot = await agent.getSelf()
 * const limits = await agent.getSpendConfig()
 * const payments = await agent.getPayments({ preset: "30d" })
 * ```
 */
export class AgentReadClient {
  private api: ApiClient

  /**
   * Construct from credentials (production path) or from an existing
   * `ApiClient` (test path / sharing auth state with another SDK client).
   * Discriminates on shape, not `instanceof` — test doubles never satisfy
   * `instanceof ApiClient` but do expose `getAuthorized`.
   */
  constructor(input: AgentReadClientOptions | ApiClient) {
    this.api = "getAuthorized" in input ? input : new ApiClient(input)
  }

  /** Full snapshot: agent record + live USDC balance. */
  getSelf(): Promise<AgentSelfDTO> {
    return this.api.getAuthorized("/api/v1/agents/self", AgentSelfDTO)
  }

  /**
   * Spend policy (per-tx / daily / monthly limits, auto-topup) plus live
   * remaining budgets. Throws `ApiError` with `status === 404` when no
   * spend policy exists for this agent.
   */
  getSpendConfig(): Promise<AgentSelfSpendConfigDTO> {
    return this.api.getAuthorized("/api/v1/agents/self/spend-config", AgentSelfSpendConfigDTO)
  }

  /**
   * Auto-collect (earnings sweep) configuration. Throws `ApiError` with
   * `status === 404` when no auto-collect configuration exists for this
   * agent.
   */
  getAutoCollectConfig(): Promise<AgentAutoCollectConfigDTO> {
    return this.api.getAuthorized("/api/v1/agents/self/auto-collect-config", AgentAutoCollectConfigDTO)
  }

  /** Seller allowlist this agent is permitted to pay. */
  getAuthorizedSellers(): Promise<ReadonlyArray<Address>> {
    return this.api.getAuthorized("/api/v1/agents/self/authorized-sellers", Schema.Array(Address))
  }

  /** Outgoing payments. `preset` selects the timerange (default: 30d). */
  getPayments(params: { preset?: "1d" | "30d" | "all" } = {}): Promise<ReadonlyArray<AgentSelfPaymentDTO>> {
    const qs = params.preset ? `?preset=${params.preset}` : ""
    return this.api.getAuthorized(`/api/v1/agents/self/payments${qs}`, Schema.Array(AgentSelfPaymentDTO))
  }

  /** Unified spend + earn activity, paginated. */
  getActivity(params: { preset?: string; limit?: number; page?: number } = {}): Promise<AgentActivityResponse> {
    const qs = new URLSearchParams()
    if (params.preset) qs.set("preset", params.preset)
    if (params.limit != null) qs.set("limit", String(params.limit))
    if (params.page != null) qs.set("page", String(params.page))
    const suffix = qs.toString()
    return this.api.getAuthorized(`/api/v1/agents/self/activity${suffix ? `?${suffix}` : ""}`, AgentActivityResponse)
  }

  /** Narrow owner projection: `{ user_id, wallet_address }`. */
  getOwner(): Promise<AgentOwnerDTO> {
    return this.api.getAuthorized("/api/v1/agents/self/owner", AgentOwnerDTO)
  }

  /**
   * Build a dashboard `/fund` URL the user can open to add USDC. The server
   * is a pure URL formatter — no DB row, no token, no side effects. The
   * returned URL preselects the calling agent (`destination: "agent"`, default)
   * or the owner's main account (`destination: "main"`).
   *
   * `amount` is a decimal USDC string, strictly validated server-side as
   * positive, ≤6 fractional digits, no leading zeros.
   */
  getFundingLink(params: { amount?: string; destination?: "agent" | "main" } = {}): Promise<AgentFundingLinkDTO> {
    const qs = new URLSearchParams()
    if (params.amount != null) qs.set("amount", params.amount)
    if (params.destination != null) qs.set("destination", params.destination)
    const suffix = qs.toString()
    return this.api.getAuthorized(`/api/v1/agents/self/funding-link${suffix ? `?${suffix}` : ""}`, AgentFundingLinkDTO)
  }
}
