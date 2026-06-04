/**
 * Canary: breaks the day upstream `@x402/core` adds a `.transform`,
 * `.default`, or `.coerce` to one of the schemas we embed via `fromZod`,
 * which would make the bridge's encode path silently normalize outbound data.
 */
import { PaymentAuthorizationEnvelope, PaymentRequestEnvelope } from "@/ampersend/types.ts"
import { JsonSchema, Schema } from "effect"
import { describe, expect, it } from "vitest"

const DEFINITION_REF_PREFIX = "#/definitions/"

function toDraft07(schema: Schema.Top): JsonSchema.Document<"draft-07"> {
  return JsonSchema.toDocumentDraft07(Schema.toJsonSchemaDocument(schema))
}

function resolveDefinition(document: JsonSchema.Document<"draft-07">, name: string): JsonSchema.JsonSchema | undefined {
  const definition = document.definitions[name]
  if (definition === undefined) return undefined

  const ref = definition.$ref
  if (typeof ref === "string" && ref.startsWith(DEFINITION_REF_PREFIX)) {
    return document.definitions[ref.slice(DEFINITION_REF_PREFIX.length)]
  }

  return definition
}

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

  // Guards against the v4 JSON Schema conversion path rejecting the custom
  // `Declaration` nodes used by `fromZod`, or reducing them to `null` schemas.
  it("PaymentRequestEnvelope generates a JSON Schema", () => {
    const document = toDraft07(PaymentRequestEnvelope)

    expect(resolveDefinition(document, "PaymentRequiredV1")).toMatchObject({ type: "object" })
    expect(resolveDefinition(document, "PaymentRequiredV2")).toMatchObject({ type: "object" })
  })

  it("PaymentAuthorizationEnvelope generates a JSON Schema", () => {
    const document = toDraft07(PaymentAuthorizationEnvelope)

    expect(resolveDefinition(document, "PaymentPayloadV1")).toMatchObject({ type: "object" })
    expect(resolveDefinition(document, "PaymentPayloadV2")).toMatchObject({ type: "object" })
  })
})
