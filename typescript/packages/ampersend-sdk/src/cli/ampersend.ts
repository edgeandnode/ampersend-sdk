#!/usr/bin/env node
import { Command } from "commander"

import { VERSION } from "../version.ts"
import { registerConfigCommand } from "./commands/config.ts"
import { registerFetchCommand } from "./commands/fetch.ts"
import { registerMarketplaceCommand } from "./commands/marketplace.ts"
import { registerSetupCommand } from "./commands/setup.ts"
import { registerVersionCommand } from "./commands/version.ts"

async function main(): Promise<void> {
  const program = new Command().name("ampersend").description("Command-line interface for ampersend").version(VERSION)

  registerConfigCommand(program)
  registerSetupCommand(program)
  registerFetchCommand(program)
  registerMarketplaceCommand(program)
  registerVersionCommand(program)

  await program.parseAsync()
}

main().catch((error) => {
  console.error(`Fatal: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
