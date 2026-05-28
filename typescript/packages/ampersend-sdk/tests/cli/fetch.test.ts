import {
  buildPaymentReceipt,
  buildReceiptFromResponse,
  buildRequestInit,
  decodeBase64Header,
  executeFetch,
  headersToObject,
  parseHeaders,
  runFetch,
  runInspect,
} from "@/cli/commands/fetch.ts"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

describe("CLI Fetch Helpers", () => {
  describe("parseHeaders", () => {
    // Mock process.exit to capture calls without actually exiting
    const mockExit = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit called")
    })
    const mockConsoleError = vi.spyOn(console, "error").mockImplementation(() => {})

    afterEach(() => {
      mockExit.mockClear()
      mockConsoleError.mockClear()
    })

    it("should return empty Headers for undefined input", () => {
      const headers = parseHeaders(undefined)
      expect([...headers.entries()]).toEqual([])
    })

    it("should return empty Headers for empty array", () => {
      const headers = parseHeaders([])
      expect([...headers.entries()]).toEqual([])
    })

    it("should parse single header", () => {
      const headers = parseHeaders(["Content-Type: application/json"])
      expect(headers.get("content-type")).toBe("application/json")
    })

    it("should parse multiple headers", () => {
      const headers = parseHeaders(["Content-Type: application/json", "Authorization: Bearer token123"])
      expect(headers.get("content-type")).toBe("application/json")
      expect(headers.get("authorization")).toBe("Bearer token123")
    })

    it("should handle header values with colons", () => {
      const headers = parseHeaders(["X-Custom: value:with:colons"])
      expect(headers.get("x-custom")).toBe("value:with:colons")
    })

    it("should trim whitespace from key and value", () => {
      const headers = parseHeaders(["  Content-Type  :  application/json  "])
      expect(headers.get("content-type")).toBe("application/json")
    })

    it("should exit on invalid header format", () => {
      expect(() => parseHeaders(["InvalidHeader"])).toThrow("process.exit called")
      expect(mockConsoleError).toHaveBeenCalledWith('Invalid header format: InvalidHeader (expected "Key: Value")')
      expect(mockExit).toHaveBeenCalledWith(1)
    })
  })

  describe("headersToObject", () => {
    it("should convert empty Headers to empty object", () => {
      const headers = new Headers()
      const obj = headersToObject(headers)
      expect(obj).toEqual({})
    })

    it("should convert Headers to object", () => {
      const headers = new Headers()
      headers.set("Content-Type", "application/json")
      headers.set("Authorization", "Bearer token")

      const obj = headersToObject(headers)

      expect(obj).toEqual({
        "content-type": "application/json",
        authorization: "Bearer token",
      })
    })
  })

  describe("decodeBase64Header", () => {
    it("should decode base64 JSON to object", () => {
      const payload = { foo: "bar", num: 42 }
      const encoded = Buffer.from(JSON.stringify(payload)).toString("base64")

      const decoded = decodeBase64Header(encoded)

      expect(decoded).toEqual(payload)
    })

    it("should handle nested objects", () => {
      const payload = { nested: { deep: { value: "test" } } }
      const encoded = Buffer.from(JSON.stringify(payload)).toString("base64")

      const decoded = decodeBase64Header(encoded)

      expect(decoded).toEqual(payload)
    })

    it("should throw on invalid base64", () => {
      // Invalid base64 that decodes to invalid JSON
      const invalidBase64 = Buffer.from("not json").toString("base64")

      expect(() => decodeBase64Header(invalidBase64)).toThrow()
    })

    it("should handle x402 payment requirements format", () => {
      const paymentRequirements = {
        scheme: "exact",
        network: "base",
        maxAmountRequired: "1000000",
        resource: "https://api.example.com/endpoint",
        description: "API access fee",
        mimeType: "application/json",
        payTo: "0x1234567890123456789012345678901234567890",
        maxTimeoutSeconds: 300,
        asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        outputSchema: null,
        extra: null,
      }
      const encoded = Buffer.from(JSON.stringify(paymentRequirements)).toString("base64")

      const decoded = decodeBase64Header(encoded)

      expect(decoded).toEqual(paymentRequirements)
    })
  })

  describe("buildRequestInit", () => {
    it("should build GET request without body", () => {
      const headers = new Headers()
      headers.set("Accept", "application/json")

      const init = buildRequestInit({ method: "GET", inspect: false, pay: false, raw: false, headers: false }, headers)

      expect(init.method).toBe("GET")
      expect(init.headers).toBe(headers)
      expect(init.body).toBeUndefined()
    })

    it("should build POST request with body", () => {
      const headers = new Headers()
      headers.set("Content-Type", "application/json")

      const init = buildRequestInit(
        { method: "POST", data: '{"key":"value"}', inspect: false, pay: false, raw: false, headers: false },
        headers,
      )

      expect(init.method).toBe("POST")
      expect(init.body).toBe('{"key":"value"}')
    })

    it("should handle empty string data as body", () => {
      const headers = new Headers()

      const init = buildRequestInit(
        { method: "POST", data: "", inspect: false, pay: false, raw: false, headers: false },
        headers,
      )

      expect(init.body).toBe("")
    })

    it("should not include body when data is undefined", () => {
      const headers = new Headers()

      const init = buildRequestInit(
        { method: "POST", data: undefined, inspect: false, pay: false, raw: false, headers: false },
        headers,
      )

      expect("body" in init).toBe(false)
    })
  })
})

class ExitError extends Error {
  constructor(public code: number) {
    super(`process.exit(${code})`)
  }
}

/**
 * Encode a JSON value as a base64 string suitable for the x402 `payment-required`
 * (or `payment-response`) header.
 */
function encodeHeader(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64")
}

const SAMPLE_V2_REQUIREMENTS = {
  x402Version: 2,
  resource: { url: "https://example.test/paid" },
  accepts: [
    {
      scheme: "exact",
      network: "eip155:8453",
      asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      amount: "1000",
      payTo: "0x1234567890123456789012345678901234567890",
      maxTimeoutSeconds: 300,
      extra: {},
    },
  ],
}

describe("CLI Fetch Behavior", () => {
  let consoleOutput: Array<string> = []
  let fetchSpy: ReturnType<typeof vi.fn>
  let mockConsoleLog: ReturnType<typeof vi.spyOn>
  let mockConsoleError: ReturnType<typeof vi.spyOn>
  let mockExit: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    consoleOutput = []
    fetchSpy = vi.fn()
    vi.stubGlobal("fetch", fetchSpy)
    mockConsoleLog = vi.spyOn(console, "log").mockImplementation((...args: Array<unknown>) => {
      consoleOutput.push(args.map(String).join(" "))
    })
    mockConsoleError = vi.spyOn(console, "error").mockImplementation(() => {})
    mockExit = vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new ExitError(code as number)
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    mockConsoleLog.mockRestore()
    mockConsoleError.mockRestore()
    mockExit.mockRestore()
  })

  function lastJsonOutput(): Record<string, unknown> {
    const last = consoleOutput[consoleOutput.length - 1]
    if (last === undefined) throw new Error("no console.log output captured")
    return JSON.parse(last) as Record<string, unknown>
  }

  describe("naked fetch (no --pay)", () => {
    it("returns ok envelope on 200", async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({ greeting: "hi" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )

      await runFetch("https://example.test/free", {
        method: "GET",
        inspect: false,
        pay: false,
        raw: false,
        headers: false,
      })

      const envelope = lastJsonOutput()
      expect(envelope.ok).toBe(true)
      const data = envelope.data as { status: number; body: unknown }
      expect(data.status).toBe(200)
      expect(data.body).toEqual({ greeting: "hi" })
    })

    it("returns PAYMENT_REQUIRED on 402 without calling any payment machinery", async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response("", {
          status: 402,
          headers: { "payment-required": encodeHeader(SAMPLE_V2_REQUIREMENTS) },
        }),
      )

      await runFetch("https://example.test/paid", {
        method: "GET",
        inspect: false,
        pay: false,
        raw: false,
        headers: false,
      })

      const envelope = lastJsonOutput()
      expect(envelope.ok).toBe(false)
      const error = envelope.error as { code: string; requirements: unknown }
      expect(error.code).toBe("PAYMENT_REQUIRED")
      expect(error.requirements).toEqual(SAMPLE_V2_REQUIREMENTS)
      // Only one fetch was made — no retry via wrapFetchWithPayment.
      expect(fetchSpy).toHaveBeenCalledTimes(1)
    })

    it("falls back to v1 body when payment-required header is absent", async () => {
      const v1Body = {
        x402Version: 1,
        accepts: [
          {
            scheme: "exact",
            network: "base",
            maxAmountRequired: "1000",
            resource: "https://example.test/paid",
            description: "test",
            mimeType: "application/json",
            outputSchema: {},
            payTo: "0x1234567890123456789012345678901234567890",
            maxTimeoutSeconds: 300,
            asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
            extra: {},
          },
        ],
      }
      fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify(v1Body), { status: 402 }))

      await runFetch("https://example.test/paid", {
        method: "GET",
        inspect: false,
        pay: false,
        raw: false,
        headers: false,
      })

      const envelope = lastJsonOutput()
      expect(envelope.ok).toBe(false)
      const error = envelope.error as { code: string; requirements: unknown }
      expect(error.code).toBe("PAYMENT_REQUIRED")
      expect(error.requirements).toEqual(v1Body)
    })

    it("emits PARSE_ERROR (exit 0 in JSON mode) when 402 has neither header nor parseable body", async () => {
      fetchSpy.mockResolvedValueOnce(new Response("not json at all {{{", { status: 402 }))

      // JSON mode: remote misbehavior, not user error — caller reads the
      // envelope, so we exit cleanly rather than throwing via process.exit.
      await runFetch("https://example.test/paid", {
        method: "GET",
        inspect: false,
        pay: false,
        raw: false,
        headers: false,
      })

      const envelope = lastJsonOutput()
      expect(envelope.ok).toBe(false)
      const error = envelope.error as { code: string; message: string }
      expect(error.code).toBe("PARSE_ERROR")
      expect(error.message).toMatch(/Failed to parse payment requirements/)
      expect(mockExit).not.toHaveBeenCalled()
    })

    it("exits 1 in --raw mode when 402 is unparseable", async () => {
      fetchSpy.mockResolvedValueOnce(new Response("not json at all {{{", { status: 402 }))

      await expect(
        runFetch("https://example.test/paid", {
          method: "GET",
          inspect: false,
          pay: false,
          raw: true,
          headers: false,
        }),
      ).rejects.toThrow(ExitError)

      expect(mockConsoleError).toHaveBeenCalledWith(expect.stringMatching(/Failed to parse payment requirements/))
    })
  })

  describe("--inspect", () => {
    it("returns ok envelope with paymentRequired:true on 402", async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response("", {
          status: 402,
          headers: { "payment-required": encodeHeader(SAMPLE_V2_REQUIREMENTS) },
        }),
      )

      await runInspect("https://example.test/paid", {
        method: "GET",
        inspect: true,
        pay: false,
        raw: false,
        headers: false,
      })

      const envelope = lastJsonOutput()
      expect(envelope.ok).toBe(true)
      const data = envelope.data as { url: string; paymentRequired: boolean; requirements: unknown }
      expect(data.url).toBe("https://example.test/paid")
      expect(data.paymentRequired).toBe(true)
      expect(data.requirements).toEqual(SAMPLE_V2_REQUIREMENTS)
    })

    it("returns paymentRequired:false on 200", async () => {
      fetchSpy.mockResolvedValueOnce(new Response("ok", { status: 200 }))

      await runInspect("https://example.test/free", {
        method: "GET",
        inspect: true,
        pay: false,
        raw: false,
        headers: false,
      })

      const envelope = lastJsonOutput()
      expect(envelope.ok).toBe(true)
      const data = envelope.data as { paymentRequired: boolean }
      expect(data.paymentRequired).toBe(false)
    })
  })

  describe("buildPaymentReceipt", () => {
    const selected = {
      amount: "1000",
      asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      network: "eip155:8453",
      payTo: "0x1234567890123456789012345678901234567890",
      scheme: "exact",
    }

    it("combines signed requirements with settle response", () => {
      const receipt = buildPaymentReceipt(selected, {
        transaction: "0xabc123",
        payer: "0xpayer0000000000000000000000000000000001",
      })

      expect(receipt).toEqual({
        amount: "1000",
        asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        network: "eip155:8453",
        payTo: "0x1234567890123456789012345678901234567890",
        scheme: "exact",
        txHash: "0xabc123",
        payer: "0xpayer0000000000000000000000000000000001",
      })
    })

    it("omits payer when settle response has none", () => {
      const receipt = buildPaymentReceipt(selected, { transaction: "0xabc123" })

      expect(receipt).not.toHaveProperty("payer")
      expect(receipt.txHash).toBe("0xabc123")
      expect(receipt.amount).toBe("1000")
    })
  })

  describe("buildReceiptFromResponse", () => {
    const selected = {
      amount: "1000",
      asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      network: "eip155:8453",
      payTo: "0x1234567890123456789012345678901234567890",
      scheme: "exact",
    }

    it("returns undefined when no payment was made (no selected requirements)", () => {
      const response = new Response("", { status: 200 })
      expect(buildReceiptFromResponse(undefined, response)).toBeUndefined()
    })

    it("returns undefined when the server sent no settle header", () => {
      const response = new Response("", { status: 200 })
      expect(buildReceiptFromResponse(selected, response)).toBeUndefined()
    })

    it("builds a receipt from selected requirements + settle header", () => {
      const response = new Response("", {
        status: 200,
        headers: { "payment-response": encodeHeader({ transaction: "0xabc", payer: "0xpayer" }) },
      })
      const receipt = buildReceiptFromResponse(selected, response)
      expect(receipt).toMatchObject({ amount: "1000", txHash: "0xabc", payer: "0xpayer" })
    })
  })

  describe("exit-code policy", () => {
    it("emits REQUEST_ERROR (exit 0 in JSON mode) when fetch throws", async () => {
      fetchSpy.mockRejectedValueOnce(new Error("getaddrinfo ENOTFOUND example.test"))

      await executeFetch("https://example.test/paid", {
        method: "GET",
        inspect: false,
        pay: false,
        raw: false,
        headers: false,
      })

      const envelope = lastJsonOutput()
      expect(envelope.ok).toBe(false)
      const error = envelope.error as { code: string; message: string }
      expect(error.code).toBe("REQUEST_ERROR")
      expect(error.message).toMatch(/ENOTFOUND/)
      expect(mockExit).not.toHaveBeenCalled()
    })

    it("exits 1 in --raw mode when fetch throws", async () => {
      fetchSpy.mockRejectedValueOnce(new Error("getaddrinfo ENOTFOUND example.test"))

      await expect(
        executeFetch("https://example.test/paid", {
          method: "GET",
          inspect: false,
          pay: false,
          raw: true,
          headers: false,
        }),
      ).rejects.toThrow(ExitError)
    })
  })

  describe("argument validation", () => {
    it("rejects --pay together with --inspect", async () => {
      await expect(
        executeFetch("https://example.test/paid", {
          method: "GET",
          inspect: true,
          pay: true,
          raw: false,
          headers: false,
        }),
      ).rejects.toThrow(ExitError)

      const envelope = lastJsonOutput()
      expect(envelope.ok).toBe(false)
      const error = envelope.error as { code: string }
      expect(error.code).toBe("INVALID_ARGS")
      // No outbound fetch was issued.
      expect(fetchSpy).not.toHaveBeenCalled()
    })
  })
})
