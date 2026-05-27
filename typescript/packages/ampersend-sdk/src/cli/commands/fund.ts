import type { Command } from "commander"

import { err } from "../envelope.ts"
import { buildClient, emit } from "./agent.ts"

const VALID_DESTINATIONS = new Set(["agent", "main"])

export function registerFundCommand(program: Command): void {
  program
    .command("fund")
    .description("Print a dashboard URL the user can open to fund this agent or their main account")
    .option("--amount <usdc>", "Suggested USDC amount, e.g. '25' or '1.5'")
    .option("--destination <where>", "Which account to preselect: 'agent' (default) or 'main'")
    .option("--raw", "Print only the inner data, no JSON envelope", false)
    .action(async (options: { raw: boolean; amount?: string; destination?: string }) => {
      if (options.destination != null && !VALID_DESTINATIONS.has(options.destination)) {
        console.log(JSON.stringify(err("INVALID_FLAG", "--destination must be one of: agent, main"), null, 2))
        process.exit(1)
      }
      await emit("funding-link", options, () =>
        buildClient().getFundingLink({
          ...(options.amount != null && { amount: options.amount }),
          ...(options.destination != null && { destination: options.destination as "agent" | "main" }),
        }),
      )
    })
}
