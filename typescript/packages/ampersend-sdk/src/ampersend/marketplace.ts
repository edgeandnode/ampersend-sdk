import { Schema } from "effect"

import { ApiClient } from "./client.ts"
import { AgentMarketplaceListQueryParams, CuratedAgentDTO, type CuratedAgentSource } from "./curated-agent.ts"
import type { ApiClientOptions } from "./types.ts"

export interface MarketplaceClientOptions extends ApiClientOptions {}

export interface ListMarketplaceAgentsFilters {
  source?: CuratedAgentSource
  category?: string
  search?: string
  network?: string
}

/**
 * Client for the agent marketplace API.
 *
 * Reads from the unauthenticated `/api/v1/agents/marketplace` endpoints
 * to discover curated agents, their endpoints, and their skills.
 *
 * @example
 * ```typescript
 * import { MarketplaceClient } from "@ampersend_ai/ampersend-sdk/ampersend"
 *
 * const client = new MarketplaceClient()
 *
 * const agents = await client.listAgents({ source: "catalog" })
 * const agent = await client.getAgent(agents[0].id)
 * ```
 */
export class MarketplaceClient {
  private readonly api: ApiClient

  constructor(options: MarketplaceClientOptions | ApiClient) {
    this.api = "getAuthorized" in options ? options : new ApiClient(options)
  }

  /**
   * List curated agents in the marketplace.
   *
   * Filters are optional and combine on the server side. `search` performs a
   * fuzzy match across name, description, tags, and category.
   */
  async listAgents(filters: ListMarketplaceAgentsFilters = {}): Promise<ReadonlyArray<CuratedAgentDTO>> {
    Schema.decodeUnknownSync(AgentMarketplaceListQueryParams)(filters)
    const query = new URLSearchParams()
    if (filters.source) query.set("source", filters.source)
    if (filters.category) query.set("category", filters.category)
    if (filters.search) query.set("search", filters.search)
    if (filters.network) query.set("network", filters.network)
    const qs = query.toString()
    const path = qs
      ? `/api/v1/agents/marketplace/agentic/discover?${qs}`
      : "/api/v1/agents/marketplace/agentic/discover"
    return this.api.getAuthorized(path, Schema.Array(CuratedAgentDTO))
  }

  /**
   * Get a single curated agent by its id.
   *
   * @throws ApiError with status 404 if the agent is not found.
   */
  async getAgent(id: string): Promise<CuratedAgentDTO> {
    return this.api.fetch(`/api/v1/agents/marketplace/${encodeURIComponent(id)}`, { method: "GET" }, CuratedAgentDTO)
  }
}
