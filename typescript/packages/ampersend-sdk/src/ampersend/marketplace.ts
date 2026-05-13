import { Schema } from "effect"

import { AgentMarketplaceListQueryParams, CuratedAgentDTO, type CuratedAgentSource } from "./curated-agent.js"
import { ApiError } from "./types.js"

const DEFAULT_API_URL = "https://api.ampersend.ai"

export interface MarketplaceClientOptions {
  apiUrl?: string
  timeout?: number
}

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
  private baseUrl: string
  private timeout: number

  constructor(options: MarketplaceClientOptions = {}) {
    this.baseUrl = (options.apiUrl ?? DEFAULT_API_URL).replace(/\/$/, "")
    this.timeout = options.timeout ?? 30000
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
    const path = qs ? `/api/v1/agents/marketplace?${qs}` : "/api/v1/agents/marketplace"
    return this.fetch("GET", path, Schema.Array(CuratedAgentDTO))
  }

  /**
   * Get a single curated agent by its id.
   *
   * @throws ApiError with status 404 if the agent is not found.
   */
  async getAgent(id: string): Promise<CuratedAgentDTO> {
    return this.fetch("GET", `/api/v1/agents/marketplace/${encodeURIComponent(id)}`, CuratedAgentDTO)
  }

  private async fetch<A, I>(method: string, path: string, schema: Schema.Schema<A, I>): Promise<A> {
    const url = `${this.baseUrl}${path}`

    try {
      const response = await globalThis.fetch(url, {
        method,
        signal: AbortSignal.timeout(this.timeout),
      })

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
