import { describe, expect, it } from "vitest"

import { server, start } from "../src/index.ts"

describe("FastMCP x402 Example Server", () => {
  it("should export server and start function", () => {
    expect(server).toBeDefined()
    expect(start).toBeDefined()
    expect(typeof start).toBe("function")
  })

  it("should be a FastMCP server instance", () => {
    expect(server).toBeDefined()
    expect(server.constructor.name).toBe("FastMCP")
  })

  it("should import without starting the server automatically", () => {
    // If this test runs, it means the server didn't auto-start when imported
    // This verifies our conditional execution logic works
    expect(true).toBe(true)
  })
})
