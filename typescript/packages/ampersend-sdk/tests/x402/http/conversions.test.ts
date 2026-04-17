import type { PaymentAuthorization, PaymentOption, SettlementResult } from "@/ampersend/types.ts"
import {
  caip2ToV1Network,
  fromV1PaymentPayload,
  fromV1Requirements,
  fromV1SettleResponse,
  fromV2Requirements,
  parseCaip2ChainId,
  toV1PaymentPayload,
  toV1Requirements,
  toV1SettleResponse,
  toV2PaymentPayloadFragment,
  v1NetworkToCaip2,
} from "@/x402/http/conversions.ts"
import { describe, expect, it } from "vitest"
import type { PaymentPayload as V1PaymentPayload, PaymentRequirements as V1PaymentRequirements } from "x402/types"

describe("conversions", () => {
  describe("network identifiers", () => {
    it("v1NetworkToCaip2", () => {
      expect(v1NetworkToCaip2("base-sepolia")).toBe("eip155:84532")
      expect(v1NetworkToCaip2("base")).toBe("eip155:8453")
    })

    it("v1NetworkToCaip2 throws for unknown network", () => {
      expect(() => v1NetworkToCaip2("unknown-network")).toThrow("Unknown v1 network")
    })

    it("parseCaip2ChainId", () => {
      expect(parseCaip2ChainId("eip155:8453")).toBe(8453)
      expect(parseCaip2ChainId("eip155:84532")).toBe(84532)
      expect(parseCaip2ChainId("8453")).toBe(8453)
    })

    it("caip2ToV1Network", () => {
      expect(caip2ToV1Network("eip155:84532")).toBe("base-sepolia")
      expect(caip2ToV1Network("eip155:8453")).toBe("base")
    })

    it("caip2ToV1Network throws for unknown chain ID", () => {
      expect(() => caip2ToV1Network("eip155:999999")).toThrow("Unknown chain ID")
    })
  })

  describe("fromV1Requirements", () => {
    const v1Req: V1PaymentRequirements = {
      scheme: "exact",
      network: "base-sepolia",
      maxAmountRequired: "1000000",
      resource: "https://api.example.com/resource",
      description: "Test resource",
      mimeType: "application/json",
      payTo: "0x1234567890123456789012345678901234567890",
      maxTimeoutSeconds: 300,
      asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      extra: { customField: "value" },
    }

    it("translates network to CAIP-2", () => {
      const canonical = fromV1Requirements(v1Req)
      expect(canonical.network).toBe("eip155:84532")
    })

    it("maps maxAmountRequired to amount", () => {
      const canonical = fromV1Requirements(v1Req)
      expect(canonical.amount).toBe("1000000")
    })

    it("lifts resource fields into ResourceInfo", () => {
      const canonical = fromV1Requirements(v1Req)
      expect(canonical.resource).toEqual({
        url: "https://api.example.com/resource",
        description: "Test resource",
        mimeType: "application/json",
      })
    })

    it("preserves extra", () => {
      const canonical = fromV1Requirements(v1Req)
      expect(canonical.extra).toEqual({ customField: "value" })
    })
  })

  describe("fromV2Requirements", () => {
    const v2Req = {
      scheme: "exact",
      network: "eip155:84532" as `eip155:${number}`,
      amount: "1000000",
      asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      payTo: "0x1234567890123456789012345678901234567890",
      maxTimeoutSeconds: 300,
      extra: { customField: "value" },
    }

    const resource = {
      url: "https://api.example.com/resource",
      description: "Test resource",
      mimeType: "application/json",
    }

    it("passes network through as CAIP-2", () => {
      const canonical = fromV2Requirements(v2Req, resource)
      expect(canonical.network).toBe("eip155:84532")
    })

    it("passes amount through", () => {
      const canonical = fromV2Requirements(v2Req, resource)
      expect(canonical.amount).toBe("1000000")
    })

    it("attaches the resource info", () => {
      const canonical = fromV2Requirements(v2Req, resource)
      expect(canonical.resource).toEqual(resource)
    })

    it("uses default timeout when not specified", () => {
      const { maxTimeoutSeconds: _omit, ...reqWithoutTimeout } = v2Req
      const canonical = fromV2Requirements(reqWithoutTimeout as typeof v2Req, resource)
      expect(canonical.maxTimeoutSeconds).toBe(300)
    })
  })

  describe("toV1Requirements", () => {
    const canonical: PaymentOption = {
      scheme: "exact",
      network: "eip155:84532",
      amount: "1000000",
      asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      payTo: "0x1234567890123456789012345678901234567890",
      maxTimeoutSeconds: 300,
      resource: {
        url: "https://api.example.com/resource",
        description: "Test resource",
        mimeType: "application/json",
      },
      extra: { name: "USDC", version: "2" },
    }

    it("maps fields back to v1 shape", () => {
      const v1 = toV1Requirements(canonical)
      expect(v1.network).toBe("base-sepolia")
      expect(v1.maxAmountRequired).toBe("1000000")
      expect(v1.resource).toBe("https://api.example.com/resource")
      expect(v1.description).toBe("Test resource")
      expect(v1.mimeType).toBe("application/json")
    })

    it("defaults description to URL when missing", () => {
      const minimal = { ...canonical, resource: { url: "https://api.example.com/resource" } }
      const v1 = toV1Requirements(minimal)
      expect(v1.description).toBe("https://api.example.com/resource")
    })
  })

  describe("toV1PaymentPayload / fromV1PaymentPayload", () => {
    const canonicalAuth: PaymentAuthorization = {
      scheme: "exact",
      network: "eip155:84532",
      body: {
        signature: "0xmocksig",
        authorization: { from: "0xfrom", to: "0xto", value: "1000000" },
      },
    }

    it("wraps canonical authorization in v1 envelope", () => {
      const v1 = toV1PaymentPayload(canonicalAuth)
      expect(v1.x402Version).toBe(1)
      expect(v1.scheme).toBe("exact")
      expect(v1.network).toBe("base-sepolia")
      expect(v1.payload).toEqual(canonicalAuth.body)
    })

    it("round-trips through fromV1PaymentPayload", () => {
      const v1 = toV1PaymentPayload(canonicalAuth)
      const back = fromV1PaymentPayload(v1)
      expect(back).toEqual(canonicalAuth)
    })
  })

  describe("toV2PaymentPayloadFragment", () => {
    const canonicalAuth: PaymentAuthorization = {
      scheme: "exact",
      network: "eip155:84532",
      body: { signature: "0xmocksig", authorization: { value: "1000000" } },
    }

    const v2Requirements = {
      scheme: "exact",
      network: "eip155:84532" as `eip155:${number}`,
      amount: "1000000",
      asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      payTo: "0x1234567890123456789012345678901234567890",
      maxTimeoutSeconds: 300,
      extra: {},
    }

    const resource = {
      url: "https://api.example.com/resource",
      description: "Test resource",
      mimeType: "application/json",
    }

    it("sets x402Version to 2", () => {
      const fragment = toV2PaymentPayloadFragment(canonicalAuth, v2Requirements, resource)
      expect(fragment.x402Version).toBe(2)
    })

    it("echoes the resource and accepted requirements", () => {
      const fragment = toV2PaymentPayloadFragment(canonicalAuth, v2Requirements, resource)
      expect(fragment.resource).toEqual(resource)
      expect(fragment.accepted).toEqual(v2Requirements)
    })

    it("preserves body as v2 payload", () => {
      const fragment = toV2PaymentPayloadFragment(canonicalAuth, v2Requirements, resource)
      expect(fragment.payload).toEqual(canonicalAuth.body)
    })
  })

  describe("toV1SettleResponse / fromV1SettleResponse", () => {
    const canonicalResult: SettlementResult = {
      success: true,
      payer: "0x1234",
      transaction: "0xabcd",
      network: "eip155:84532",
    }

    it("translates canonical to v1 wire", () => {
      const v1 = toV1SettleResponse(canonicalResult)
      expect(v1.success).toBe(true)
      expect(v1.network).toBe("base-sepolia")
      expect(v1.transaction).toBe("0xabcd")
    })

    it("round-trips through fromV1SettleResponse", () => {
      const v1 = toV1SettleResponse(canonicalResult)
      const back = fromV1SettleResponse(v1)
      expect(back.success).toBe(true)
      expect(back.payer).toBe("0x1234")
      expect(back.transaction).toBe("0xabcd")
      expect(back.network).toBe("eip155:84532")
    })
  })

  describe("fromV1PaymentPayload on wire-shaped input", () => {
    const v1: V1PaymentPayload = {
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

    it("translates network and strips the envelope", () => {
      const canonical = fromV1PaymentPayload(v1)
      expect(canonical.scheme).toBe("exact")
      expect(canonical.network).toBe("eip155:84532")
      expect(canonical.body).toEqual(v1.payload)
    })
  })
})
