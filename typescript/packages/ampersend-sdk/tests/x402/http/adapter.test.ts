import type { PaymentRequest } from "@/x402/envelopes.ts"
import { wrapWithAmpersend } from "@/x402/http/adapter.ts"
import type { Authorization, PaymentContext, X402Treasurer } from "@/x402/treasurer.ts"
import type {
  PaymentCreatedContext,
  PaymentCreationContext,
  PaymentCreationFailureContext,
  x402Client,
} from "@x402/core/client"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { PaymentRequirements as V1PaymentRequirements } from "x402/types"

function createMockV1Requirements(): V1PaymentRequirements {
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

function createMockV2Requirements() {
  return {
    scheme: "exact",
    network: "eip155:84532" as `eip155:${number}`,
    amount: "1000000",
    asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    payTo: "0x1234567890123456789012345678901234567890",
    maxTimeoutSeconds: 300,
    extra: {},
  }
}

function createMockV2PaymentRequired() {
  return {
    x402Version: 2,
    resource: {
      url: "https://api.example.com/resource",
      description: "Test resource",
      mimeType: "application/json",
    },
    accepts: [createMockV2Requirements()],
  }
}

const v1SignedBody = {
  signature: "0xmocksignature",
  authorization: {
    from: "0xfrom",
    to: "0xto",
    value: "1000000",
    validAfter: "0",
    validBefore: "999999999999",
    nonce: "0xnonce",
  },
}

function createMockV1Authorization(): Authorization {
  return {
    payment: {
      protocol: "x402-v1",
      data: {
        x402Version: 1,
        scheme: "exact",
        network: "base-sepolia",
        payload: v1SignedBody,
      },
    },
    authorizationId: "test-auth-id",
  }
}

function createMockV2Authorization(): Authorization {
  const v2Req = createMockV2Requirements()
  return {
    payment: {
      protocol: "x402-v2",
      data: {
        x402Version: 2,
        resource: createMockV2PaymentRequired().resource,
        accepted: v2Req,
        payload: v1SignedBody,
      },
    },
    authorizationId: "test-auth-id",
  }
}

describe("wrapWithAmpersend", () => {
  let mockClient: x402Client & {
    _beforeHooks: Array<(ctx: PaymentCreationContext) => Promise<{ abort: true; reason: string } | void>>
    _afterHooks: Array<(ctx: PaymentCreatedContext) => Promise<void>>
    _failureHooks: Array<(ctx: PaymentCreationFailureContext) => Promise<{ recovered: true; payload: any } | void>>
    _registeredSchemesV1: Map<string, any>
    _registeredSchemesV2: Map<string, any>
  }
  let mockTreasurer: X402Treasurer & {
    onPaymentRequired: ReturnType<typeof vi.fn>
    onStatus: ReturnType<typeof vi.fn>
  }

  beforeEach(() => {
    const beforeHooks: typeof mockClient._beforeHooks = []
    const afterHooks: typeof mockClient._afterHooks = []
    const failureHooks: typeof mockClient._failureHooks = []
    const registeredSchemesV1 = new Map<string, any>()
    const registeredSchemesV2 = new Map<string, any>()

    mockClient = {
      _beforeHooks: beforeHooks,
      _afterHooks: afterHooks,
      _failureHooks: failureHooks,
      _registeredSchemesV1: registeredSchemesV1,
      _registeredSchemesV2: registeredSchemesV2,
      registerV1: vi.fn((network: string, schemeClient: any) => {
        registeredSchemesV1.set(network, schemeClient)
        return mockClient
      }),
      register: vi.fn((network: string, schemeClient: any) => {
        registeredSchemesV2.set(network, schemeClient)
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
    it("registers v1 scheme client on all specified networks", () => {
      wrapWithAmpersend(mockClient, mockTreasurer, ["base", "base-sepolia"])
      expect(mockClient.registerV1).toHaveBeenCalledTimes(2)
      expect(mockClient._registeredSchemesV1.has("base")).toBe(true)
      expect(mockClient._registeredSchemesV1.has("base-sepolia")).toBe(true)
    })

    it("registers v2 scheme client on CAIP-2 networks", () => {
      wrapWithAmpersend(mockClient, mockTreasurer, ["base", "base-sepolia"])
      expect(mockClient.register).toHaveBeenCalledTimes(2)
      expect(mockClient._registeredSchemesV2.has("eip155:8453")).toBe(true)
      expect(mockClient._registeredSchemesV2.has("eip155:84532")).toBe(true)
    })

    it("uses same v1 scheme client instance for all networks", () => {
      wrapWithAmpersend(mockClient, mockTreasurer, ["base", "base-sepolia"])
      const baseClient = mockClient._registeredSchemesV1.get("base")
      const sepoliaClient = mockClient._registeredSchemesV1.get("base-sepolia")
      expect(baseClient).toBe(sepoliaClient)
    })

    it("uses same v2 scheme client instance for all networks", () => {
      wrapWithAmpersend(mockClient, mockTreasurer, ["base", "base-sepolia"])
      const baseClient = mockClient._registeredSchemesV2.get("eip155:8453")
      const sepoliaClient = mockClient._registeredSchemesV2.get("eip155:84532")
      expect(baseClient).toBe(sepoliaClient)
    })

    it("scheme client has correct scheme property", () => {
      wrapWithAmpersend(mockClient, mockTreasurer, ["base"])
      const schemeClientV1 = mockClient._registeredSchemesV1.get("base")
      const schemeClientV2 = mockClient._registeredSchemesV2.get("eip155:8453")
      expect(schemeClientV1.scheme).toBe("exact")
      expect(schemeClientV2.scheme).toBe("exact")
    })
  })

  describe("happy path - v1 wire", () => {
    it("passes a v1-tagged PaymentRequest to the treasurer", async () => {
      const v1Requirements = createMockV1Requirements()
      const authorization = createMockV1Authorization()
      mockTreasurer.onPaymentRequired.mockResolvedValue(authorization)

      wrapWithAmpersend(mockClient, mockTreasurer, ["base-sepolia"])

      const v1Body = {
        x402Version: 1,
        accepts: [v1Requirements],
      }
      const context: PaymentCreationContext = {
        paymentRequired: v1Body,
        selectedRequirements: v1Requirements,
      } as any

      await mockClient._beforeHooks[0](context)

      const [passedRequest, passedContext] = mockTreasurer.onPaymentRequired.mock.calls[0]
      const request = passedRequest as PaymentRequest
      expect(request.protocol).toBe("x402-v1")
      expect(request.data).toBe(v1Body) // byte-exact: same reference

      expect(passedContext).toEqual({ method: "http" })
    })

    it("v1 scheme client returns the byte-exact v1 PaymentPayload", async () => {
      const v1Requirements = createMockV1Requirements()
      const authorization = createMockV1Authorization()
      mockTreasurer.onPaymentRequired.mockResolvedValue(authorization)

      wrapWithAmpersend(mockClient, mockTreasurer, ["base-sepolia"])

      const context: PaymentCreationContext = {
        paymentRequired: {
          x402Version: 1,
          accepts: [v1Requirements],
          resource: "https://api.example.com/resource",
        },
        selectedRequirements: v1Requirements,
      } as any
      await mockClient._beforeHooks[0](context)

      const schemeClient = mockClient._registeredSchemesV1.get("base-sepolia")
      const result = await schemeClient.createPaymentPayload(1, v1Requirements)

      expect(result.x402Version).toBe(1)
      expect(result.scheme).toBe("exact")
      expect(result.network).toBe("base-sepolia")
      expect(result.payload).toEqual(v1SignedBody)
    })

    it("calls onStatus with sending after payment created", async () => {
      const v1Requirements = createMockV1Requirements()
      const authorization = createMockV1Authorization()
      mockTreasurer.onPaymentRequired.mockResolvedValue(authorization)

      wrapWithAmpersend(mockClient, mockTreasurer, ["base-sepolia"])

      const beforeContext: PaymentCreationContext = {
        paymentRequired: {
          x402Version: 1,
          accepts: [v1Requirements],
          resource: "https://api.example.com/resource",
        },
        selectedRequirements: v1Requirements,
      } as any
      await mockClient._beforeHooks[0](beforeContext)

      const afterContext: PaymentCreatedContext = {
        paymentRequired: beforeContext.paymentRequired,
        selectedRequirements: v1Requirements,
      } as any
      await mockClient._afterHooks[0](afterContext)

      expect(mockTreasurer.onStatus).toHaveBeenCalledWith("sending", authorization, { method: "http" })
    })
  })

  describe("treasurer declines", () => {
    it("returns abort when treasurer returns null", async () => {
      const v1Requirements = createMockV1Requirements()
      mockTreasurer.onPaymentRequired.mockResolvedValue(null)

      wrapWithAmpersend(mockClient, mockTreasurer, ["base-sepolia"])

      const context: PaymentCreationContext = {
        paymentRequired: {
          x402Version: 1,
          accepts: [v1Requirements],
          resource: "https://api.example.com/resource",
        },
        selectedRequirements: v1Requirements,
      } as any

      const result = await mockClient._beforeHooks[0](context)
      expect(result).toEqual({ abort: true, reason: "Payment declined by treasurer" })
    })

    it("does not call onStatus when declined", async () => {
      const v1Requirements = createMockV1Requirements()
      mockTreasurer.onPaymentRequired.mockResolvedValue(null)

      wrapWithAmpersend(mockClient, mockTreasurer, ["base-sepolia"])

      const context: PaymentCreationContext = {
        paymentRequired: {
          x402Version: 1,
          accepts: [v1Requirements],
          resource: "https://api.example.com/resource",
        },
        selectedRequirements: v1Requirements,
      } as any
      await mockClient._beforeHooks[0](context)

      expect(mockTreasurer.onStatus).not.toHaveBeenCalled()
    })
  })

  describe("treasurer throws", () => {
    it("propagates error from treasurer", async () => {
      const v1Requirements = createMockV1Requirements()
      const error = new Error("Treasurer error")
      mockTreasurer.onPaymentRequired.mockRejectedValue(error)

      wrapWithAmpersend(mockClient, mockTreasurer, ["base-sepolia"])

      const context: PaymentCreationContext = {
        paymentRequired: {
          x402Version: 1,
          accepts: [v1Requirements],
          resource: "https://api.example.com/resource",
        },
        selectedRequirements: v1Requirements,
      } as any

      await expect(mockClient._beforeHooks[0](context)).rejects.toThrow("Treasurer error")
    })
  })

  describe("payment creation failure", () => {
    it("calls onStatus with error status", async () => {
      const v1Requirements = createMockV1Requirements()
      const authorization = createMockV1Authorization()
      mockTreasurer.onPaymentRequired.mockResolvedValue(authorization)

      wrapWithAmpersend(mockClient, mockTreasurer, ["base-sepolia"])

      const beforeContext: PaymentCreationContext = {
        paymentRequired: {
          x402Version: 1,
          accepts: [v1Requirements],
          resource: "https://api.example.com/resource",
        },
        selectedRequirements: v1Requirements,
      } as any
      await mockClient._beforeHooks[0](beforeContext)

      const failureContext: PaymentCreationFailureContext = {
        paymentRequired: beforeContext.paymentRequired,
        selectedRequirements: v1Requirements,
        error: new Error("Payment failed"),
      } as any
      await mockClient._failureHooks[0](failureContext)

      expect(mockTreasurer.onStatus).toHaveBeenCalledWith("error", authorization, {
        method: "http",
        params: { error: "Payment failed" },
      })
    })

    it("does not recover from failure", async () => {
      const v1Requirements = createMockV1Requirements()
      const authorization = createMockV1Authorization()
      mockTreasurer.onPaymentRequired.mockResolvedValue(authorization)

      wrapWithAmpersend(mockClient, mockTreasurer, ["base-sepolia"])

      const beforeContext: PaymentCreationContext = {
        paymentRequired: {
          x402Version: 1,
          accepts: [v1Requirements],
          resource: "https://api.example.com/resource",
        },
        selectedRequirements: v1Requirements,
      } as any
      await mockClient._beforeHooks[0](beforeContext)

      const failureContext: PaymentCreationFailureContext = {
        paymentRequired: beforeContext.paymentRequired,
        selectedRequirements: v1Requirements,
        error: new Error("Payment failed"),
      } as any

      const result = await mockClient._failureHooks[0](failureContext)
      expect(result).toBeUndefined()
    })
  })

  describe("missing authorization in store", () => {
    it("throws when authorization not found", async () => {
      const v1Requirements = createMockV1Requirements()
      wrapWithAmpersend(mockClient, mockTreasurer, ["base-sepolia"])

      const schemeClient = mockClient._registeredSchemesV1.get("base-sepolia")
      await expect(schemeClient.createPaymentPayload(1, v1Requirements)).rejects.toThrow(
        "No v1 payment authorization found",
      )
    })
  })

  describe("context shape", () => {
    it("passes correct context structure to treasurer", async () => {
      const v1Requirements = createMockV1Requirements()
      const authorization = createMockV1Authorization()
      mockTreasurer.onPaymentRequired.mockResolvedValue(authorization)

      wrapWithAmpersend(mockClient, mockTreasurer, ["base-sepolia"])

      const context: PaymentCreationContext = {
        paymentRequired: {
          x402Version: 1,
          accepts: [v1Requirements],
          resource: "https://api.example.com/resource",
        },
        selectedRequirements: v1Requirements,
      } as any
      await mockClient._beforeHooks[0](context)

      const calledContext = mockTreasurer.onPaymentRequired.mock.calls[0][1] as PaymentContext
      expect(calledContext.method).toBe("http")
      expect(calledContext.params).toBeUndefined()
    })
  })

  describe("v2 protocol support", () => {
    it("passes a v2-tagged PaymentRequest (with top-level resource) to the treasurer", async () => {
      const v2Requirements = createMockV2Requirements()
      const v2PaymentRequired = createMockV2PaymentRequired()
      const authorization = createMockV2Authorization()
      mockTreasurer.onPaymentRequired.mockResolvedValue(authorization)

      wrapWithAmpersend(mockClient, mockTreasurer, ["base-sepolia"])

      const context: PaymentCreationContext = {
        paymentRequired: v2PaymentRequired,
        selectedRequirements: v2Requirements,
      } as any
      await mockClient._beforeHooks[0](context)

      const [passedRequest] = mockTreasurer.onPaymentRequired.mock.calls[0]
      const request = passedRequest as PaymentRequest
      expect(request.protocol).toBe("x402-v2")
      expect(request.data).toBe(v2PaymentRequired) // byte-exact passthrough
      if (request.protocol === "x402-v2") {
        expect(request.data.resource).toEqual({
          url: "https://api.example.com/resource",
          description: "Test resource",
          mimeType: "application/json",
        })
        expect(request.data.accepts).toEqual([v2Requirements])
      }
    })

    it("v2 scheme client returns the v2 payload fragment", async () => {
      const v2Requirements = createMockV2Requirements()
      const authorization = createMockV2Authorization()
      mockTreasurer.onPaymentRequired.mockResolvedValue(authorization)

      wrapWithAmpersend(mockClient, mockTreasurer, ["base-sepolia"])

      const context: PaymentCreationContext = {
        paymentRequired: createMockV2PaymentRequired(),
        selectedRequirements: v2Requirements,
      } as any
      await mockClient._beforeHooks[0](context)

      const schemeClient = mockClient._registeredSchemesV2.get("eip155:84532")
      const result = await schemeClient.createPaymentPayload(2, v2Requirements)

      expect(result.x402Version).toBe(2)
      expect(result.payload).toEqual(v1SignedBody)
    })

    it("invokes onStatus('sending') for v2 payments after creation", async () => {
      const v2Requirements = createMockV2Requirements()
      const authorization = createMockV2Authorization()
      mockTreasurer.onPaymentRequired.mockResolvedValue(authorization)

      wrapWithAmpersend(mockClient, mockTreasurer, ["base-sepolia"])

      const v2PaymentRequired = createMockV2PaymentRequired()

      const beforeContext: PaymentCreationContext = {
        paymentRequired: v2PaymentRequired,
        selectedRequirements: v2Requirements,
      } as any
      await mockClient._beforeHooks[0](beforeContext)

      const afterContext = {
        paymentRequired: v2PaymentRequired,
        selectedRequirements: v2Requirements,
      } as any
      await mockClient._afterHooks[0](afterContext)

      expect(mockTreasurer.onStatus).toHaveBeenCalledWith("sending", authorization, { method: "http" })
    })
  })
})
