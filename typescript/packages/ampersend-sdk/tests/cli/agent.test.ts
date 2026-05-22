import { parseIntFlag, parsePreset } from "@/cli/commands/agent.ts"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Validation helpers for the `ampersend agent` subcommands.
 *
 * Both helpers print an `err` envelope and call `process.exit(1)` on bad
 * input. That side-effect IS the contract — the CLI's caller (a script or
 * a skill) reads the envelope from stdout and exit code. Tests therefore
 * stub `process.exit` and `console.log`, then assert what was printed.
 */
describe("CLI agent helpers", () => {
  const mockExit = vi.spyOn(process, "exit").mockImplementation(() => {
    throw new Error("process.exit called")
  })
  const mockLog = vi.spyOn(console, "log").mockImplementation(() => {})

  beforeEach(() => {
    mockExit.mockClear()
    mockLog.mockClear()
  })

  afterEach(() => {
    mockExit.mockClear()
    mockLog.mockClear()
  })

  describe("parsePreset", () => {
    it("returns undefined when no preset is supplied", () => {
      expect(parsePreset(undefined)).toBeUndefined()
      expect(mockExit).not.toHaveBeenCalled()
    })

    it.each(["1d", "30d", "all"] as const)("accepts %s", (preset) => {
      expect(parsePreset(preset)).toBe(preset)
      expect(mockExit).not.toHaveBeenCalled()
    })

    it("rejects an unknown preset with an INVALID_PRESET envelope", () => {
      expect(() => parsePreset("yesterday")).toThrow("process.exit called")

      expect(mockExit).toHaveBeenCalledWith(1)
      const printed = JSON.parse(mockLog.mock.calls[0]?.[0] as string)
      expect(printed.ok).toBe(false)
      expect(printed.error.code).toBe("INVALID_PRESET")
      expect(printed.error.message).toMatch(/yesterday/)
      expect(printed.error.message).toMatch(/1d, 30d, all/)
    })

    it("rejects empty string (not the same as undefined)", () => {
      // An explicit empty --preset= shouldn't silently pass; treat it as bad.
      expect(() => parsePreset("")).toThrow("process.exit called")
      expect(mockExit).toHaveBeenCalledWith(1)
    })
  })

  describe("parseIntFlag", () => {
    it("returns undefined when no value is supplied", () => {
      expect(parseIntFlag("limit", undefined)).toBeUndefined()
      expect(mockExit).not.toHaveBeenCalled()
    })

    it("parses a positive integer", () => {
      expect(parseIntFlag("limit", "20")).toBe(20)
    })

    it("parses 1 as the minimum valid value", () => {
      expect(parseIntFlag("page", "1")).toBe(1)
    })

    it.each(["0", "-1", "1.5", "abc", ""])("rejects %s as not a positive integer", (input) => {
      expect(() => parseIntFlag("limit", input)).toThrow("process.exit called")
      expect(mockExit).toHaveBeenCalledWith(1)
      const printed = JSON.parse(mockLog.mock.calls[0]?.[0] as string)
      expect(printed.ok).toBe(false)
      expect(printed.error.code).toBe("INVALID_FLAG")
      expect(printed.error.message).toMatch(/--limit/)
    })

    it("uses the flag name in the error message", () => {
      expect(() => parseIntFlag("page", "0")).toThrow("process.exit called")
      const printed = JSON.parse(mockLog.mock.calls[0]?.[0] as string)
      expect(printed.error.message).toMatch(/--page/)
    })
  })
})
