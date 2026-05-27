import type { Command } from "commander"

import { AgentReadClient } from "../../ampersend/index.ts"
import { DEFAULT_API_URL, loadCredentials } from "../config.ts"
import { err, ok } from "../envelope.ts"

interface BaseOptions {
  raw: boolean
}

const VALID_PRESETS = new Set(["1d", "30d", "all"])

/** Build an `AgentReadClient` from local config, or print an envelope-style error and exit. */
export function buildClient(): AgentReadClient {
  const result = loadCredentials()
  if (!result.ok) {
    console.log(JSON.stringify(result.error, null, 2))
    process.exit(1)
  }
  const { agentAccount, agentKey, apiUrl } = result.credentials
  return new AgentReadClient({
    baseUrl: apiUrl ?? DEFAULT_API_URL,
    agentAddress: agentAccount,
    sessionKeyPrivateKey: agentKey,
  })
}

/**
 * Wrap a read call so success/failure both print the standard envelope.
 * `--raw` mode prints the inner payload directly for scripting; the
 * default JSON envelope is what the skill expects.
 *
 * BigInt is serialised as a decimal string — JSON has no native bigint
 * and the DTOs decode wire strings into bigint values, so we have to
 * project them back out when printing.
 */
export async function emit(label: string, options: BaseOptions, run: () => Promise<unknown>): Promise<void> {
  try {
    const data = await run()
    const payload = options.raw ? data : ok(data)
    console.log(JSON.stringify(payload, bigintReplacer, 2))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (options.raw) {
      console.error(`Error: ${message}`)
    } else {
      console.log(JSON.stringify(err("AGENT_READ_ERROR", `${label}: ${message}`), null, 2))
    }
    process.exit(1)
  }
}

function bigintReplacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value
}

export function parsePreset(value: string | undefined): "1d" | "30d" | "all" | undefined {
  if (value === undefined) return undefined
  if (!VALID_PRESETS.has(value)) {
    console.log(
      JSON.stringify(err("INVALID_PRESET", `Invalid --preset: ${value}. Must be one of: 1d, 30d, all`), null, 2),
    )
    process.exit(1)
  }
  return value as "1d" | "30d" | "all"
}

export function parseIntFlag(name: string, value: string | undefined, max?: number): number | undefined {
  if (value === undefined) return undefined
  // Strict regex before parseInt: parseInt("1.5") === 1 silently drops the
  // fraction, and parseInt(" 5 ") accepts whitespace.
  if (!/^[1-9]\d*$/.test(value)) {
    console.log(JSON.stringify(err("INVALID_FLAG", `--${name} must be a positive integer`), null, 2))
    process.exit(1)
  }
  const n = Number.parseInt(value, 10)
  if (max !== undefined && n > max) {
    console.log(JSON.stringify(err("INVALID_FLAG", `--${name} must be ≤ ${max}`), null, 2))
    process.exit(1)
  }
  return n
}

const PRESET_DESCRIPTION = "Timerange: 1d (today), 30d (last 30 days), or all"

export function registerAgentCommand(program: Command): void {
  const agent = program
    .command("agent")
    .description("Read the calling agent's own state (server-authoritative)")
    .option("--raw", "Print only the inner data, no JSON envelope", false)
    .action(async (options: BaseOptions) => {
      await emit("getSelf", options, () => buildClient().getSelf())
    })

  agent
    .command("spend-config")
    .description("Show spending policy (per-tx, daily, monthly limits, auto-topup)")
    .option("--raw", "Print only the inner data, no JSON envelope", false)
    .action(async (options: BaseOptions) => {
      await emit("spend-config", options, () => buildClient().getSpendConfig())
    })

  agent
    .command("auto-collect-config")
    .description("Show auto-collect (earnings sweep) configuration")
    .option("--raw", "Print only the inner data, no JSON envelope", false)
    .action(async (options: BaseOptions) => {
      await emit("auto-collect-config", options, () => buildClient().getAutoCollectConfig())
    })

  agent
    .command("authorized-sellers")
    .description("Show the seller allowlist this agent is permitted to pay")
    .option("--raw", "Print only the inner data, no JSON envelope", false)
    .action(async (options: BaseOptions) => {
      await emit("authorized-sellers", options, () => buildClient().getAuthorizedSellers())
    })

  agent
    .command("payments")
    .description("Show outgoing payments")
    .option("--raw", "Print only the inner data, no JSON envelope", false)
    .option("--preset <preset>", PRESET_DESCRIPTION)
    .action(async (options: BaseOptions & { preset?: string }) => {
      await emit("payments", options, () => {
        const preset = parsePreset(options.preset)
        return buildClient().getPayments(preset ? { preset } : {})
      })
    })

  agent
    .command("activity")
    .description("Show unified spend + earn activity, paginated")
    .option("--raw", "Print only the inner data, no JSON envelope", false)
    .option("--preset <preset>", PRESET_DESCRIPTION)
    .option("--limit <n>", "Items per page (max 200, default 20)")
    .option("--page <n>", "Page number (1-indexed, default 1)")
    .action(async (options: BaseOptions & { preset?: string; limit?: string; page?: string }) => {
      await emit("activity", options, () => {
        const params: { preset?: "1d" | "30d" | "all"; limit?: number; page?: number } = {}
        const preset = parsePreset(options.preset)
        if (preset !== undefined) params.preset = preset
        const limit = parseIntFlag("limit", options.limit, 200)
        if (limit !== undefined) params.limit = limit
        const page = parseIntFlag("page", options.page)
        if (page !== undefined) params.page = page
        return buildClient().getActivity(params)
      })
    })

  agent
    .command("owner")
    .description("Show the owner's narrow projection ({ user_id, wallet_address })")
    .option("--raw", "Print only the inner data, no JSON envelope", false)
    .action(async (options: BaseOptions) => {
      await emit("owner", options, () => buildClient().getOwner())
    })
}
