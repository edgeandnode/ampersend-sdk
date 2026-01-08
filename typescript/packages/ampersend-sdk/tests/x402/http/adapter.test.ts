import { wrapWithAmpersend } from "@/x402/http/adapter.ts"
import type { Authorization, PaymentContext, X402Treasurer } from "@/x402/treasurer.ts"
import type {
  PaymentCreatedContext,
  PaymentCreationContext,
  PaymentCreationFailureContext,
  x402Client,
} from "@x402/core/client"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { PaymentPayload, PaymentRequirements } from "x402/types"

function createMockRequirements(): PaymentRequirements {
  return {
    scheme: "exact",
    network: "base-sepolia",
    maxAmountRequired: "1000000",
    resource: "https://api.example.com/resource",
    description: "Test payment",
    mimeType: "application/json",
    payTo: "0x1234567890123456789012345678901234567890",
    maxTimeoutSeconds: 300,
    asset: "USDC",
  }
}

function createMockPaymentPayload(): PaymentPayload {
  return {
    x402Version: 1,
    scheme: "exact",
    network: "base-sepolia",
    payload: {
      signature: "0xmocksignature",
      authorization: {
        from: "0xfrom",
        to: "0xto",
        value: "1000000",
        validAfter: "0",
        validBefore: "999999999999",
        nonce: "0xnonce",
      },
    },
  }
}

function createMockAuthorization(payment: PaymentPayload): Authorization {
  return {
    payment,
    authorizationId: "test-auth-id",
  }
}

describe("wrapWithAmpersend", () => {
  let mockClient: x402Client & {
    _beforeHooks: Array<(ctx: PaymentCreationContext) => Promise<{ abort: true; reason: string } | void>>
    _afterHooks: Array<(ctx: PaymentCreatedContext) => Promise<void>>
    _failureHooks: Array<(ctx: PaymentCreationFailureContext) => Promise<{ recovered: true; payload: any } | void>>
    _registeredSchemes: Map<string, any>
  }
  let mockTreasurer: X402Treasurer & {
    onPaymentRequired: ReturnType<typeof vi.fn>
    onStatus: ReturnType<typeof vi.fn>
  }

  beforeEach(() => {
    // Create mock client that captures hooks
    const beforeHooks: typeof mockClient._beforeHooks = []
    const afterHooks: typeof mockClient._afterHooks = []
    const failureHooks: typeof mockClient._failureHooks = []
    const registeredSchemes = new Map<string, any>()

    mockClient = {
      _beforeHooks: beforeHooks,
      _afterHooks: afterHooks,
      _failureHooks: failureHooks,
      _registeredSchemes: registeredSchemes,
      registerV1: vi.fn((network: string, schemeClient: any) => {
        registeredSchemes.set(network, schemeClient)
        return mockClient
      }),
      onBeforePaymentCreation: vi.fn((hook) => {
        beforeHooks.push(hook)
        return mockClient
      }),
      onAfterPaymentCreation: vi.fn((hook) => {
        afterHooks.push(hook)
        return mockClient
      }),
      onPaymentCreationFailure: vi.fn((hook) => {
        failureHooks.push(hook)
        return mockClient
      }),
    } as any

    mockTreasurer = {
      onPaymentRequired: vi.fn(),
      onStatus: vi.fn(),
    }
  })

  describe("registration", () => {
    it("registers scheme client on all specified networks", () => {
      wrapWithAmpersend(mockClient, mockTreasurer, ["base", "base-sepolia"])

      expect(mockClient.registerV1).toHaveBeenCalledTimes(2)
      expect(mockClient._registeredSchemes.has("base")).toBe(true)
      expect(mockClient._registeredSchemes.has("base-sepolia")).toBe(true)
    })

    it("uses same scheme client instance for all networks", () => {
      wrapWithAmpersend(mockClient, mockTreasurer, ["base", "base-sepolia"])

      const baseClient = mockClient._registeredSchemes.get("base")
      const sepoliaClient = mockClient._registeredSchemes.get("base-sepolia")
      expect(baseClient).toBe(sepoliaClient)
    })

    it("scheme client has correct scheme property", () => {
      wrapWithAmpersend(mockClient, mockTreasurer, ["base"])

      const schemeClient = mockClient._registeredSchemes.get("base")
      expect(schemeClient.scheme).toBe("exact")
    })
  })

  describe("happy path - payment approved", () => {
    it("calls treasurer with requirements and context", async () => {
      const requirements = createMockRequirements()
      const payment = createMockPaymentPayload()
      const authorization = createMockAuthorization(payment)

      mockTreasurer.onPaymentRequired.mockResolvedValue(authorization)

      wrapWithAmpersend(mockClient, mockTreasurer, ["base-sepolia"])

      const context: PaymentCreationContext = {
        paymentRequired: {
          x402Version: 1,
          accepts: [requirements],
          resource: "https://api.example.com/resource",
        },
        selectedRequirements: requirements,
      } as any

      await mockClient._beforeHooks[0](context)

      expect(mockTreasurer.onPaymentRequired).toHaveBeenCalledWith([requirements], {
        method: "http",
        params: {
          resource: "https://api.example.com/resource",
        },
      })
    })

    it("scheme client retrieves payment payload from store", async () => {
      const requirements = createMockRequirements()
      const payment = createMockPaymentPayload()
      const authorization = createMockAuthorization(payment)

      mockTreasurer.onPaymentRequired.mockResolvedValue(authorization)

      wrapWithAmpersend(mockClient, mockTreasurer, ["base-sepolia"])

      const context: PaymentCreationContext = {
        paymentRequired: {
          x402Version: 1,
          accepts: [requirements],
          resource: "https://api.example.com/resource",
        },
        selectedRequirements: requirements,
      } as any

      // Store authorization via hook
      await mockClient._beforeHooks[0](context)

      // Retrieve via scheme client
      const schemeClient = mockClient._registeredSchemes.get("base-sepolia")
      const result = await schemeClient.createPaymentPayload(1, requirements)

      expect(result).toEqual({
        x402Version: 1,
        payload: payment.payload,
      })
    })

    it("calls onStatus with sending after payment created", async () => {
      const requirements = createMockRequirements()
      const payment = createMockPaymentPayload()
      const authorization = createMockAuthorization(payment)

      mockTreasurer.onPaymentRequired.mockResolvedValue(authorization)

      wrapWithAmpersend(mockClient, mockTreasurer, ["base-sepolia"])

      const beforeContext: PaymentCreationContext = {
        paymentRequired: {
          x402Version: 1,
          accepts: [requirements],
          resource: "https://api.example.com/resource",
        },
        selectedRequirements: requirements,
      } as any

      // Trigger before hook to store authorization
      await mockClient._beforeHooks[0](beforeContext)

      const afterContext: PaymentCreatedContext = {
        paymentRequired: {
          x402Version: 1,
          accepts: [requirements],
          resource: "https://api.example.com/resource",
        },
        selectedRequirements: requirements,
        paymentPayload: payment,
      } as any

      await mockClient._afterHooks[0](afterContext)

      expect(mockTreasurer.onStatus).toHaveBeenCalledWith("sending", authorization, {
        method: "http",
        params: {
          resource: "https://api.example.com/resource",
        },
      })
    })
  })

  describe("treasurer declines", () => {
    it("returns abort when treasurer returns null", async () => {
      const requirements = createMockRequirements()

      mockTreasurer.onPaymentRequired.mockResolvedValue(null)

      wrapWithAmpersend(mockClient, mockTreasurer, ["base-sepolia"])

      const context: PaymentCreationContext = {
        paymentRequired: {
          x402Version: 1,
          accepts: [requirements],
          resource: "https://api.example.com/resource",
        },
        selectedRequirements: requirements,
      } as any

      const result = await mockClient._beforeHooks[0](context)

      expect(result).toEqual({
        abort: true,
        reason: "Payment declined by treasurer",
      })
    })

    it("does not call onStatus when declined", async () => {
      const requirements = createMockRequirements()

      mockTreasurer.onPaymentRequired.mockResolvedValue(null)

      wrapWithAmpersend(mockClient, mockTreasurer, ["base-sepolia"])

      const context: PaymentCreationContext = {
        paymentRequired: {
          x402Version: 1,
          accepts: [requirements],
          resource: "https://api.example.com/resource",
        },
        selectedRequirements: requirements,
      } as any

      await mockClient._beforeHooks[0](context)

      expect(mockTreasurer.onStatus).not.toHaveBeenCalled()
    })
  })

  describe("treasurer throws", () => {
    it("propagates error from treasurer", async () => {
      const requirements = createMockRequirements()
      const error = new Error("Treasurer error")

      mockTreasurer.onPaymentRequired.mockRejectedValue(error)

      wrapWithAmpersend(mockClient, mockTreasurer, ["base-sepolia"])

      const context: PaymentCreationContext = {
        paymentRequired: {
          x402Version: 1,
          accepts: [requirements],
          resource: "https://api.example.com/resource",
        },
        selectedRequirements: requirements,
      } as any

      await expect(mockClient._beforeHooks[0](context)).rejects.toThrow("Treasurer error")
    })
  })

  describe("payment creation failure", () => {
    it("calls onStatus with error status", async () => {
      const requirements = createMockRequirements()
      const payment = createMockPaymentPayload()
      const authorization = createMockAuthorization(payment)

      mockTreasurer.onPaymentRequired.mockResolvedValue(authorization)

      wrapWithAmpersend(mockClient, mockTreasurer, ["base-sepolia"])

      // First store authorization via before hook
      const beforeContext: PaymentCreationContext = {
        paymentRequired: {
          x402Version: 1,
          accepts: [requirements],
          resource: "https://api.example.com/resource",
        },
        selectedRequirements: requirements,
      } as any

      await mockClient._beforeHooks[0](beforeContext)

      // Then trigger failure
      const failureContext: PaymentCreationFailureContext = {
        paymentRequired: {
          x402Version: 1,
          accepts: [requirements],
          resource: "https://api.example.com/resource",
        },
        selectedRequirements: requirements,
        error: new Error("Payment failed"),
      } as any

      await mockClient._failureHooks[0](failureContext)

      expect(mockTreasurer.onStatus).toHaveBeenCalledWith("error", authorization, {
        method: "http",
        params: {
          resource: "https://api.example.com/resource",
          error: "Payment failed",
        },
      })
    })

    it("does not recover from failure", async () => {
      const requirements = createMockRequirements()
      const payment = createMockPaymentPayload()
      const authorization = createMockAuthorization(payment)

      mockTreasurer.onPaymentRequired.mockResolvedValue(authorization)

      wrapWithAmpersend(mockClient, mockTreasurer, ["base-sepolia"])

      // Store authorization
      const beforeContext: PaymentCreationContext = {
        paymentRequired: {
          x402Version: 1,
          accepts: [requirements],
          resource: "https://api.example.com/resource",
        },
        selectedRequirements: requirements,
      } as any

      await mockClient._beforeHooks[0](beforeContext)

      const failureContext: PaymentCreationFailureContext = {
        paymentRequired: {
          x402Version: 1,
          accepts: [requirements],
          resource: "https://api.example.com/resource",
        },
        selectedRequirements: requirements,
        error: new Error("Payment failed"),
      } as any

      const result = await mockClient._failureHooks[0](failureContext)

      // Should return undefined (no recovery)
      expect(result).toBeUndefined()
    })
  })

  describe("missing authorization in store", () => {
    it("throws when authorization not found", async () => {
      const requirements = createMockRequirements()

      wrapWithAmpersend(mockClient, mockTreasurer, ["base-sepolia"])

      const schemeClient = mockClient._registeredSchemes.get("base-sepolia")

      // Try to get payload without storing authorization first
      await expect(schemeClient.createPaymentPayload(1, requirements)).rejects.toThrow(
        "No payment authorization found for requirements",
      )
    })
  })

  describe("context shape", () => {
    it("passes correct context structure to treasurer", async () => {
      const requirements = createMockRequirements()
      const payment = createMockPaymentPayload()
      const authorization = createMockAuthorization(payment)

      mockTreasurer.onPaymentRequired.mockResolvedValue(authorization)

      wrapWithAmpersend(mockClient, mockTreasurer, ["base-sepolia"])

      const context: PaymentCreationContext = {
        paymentRequired: {
          x402Version: 1,
          accepts: [requirements],
          resource: "https://api.example.com/resource",
        },
        selectedRequirements: requirements,
      } as any

      await mockClient._beforeHooks[0](context)

      const calledContext = mockTreasurer.onPaymentRequired.mock.calls[0][1] as PaymentContext
      expect(calledContext.method).toBe("http")
      expect(calledContext.params).toEqual({
        resource: "https://api.example.com/resource",
      })
    })
  })
})
