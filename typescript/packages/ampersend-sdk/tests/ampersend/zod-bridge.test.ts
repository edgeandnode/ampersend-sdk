/**
 * Canary: breaks the day upstream `@x402/core` adds a `.transform`,
 * `.default`, or `.coerce` to one of the schemas we embed via `fromZod`,
 * which would make the bridge's encode path silently normalize outbound data.
 */
import { PaymentAuthorizationEnvelope, PaymentRequestEnvelope } from "@/ampersend/types.ts"
import { JSONSchema, Schema } from "effect"
import { describe, expect, it } from "vitest"

const v1Request = {
  protocol: "x402-v1" as const,
  data: {
    x402Version: 1 as const,
    accepts: [
      {
        scheme: "exact",
        network: "base-sepolia",
        maxAmountRequired: "1000",
        resource: "https://api.example.com/r",
        description: "t",
        mimeType: "application/json",
        payTo: "0x1111111111111111111111111111111111111111",
        maxTimeoutSeconds: 300,
        asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
        extra: { name: "USDC", version: "2" },
      },
    ],
  },
}

const v1Payment = {
  protocol: "x402-v1" as const,
  data: {
    x402Version: 1 as const,
    scheme: "exact",
    network: "base-sepolia",
    payload: { signature: "0xsig", authorization: { from: "0x0", to: "0x0", value: "0" } },
  },
}

describe("zod-bridge canary", () => {
  it("PaymentRequestEnvelope round-trips byte-exact", () => {
    const decoded = Schema.decodeSync(PaymentRequestEnvelope)(v1Request)
    const encoded = Schema.encodeSync(PaymentRequestEnvelope)(decoded)
    expect(encoded).toEqual(v1Request)
  })

  it("PaymentAuthorizationEnvelope round-trips byte-exact", () => {
    const decoded = Schema.decodeSync(PaymentAuthorizationEnvelope)(v1Payment)
    const encoded = Schema.encodeSync(PaymentAuthorizationEnvelope)(decoded)
    expect(encoded).toEqual(v1Payment)
  })

  // Guards against a regression where `fromZod` emits a `Declaration` AST node
  // without a `jsonSchema` annotation that satisfies `isOverrideAnnotation` —
  // which makes these envelopes unusable in `@effect/platform`'s
  // `HttpApiEndpoint.setPayload`/`addSuccess` (OpenAPI walk throws at Layer
  // build, HTTP server never binds).
  it("PaymentRequestEnvelope generates a JSON Schema", () => {
    expect(() => JSONSchema.make(PaymentRequestEnvelope)).not.toThrow()
  })

  it("PaymentAuthorizationEnvelope generates a JSON Schema", () => {
    expect(() => JSONSchema.make(PaymentAuthorizationEnvelope)).not.toThrow()
  })
})
