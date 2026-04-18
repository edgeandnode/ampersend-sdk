import { getAmount, getNetworkCaip2, getResourceUrl } from "@/x402/accessors.ts"
import type { PaymentOption } from "@/x402/envelopes.ts"
import { describe, expect, it } from "vitest"

const v1Option: PaymentOption = {
  protocol: "x402-v1",
  data: {
    scheme: "exact",
    network: "base-sepolia",
    maxAmountRequired: "1000000",
    resource: "https://api.example.com/resource",
    description: "Test resource",
    mimeType: "application/json",
    payTo: "0x1234567890123456789012345678901234567890",
    maxTimeoutSeconds: 300,
    asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    extra: {},
  },
}

const v2Option: PaymentOption = {
  protocol: "x402-v2",
  data: {
    scheme: "exact",
    network: "eip155:84532",
    amount: "1000000",
    asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    payTo: "0x1234567890123456789012345678901234567890",
    maxTimeoutSeconds: 300,
    extra: {},
  },
  resource: {
    url: "https://api.example.com/resource",
    description: "Test resource",
    mimeType: "application/json",
  },
}

describe("accessors", () => {
  describe("getAmount", () => {
    it("reads v1 maxAmountRequired", () => {
      expect(getAmount(v1Option)).toBe("1000000")
    })
    it("reads v2 amount", () => {
      expect(getAmount(v2Option)).toBe("1000000")
    })
  })

  describe("getNetworkCaip2", () => {
    it("translates v1 network name to CAIP-2", () => {
      expect(getNetworkCaip2(v1Option)).toBe("eip155:84532")
    })
    it("passes v2 CAIP-2 through", () => {
      expect(getNetworkCaip2(v2Option)).toBe("eip155:84532")
    })
    it("throws for unknown v1 network", () => {
      const bad: PaymentOption = { protocol: "x402-v1", data: { ...v1Option.data, network: "unknown" } }
      expect(() => getNetworkCaip2(bad)).toThrow("Unknown v1 network")
    })
  })

  describe("getResourceUrl", () => {
    it("reads v1 flat resource string", () => {
      expect(getResourceUrl(v1Option)).toBe("https://api.example.com/resource")
    })
    it("reads v2 envelope resource.url", () => {
      expect(getResourceUrl(v2Option)).toBe("https://api.example.com/resource")
    })
  })
})
