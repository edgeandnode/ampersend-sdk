import type { Command } from "commander"

import { MIN_SKILL_VERSION, VERSION } from "../../version.ts"
import { ok } from "../envelope.ts"

export function registerVersionCommand(program: Command): void {
  program
    .command("version")
    .description("Print CLI version and minimum supported skill version as JSON")
    .action(() => {
      console.log(JSON.stringify(ok({ cliVersion: VERSION, minSkillVersion: MIN_SKILL_VERSION }), null, 2))
      process.exit(0)
    })
}
