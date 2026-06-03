import type { Command } from "commander"
import { Schema } from "effect"

import {
  CuratedAgentDTO,
  MarketplaceClient,
  type CuratedAgentSource,
  type ListMarketplaceAgentsFilters,
} from "../../ampersend/index.ts"
import { getActiveApiUrl, loadCredentials, type ContextSelector } from "../config.ts"
import { err, ok, type JsonEnvelope } from "../envelope.ts"

// Decoded DTOs hold bigints (e.g. pricing_config.amount), which JSON.stringify
// can't serialize. Encode back to wire form before printing — the result is
// byte-identical to what came over the wire.
const encodeAgent = Schema.encodeSync(CuratedAgentDTO)
const encodeAgents = Schema.encodeSync(Schema.Array(CuratedAgentDTO))

const VALID_SOURCES: ReadonlyArray<CuratedAgentSource> = ["catalog", "bazaar", "ampersend", "registry"]

interface ListOptions {
  source?: string
  category?: string
  search?: string
  network?: string
  raw: boolean
  context?: string
}

interface ShowOptions {
  raw: boolean
  context?: string
}

/** `--context <name>` option, shared across marketplace subcommands. */
const CONTEXT_DESCRIPTION = "Run against a specific context instead of the active one"

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

export function buildClient(opts: ContextSelector = {}): MarketplaceClient {
  const result = loadCredentials(opts)
  if (!result.ok) {
    console.log(JSON.stringify(result.error, null, 2))
    process.exit(1)
  }
  const { agentAccount, agentKey } = result.credentials
  return new MarketplaceClient({
    baseUrl: getActiveApiUrl(opts),
    agentAddress: agentAccount,
    sessionKeyPrivateKey: agentKey,
  })
}

// `marketplace show` reads a single agent from an unauthenticated endpoint, so
// it must work without setup. Build a credential-free client rather than going
// through `buildClient`, which exits when no agent is configured.
export function buildReadOnlyClient(opts: ContextSelector = {}): MarketplaceClient {
  return new MarketplaceClient({ baseUrl: getActiveApiUrl(opts) })
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

  const client = buildClient(options)

  try {
    const agents = await client.listAgents(filtersResult.data)
    const wire = encodeAgents(agents)
    if (options.raw) {
      console.log(JSON.stringify(wire, null, 2))
    } else {
      console.log(JSON.stringify(ok(wire), null, 2))
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
  const client = buildReadOnlyClient(options)

  try {
    const agent = await client.getAgent(id)
    const wire = encodeAgent(agent)
    if (options.raw) {
      console.log(JSON.stringify(wire, null, 2))
    } else {
      console.log(JSON.stringify(ok(wire), null, 2))
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
    .option("--context <name>", CONTEXT_DESCRIPTION)
    .action(async (options: ListOptions) => {
      await executeList(options)
    })

  marketplace
    .command("show")
    .description("Show details for a single curated agent")
    .argument("<id>", "Curated agent id (UUID)")
    .option("--raw", "Output raw JSON object instead of envelope", false)
    .option("--context <name>", CONTEXT_DESCRIPTION)
    .action(async (id: string, options: ShowOptions) => {
      await executeShow(id, options)
    })
}

export { executeList, executeShow }
