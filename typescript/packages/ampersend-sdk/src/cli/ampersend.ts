#!/usr/bin/env node
import { Command } from "commander"

import { registerFetchCommand } from "./commands/fetch.ts"

const VERSION = "0.1.0"

async function main(): Promise<void> {
  const program = new Command().name("ampersend").description("Command-line interface for ampersend").version(VERSION)

  registerFetchCommand(program)

  await program.parseAsync()
}

main().catch((error) => {
  console.error(`Fatal: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
