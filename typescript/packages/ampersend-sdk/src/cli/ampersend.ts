#!/usr/bin/env node
import { Command, CommanderError } from "commander"

import { VERSION } from "../version.ts"
import { registerAgentCommand } from "./commands/agent.ts"
import { registerCardCommand } from "./commands/card.ts"
import { registerConfigCommand } from "./commands/config.ts"
import { registerFetchCommand } from "./commands/fetch.ts"
import { registerFundCommand } from "./commands/fund.ts"
import { registerMarketplaceCommand } from "./commands/marketplace.ts"
import { registerSetupCommand } from "./commands/setup.ts"
import { registerTourCommand } from "./commands/tour.ts"
import { registerVersionCommand } from "./commands/version.ts"
import { err } from "./envelope.ts"

// Map Commander's internal error codes to envelope codes. Anything not listed
// here falls back to "CLI_USAGE_ERROR" so we never emit a raw stderr line that
// breaks the documented JSON-only output contract.
const COMMANDER_ERROR_CODES: Record<string, string> = {
  "commander.unknownOption": "UNKNOWN_OPTION",
  "commander.unknownCommand": "UNKNOWN_COMMAND",
  "commander.missingArgument": "MISSING_ARGUMENT",
  "commander.missingMandatoryOptionValue": "MISSING_OPTION",
  "commander.optionMissingArgument": "MISSING_OPTION_ARGUMENT",
  "commander.invalidArgument": "INVALID_ARGUMENT",
  "commander.conflictingOption": "CONFLICTING_OPTION",
  "commander.excessArguments": "EXCESS_ARGUMENTS",
}

async function main(): Promise<void> {
  const program = new Command().name("ampersend").description("Command-line interface for ampersend").version(VERSION)

  // Without exitOverride, Commander prints "error: unknown option '--foo'" to
  // stderr and exits — bypassing our JSON envelope. Catch its CommanderError
  // and re-throw so main()'s catch can format it. Help and version are not
  // failures; let them exit cleanly. configureOutput silences Commander's
  // own stderr line so the envelope is the only thing on the wire.
  program.exitOverride((commanderErr) => {
    if (commanderErr.code === "commander.helpDisplayed" || commanderErr.code === "commander.version") {
      process.exit(commanderErr.exitCode)
    }
    throw commanderErr
  })
  program.configureOutput({
    outputError: () => {},
  })

  registerConfigCommand(program)
  registerSetupCommand(program)
  registerFetchCommand(program)
  registerAgentCommand(program)
  registerCardCommand(program)
  registerFundCommand(program)
  registerMarketplaceCommand(program)
  registerTourCommand(program)
  registerVersionCommand(program)

  await program.parseAsync()
}

main().catch((error) => {
  if (error instanceof CommanderError) {
    const code = COMMANDER_ERROR_CODES[error.code] ?? "CLI_USAGE_ERROR"
    const message = error.message.replace(/^error:\s*/, "")
    console.log(JSON.stringify(err(code, message), null, 2))
    process.exit(error.exitCode || 1)
  }
  const message = error instanceof Error ? error.message : String(error)
  console.log(JSON.stringify(err("CLI_FATAL", message), null, 2))
  process.exit(1)
})
