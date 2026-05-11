import type { Command } from "commander"

import { MarketplaceClient, type CuratedAgentSource, type ListMarketplaceAgentsFilters } from "../../ampersend/index.ts"
import { DEFAULT_API_URL } from "../config.ts"
import { err, ok, type JsonEnvelope } from "../envelope.ts"

const VALID_SOURCES: ReadonlyArray<CuratedAgentSource> = ["catalog", "bazaar", "ampersend"]

interface ListOptions {
  source?: string
  category?: string
  search?: string
  network?: string
  raw: boolean
}

interface ShowOptions {
  raw: boolean
}

function resolveApiUrl(): string {
  return process.env.AMPERSEND_API_URL ?? DEFAULT_API_URL
}

function isCuratedAgentSource(value: string): value is CuratedAgentSource {
  return (VALID_SOURCES as ReadonlyArray<string>).includes(value)
}

function buildFilters(options: ListOptions): JsonEnvelope<ListMarketplaceAgentsFilters> {
  const filters: ListMarketplaceAgentsFilters = {}
  if (options.source !== undefined) {
    if (!isCuratedAgentSource(options.source)) {
      return err("INVALID_SOURCE", `Invalid --source: ${options.source}. Must be one of: ${VALID_SOURCES.join(", ")}`)
    }
    filters.source = options.source
  }
  if (options.category !== undefined) filters.category = options.category
  if (options.search !== undefined) filters.search = options.search
  if (options.network !== undefined) filters.network = options.network
  return ok(filters)
}

async function executeList(options: ListOptions): Promise<void> {
  const filtersResult = buildFilters(options)
  if (!filtersResult.ok) {
    if (options.raw) {
      console.error(`Error: ${filtersResult.error.message}`)
    } else {
      console.log(JSON.stringify(filtersResult, null, 2))
    }
    process.exit(1)
  }

  const client = new MarketplaceClient({ apiUrl: resolveApiUrl() })

  try {
    const agents = await client.listAgents(filtersResult.data)
    if (options.raw) {
      console.log(JSON.stringify(agents, null, 2))
    } else {
      console.log(JSON.stringify(ok(agents), null, 2))
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (options.raw) {
      console.error(`Error: ${message}`)
    } else {
      console.log(JSON.stringify(err("API_ERROR", message), null, 2))
    }
    process.exit(1)
  }
}

async function executeShow(id: string, options: ShowOptions): Promise<void> {
  const client = new MarketplaceClient({ apiUrl: resolveApiUrl() })

  try {
    const agent = await client.getAgent(id)
    if (options.raw) {
      console.log(JSON.stringify(agent, null, 2))
    } else {
      console.log(JSON.stringify(ok(agent), null, 2))
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const code = message.startsWith("HTTP 404") ? "NOT_FOUND" : "API_ERROR"
    if (options.raw) {
      console.error(`Error: ${message}`)
    } else {
      console.log(JSON.stringify(err(code, message), null, 2))
    }
    process.exit(1)
  }
}

/**
 * Register the marketplace subcommand on a Commander program
 */
export function registerMarketplaceCommand(program: Command): void {
  const marketplace = program.command("marketplace").description("Browse curated agents in the marketplace")

  marketplace
    .command("list")
    .description("List curated agents, optionally filtered")
    .option("--source <source>", `Filter by source (one of: ${VALID_SOURCES.join(", ")})`)
    .option("--category <category>", "Filter by category")
    .option("--search <query>", "Fuzzy search across name, description, tags, and category")
    .option("--network <network>", "Filter by supported network (e.g. base, base-sepolia)")
    .option("--raw", "Output raw JSON array instead of envelope", false)
    .action(async (options: ListOptions) => {
      await executeList(options)
    })

  marketplace
    .command("show")
    .description("Show details for a single curated agent")
    .argument("<id>", "Curated agent id (UUID)")
    .option("--raw", "Output raw JSON object instead of envelope", false)
    .action(async (id: string, options: ShowOptions) => {
      await executeShow(id, options)
    })
}

export { executeList, executeShow }
