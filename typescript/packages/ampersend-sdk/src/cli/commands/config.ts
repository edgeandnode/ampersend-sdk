import type { Command } from "commander"

import { getStatus, removeContext, setConfig, useContext } from "../config.ts"
import { type JsonEnvelope } from "../envelope.ts"

/** Print an envelope and exit with the matching code. */
function emit(result: JsonEnvelope<unknown>): void {
  console.log(JSON.stringify(result, null, 2))
  process.exit(result.ok ? 0 : 1)
}

/**
 * Register the config subcommand with set, status, use, and rm.
 */
export function registerConfigCommand(program: Command): void {
  const config = program.command("config").description("Manage ampersend configuration")

  config
    .command("set")
    .description("Create a context from an identity and make it active")
    .argument("<secret>", "Agent key and account in format: 0xkey:::0xaccount")
    .option("--context <name>", "Name for the context (auto-named from the key when omitted)")
    .option("--api-url <url>", "API URL this context targets (for non-production environments)")
    .action((secret: string, options: { context?: string; apiUrl?: string }) => {
      // A context's API URL is fixed at creation. There's no in-place URL edit:
      // re-run `config set` / `setup start` with a new --api-url to point a
      // context elsewhere, or use --api-url / AMPERSEND_API_URL per command.
      emit(setConfig(secret, { name: options.context, apiUrl: options.apiUrl }))
    })

  config
    .command("status")
    .description("Show current configuration status")
    .action(() => {
      emit(getStatus())
    })

  config
    .command("use")
    .description("Switch the active context")
    .argument("<name>", "Context name to make active")
    .action((name: string) => {
      emit(useContext(name))
    })

  config
    .command("rm")
    .description("Delete a context")
    .argument("<name>", "Context name to delete")
    .action((name: string) => {
      emit(removeContext(name))
    })
}
