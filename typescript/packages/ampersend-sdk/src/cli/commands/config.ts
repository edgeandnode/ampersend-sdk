import type { Command } from "commander"

import { getStatus, setApiUrl, setConfig, setNetwork } from "../config.ts"

/**
 * Register the config subcommand with set and status
 */
export function registerConfigCommand(program: Command): void {
  const config = program.command("config").description("Manage ampersend configuration")

  config
    .command("set")
    .description("Set configuration values")
    .argument("[secret]", "Agent key and account in format: 0xkey:::0xaccount")
    .option("--api-url <url>", "Set API URL (for non-production environments)")
    .option("--clear-api-url", "Clear API URL (revert to production default)")
    .option("--network <network>", "Set network (base, base-sepolia)")
    .option("--clear-network", "Clear network (revert to default: base)")
    .action(
      (
        secret: string | undefined,
        options: { apiUrl?: string; clearApiUrl?: boolean; network?: string; clearNetwork?: boolean },
      ) => {
        if (!secret && !options.apiUrl && !options.clearApiUrl && !options.network && !options.clearNetwork) {
          console.log(
            JSON.stringify(
              { ok: false, error: { code: "NO_INPUT", message: "Provide a secret and/or flags. See --help." } },
              null,
              2,
            ),
          )
          process.exit(1)
          return
        }

        // Handle API URL first
        if (options.clearApiUrl) {
          const result = setApiUrl(undefined)
          if (!result.ok) {
            console.log(JSON.stringify(result, null, 2))
            process.exit(1)
            return
          }
        } else if (options.apiUrl) {
          const result = setApiUrl(options.apiUrl)
          if (!result.ok) {
            console.log(JSON.stringify(result, null, 2))
            process.exit(1)
            return
          }
        }

        // Handle network
        if (options.clearNetwork) {
          const result = setNetwork(undefined)
          if (!result.ok) {
            console.log(JSON.stringify(result, null, 2))
            process.exit(1)
            return
          }
        } else if (options.network) {
          const result = setNetwork(options.network)
          if (!result.ok) {
            console.log(JSON.stringify(result, null, 2))
            process.exit(1)
            return
          }
        }

        // Handle secret
        if (secret) {
          const result = setConfig(secret)
          console.log(JSON.stringify(result, null, 2))
          process.exit(result.ok ? 0 : 1)
          return
        }

        // Only flags were set, show status
        const result = getStatus()
        console.log(JSON.stringify(result, null, 2))
        process.exit(result.ok ? 0 : 1)
      },
    )

  config
    .command("status")
    .description("Show current configuration status")
    .action(() => {
      const result = getStatus()
      console.log(JSON.stringify(result, null, 2))
      process.exit(result.ok ? 0 : 1)
    })
}
