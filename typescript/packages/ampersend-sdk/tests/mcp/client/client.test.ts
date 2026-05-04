import { Client } from "@/mcp/client/index.ts"
import type { PaymentAuthorization, PaymentRequest } from "@/x402/envelopes.ts"
import type { Authorization, X402Treasurer } from "@/x402/treasurer.ts"
import { McpError } from "@modelcontextprotocol/sdk/types.js"
import { beforeEach, describe, expect, it, vi } from "vitest"

// Wire-format 402 response embedded in the MCP error — v1-shaped per the MCP spec.
const mockX402Response = {
  x402Version: 1,
  accepts: [
    {
      scheme: "exact",
      network: "base-sepolia",
      maxAmountRequired: "1000000000000000000",
      resource: "http://test.com",
      description: "Test payment",
      mimeType: "application/json",
      payTo: "0x" + "1".repeat(40),
      maxTimeoutSeconds: 300,
      asset: "0x" + "2".repeat(40),
    },
  ],
}

// The PaymentRequest envelope the treasurer should see.
const expectedPaymentRequest: PaymentRequest = {
  protocol: "x402-v1",
  data: { x402Version: 1, accepts: mockX402Response.accepts as any },
}

const v1WirePayment = {
  x402Version: 1 as const,
  scheme: "exact",
  network: "base-sepolia",
  payload: {
    signature: "0x" + "a".repeat(130),
    authorization: {
      from: "0x" + "1".repeat(40),
      to: "0x" + "2".repeat(40),
      value: "1000000000000000000",
      validAfter: "0",
      validBefore: "9999999999",
      nonce: "0x" + "3".repeat(64),
    },
  },
}

const mockPayment: PaymentAuthorization = { protocol: "x402-v1", data: v1WirePayment }
const expectedWirePayment = v1WirePayment

const mockAuthorization: Authorization = {
  payment: mockPayment,
  authorizationId: "test-auth-id",
  accepted: mockX402Response.accepts[0] as never,
}

const testToolParams = { name: "test_tool", arguments: { arg1: "value1" } }
const testResourceParams = { uri: "test://resource" }

function createMcpError(data: unknown) {
  return new McpError(402, "Payment required for tool execution", data)
}

function createMockTreasurer(overrides?: Partial<X402Treasurer>): X402Treasurer {
  return {
    onPaymentRequired: vi.fn(),
    onStatus: vi.fn(),
    ...overrides,
  }
}

function setupClient(treasurer?: X402Treasurer) {
  const mockCallTool = vi.fn()
  const mockReadResource = vi.fn()
  const mockTreasurer = treasurer || createMockTreasurer()

  const client = new Client({ name: "test", version: "1.0" }, { mcpOptions: {}, treasurer: mockTreasurer })

  vi.spyOn(Object.getPrototypeOf(Object.getPrototypeOf(client)), "callTool").mockImplementation(mockCallTool)
  vi.spyOn(Object.getPrototypeOf(Object.getPrototypeOf(client)), "readResource").mockImplementation(mockReadResource)

  return { client, mockCallTool, mockReadResource, treasurer: mockTreasurer }
}

function expectPaymentRequired(treasurer: X402Treasurer, method: string, params: unknown) {
  expect(treasurer.onPaymentRequired).toHaveBeenCalledWith(expectedPaymentRequest, { method, params })
}

function expectRetryWithPayment(
  mockFn: ReturnType<typeof vi.fn>,
  params: Record<string, unknown>,
  isCallTool = true,
  callNumber = 2,
) {
  const expectedParams = { ...params, _meta: { "x402/payment": expectedWirePayment } }
  if (isCallTool) {
    expect(mockFn).toHaveBeenNthCalledWith(callNumber, expectedParams, undefined, undefined)
  } else {
    expect(mockFn).toHaveBeenNthCalledWith(callNumber, expectedParams, undefined)
  }
}

describe("Client", () => {
  let client: Client
  let mockCallTool: ReturnType<typeof vi.fn>
  let mockReadResource: ReturnType<typeof vi.fn>
  let treasurer: X402Treasurer

  beforeEach(() => {
    vi.clearAllMocks()
    const setup = setupClient()
    client = setup.client
    mockCallTool = setup.mockCallTool
    mockReadResource = setup.mockReadResource
    treasurer = setup.treasurer
  })

  describe("payment retry flow", () => {
    it("should retry callTool with payment in _meta after 402 error", async () => {
      vi.mocked(treasurer.onPaymentRequired).mockResolvedValue(mockAuthorization)

      mockCallTool.mockRejectedValueOnce(createMcpError(mockX402Response))
      const successResult = { content: [{ type: "text", text: "success" }] }
      mockCallTool.mockResolvedValueOnce(successResult)

      const result = await client.callTool(testToolParams)

      expect(mockCallTool).toHaveBeenNthCalledWith(1, testToolParams, undefined, undefined)
      expectPaymentRequired(treasurer, "tools/call", testToolParams)
      expectRetryWithPayment(mockCallTool, testToolParams, true)
      expect(result).toBe(successResult)
      expect(mockCallTool).toHaveBeenCalledTimes(2)

      expect(treasurer.onStatus).toHaveBeenCalledWith("sending", mockAuthorization)
      expect(treasurer.onStatus).toHaveBeenCalledWith("accepted", mockAuthorization)
    })

    it("should retry readResource with payment in _meta after 402 error", async () => {
      vi.mocked(treasurer.onPaymentRequired).mockResolvedValue(mockAuthorization)

      mockReadResource.mockRejectedValueOnce(createMcpError(mockX402Response))
      const successResult = { contents: [{ uri: "test://resource", text: "content" }] }
      mockReadResource.mockResolvedValueOnce(successResult)

      const result = await client.readResource(testResourceParams)

      expect(mockReadResource).toHaveBeenNthCalledWith(1, testResourceParams, undefined)
      expectPaymentRequired(treasurer, "resources/read", testResourceParams)
      expectRetryWithPayment(mockReadResource, testResourceParams, false)
      expect(result).toBe(successResult)
      expect(mockReadResource).toHaveBeenCalledTimes(2)

      expect(treasurer.onStatus).toHaveBeenCalledWith("sending", mockAuthorization)
      expect(treasurer.onStatus).toHaveBeenCalledWith("accepted", mockAuthorization)
    })
  })

  describe("payment treasurer decisions", () => {
    it("should not retry when treasurer returns null (decline)", async () => {
      vi.mocked(treasurer.onPaymentRequired).mockResolvedValue(null)
      const originalError = createMcpError(mockX402Response)
      mockCallTool.mockRejectedValueOnce(originalError)

      await expect(client.callTool(testToolParams)).rejects.toBe(originalError)

      expect(mockCallTool).toHaveBeenCalledTimes(1)
      expect(treasurer.onPaymentRequired).toHaveBeenCalledOnce()
      expect(treasurer.onStatus).not.toHaveBeenCalled()
    })

    it("should throw when treasurer throws error", async () => {
      const customError = new Error("Payment failed")
      vi.mocked(treasurer.onPaymentRequired).mockRejectedValue(customError)
      mockCallTool.mockRejectedValueOnce(createMcpError(mockX402Response))

      await expect(client.callTool(testToolParams)).rejects.toBe(customError)

      expect(mockCallTool).toHaveBeenCalledTimes(1)
      expect(treasurer.onPaymentRequired).toHaveBeenCalledOnce()
      expect(treasurer.onStatus).not.toHaveBeenCalled()
    })
  })

  describe("error extraction", () => {
    it("should extract x402 data from McpError", async () => {
      vi.mocked(treasurer.onPaymentRequired).mockResolvedValue(null)
      mockCallTool.mockRejectedValueOnce(createMcpError(mockX402Response))

      try {
        await client.callTool(testToolParams)
      } catch {
        // Expected to throw
      }

      expectPaymentRequired(treasurer, "tools/call", testToolParams)
    })
  })

  describe("non-402 responses", () => {
    it("should return success without retry for 200 responses", async () => {
      const successResult = { content: [{ type: "text", text: "success" }] }
      mockCallTool.mockResolvedValueOnce(successResult)

      const result = await client.callTool(testToolParams)

      expect(result).toBe(successResult)
      expect(mockCallTool).toHaveBeenCalledTimes(1)
      expect(treasurer.onPaymentRequired).not.toHaveBeenCalled()
      expect(treasurer.onStatus).not.toHaveBeenCalled()
    })

    it("should throw non-402 errors without retry", async () => {
      const serverError = new Error("Server error")
      mockCallTool.mockRejectedValueOnce(serverError)

      await expect(client.callTool(testToolParams)).rejects.toBe(serverError)

      expect(mockCallTool).toHaveBeenCalledTimes(1)
      expect(treasurer.onPaymentRequired).not.toHaveBeenCalled()
      expect(treasurer.onStatus).not.toHaveBeenCalled()
    })
  })

  describe("payment status tracking", () => {
    it("should call onStatus for payment lifecycle", async () => {
      const mockTreasurer = createMockTreasurer()
      vi.mocked(mockTreasurer.onPaymentRequired).mockResolvedValue(mockAuthorization)

      const clientWithTracking = new Client(
        { name: "test", version: "1.0" },
        {
          mcpOptions: {},
          treasurer: mockTreasurer,
        },
      )
      Object.defineProperty(clientWithTracking, "transport", { value: { supportsX402: true }, writable: true })
      const mockCallToolTracking = vi.fn()
      vi.spyOn(Object.getPrototypeOf(Object.getPrototypeOf(clientWithTracking)), "callTool").mockImplementation(
        mockCallToolTracking,
      )

      mockCallToolTracking.mockRejectedValueOnce(createMcpError(mockX402Response))
      const successResult = { content: [{ type: "text", text: "success" }] }
      mockCallToolTracking.mockResolvedValueOnce(successResult)

      await clientWithTracking.callTool(testToolParams)

      expect(mockTreasurer.onStatus).toHaveBeenCalledTimes(2)
      expect(mockTreasurer.onStatus).toHaveBeenNthCalledWith(1, "sending", mockAuthorization)
      expect(mockTreasurer.onStatus).toHaveBeenNthCalledWith(2, "accepted", mockAuthorization)
    })

    it("should call onStatus with rejected when payment fails", async () => {
      const mockTreasurer = createMockTreasurer()
      vi.mocked(mockTreasurer.onPaymentRequired).mockResolvedValue(mockAuthorization)

      const clientWithTracking = new Client(
        { name: "test", version: "1.0" },
        {
          mcpOptions: {},
          treasurer: mockTreasurer,
        },
      )
      Object.defineProperty(clientWithTracking, "transport", { value: { supportsX402: true }, writable: true })
      const mockCallToolTracking = vi.fn()
      vi.spyOn(Object.getPrototypeOf(Object.getPrototypeOf(clientWithTracking)), "callTool").mockImplementation(
        mockCallToolTracking,
      )

      mockCallToolTracking.mockRejectedValueOnce(createMcpError(mockX402Response))
      const rejectionError = createMcpError({ ...mockX402Response, error: "Insufficient funds" })
      mockCallToolTracking.mockRejectedValueOnce(rejectionError)

      await expect(clientWithTracking.callTool(testToolParams)).rejects.toBe(rejectionError)

      expect(mockTreasurer.onStatus).toHaveBeenCalledTimes(2)
      expect(mockTreasurer.onStatus).toHaveBeenNthCalledWith(1, "sending", mockAuthorization)
      expect(mockTreasurer.onStatus).toHaveBeenNthCalledWith(2, "rejected", mockAuthorization)
    })

    it("should call onStatus with error when non-payment failure occurs", async () => {
      const mockTreasurer = createMockTreasurer()
      vi.mocked(mockTreasurer.onPaymentRequired).mockResolvedValue(mockAuthorization)

      const clientWithTracking = new Client(
        { name: "test", version: "1.0" },
        {
          mcpOptions: {},
          treasurer: mockTreasurer,
        },
      )
      Object.defineProperty(clientWithTracking, "transport", { value: { supportsX402: true }, writable: true })
      const mockCallToolTracking = vi.fn()
      vi.spyOn(Object.getPrototypeOf(Object.getPrototypeOf(clientWithTracking)), "callTool").mockImplementation(
        mockCallToolTracking,
      )

      mockCallToolTracking.mockRejectedValueOnce(createMcpError(mockX402Response))
      const connectionError = new Error("Connection timeout")
      mockCallToolTracking.mockRejectedValueOnce(connectionError)

      await expect(clientWithTracking.callTool(testToolParams)).rejects.toBe(connectionError)

      expect(mockTreasurer.onStatus).toHaveBeenCalledTimes(2)
      expect(mockTreasurer.onStatus).toHaveBeenNthCalledWith(1, "sending", mockAuthorization)
      expect(mockTreasurer.onStatus).toHaveBeenNthCalledWith(2, "error", mockAuthorization)
    })
  })
})
