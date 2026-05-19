import { registerVersionCommand } from "@/cli/commands/version.ts"
import { MIN_SKILL_VERSION, VERSION } from "@/version.ts"
import { Command } from "commander"
import { afterEach, describe, expect, it, vi } from "vitest"

describe("ampersend version", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("prints a JSON envelope with cliVersion and minSkillVersion", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {})
    vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`exit:${code ?? 0}`)
    }) as never)

    const program = new Command()
    registerVersionCommand(program)

    await expect(program.parseAsync(["node", "ampersend", "version"])).rejects.toThrow("exit:0")

    expect(logSpy).toHaveBeenCalledTimes(1)
    const payload = JSON.parse(logSpy.mock.calls[0]![0] as string) as unknown
    expect(payload).toEqual({
      ok: true,
      data: { cliVersion: VERSION, minSkillVersion: MIN_SKILL_VERSION },
    })
  })
})
