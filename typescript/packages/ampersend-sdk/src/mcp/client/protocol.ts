import {
  isJSONRPCError,
  isJSONRPCResponse,
  type JSONRPCMessage,
  type JSONRPCRequest,
} from "@modelcontextprotocol/sdk/types.js"
import {
  PaymentRequiredV1Schema,
  type PaymentPayloadV1 as V1PaymentPayload,
  type PaymentRequirementsV1 as V1PaymentRequirements,
} from "@x402/core/schemas"
import { z } from "zod"

import type { PaymentAuthorization } from "../../x402/envelopes.ts"
import type { X402Response } from "./types.ts"

/** Local replica — `@x402/core` exports `SettleResponse` as a type only. */
const SettleResponseSchema = z.object({
  success: z.boolean(),
  transaction: z.string(),
  network: z.string(),
  errorReason: z.string().optional(),
  payer: z.string().optional(),
})

export const McpX402PaymentResponseSchema = z.object({
  "x402/payment-response": SettleResponseSchema,
})

export type McpX402PaymentResponse = z.infer<typeof McpX402PaymentResponseSchema>

/** 402 body embedded in the JSON-RPC `error.data`, optionally with a settle response. */
export const McpX402PaymentRequiredSchema = PaymentRequiredV1Schema.extend({
  "x402/payment-response": SettleResponseSchema.optional(),
})

export type McpX402PaymentRequired = z.infer<typeof McpX402PaymentRequiredSchema>

/** Embed a payment into a JSON-RPC request's `_meta`. MCP is v1-only; throws otherwise. */
export function buildMessageWithPayment(
  message: JSONRPCRequest,
  payment: PaymentAuthorization,
  paymentId: string,
): { messageWithPayment: JSONRPCRequest } {
  if (payment.protocol !== "x402-v1") {
    throw new Error(`MCP meta requires an x402-v1 authorization; got ${payment.protocol}`)
  }
  const v1Payment = payment.data
  const base = message
  const baseParams = base.params || { _meta: {} }
  const baseParamsMeta = baseParams._meta || {}
  const messageWithPayment = {
    ...base,
    params: {
      ...baseParams,
      _meta: {
        ...baseParamsMeta,
        "x402/payment": v1Payment,
        "ampersend/paymentId": paymentId,
      },
    },
  }
  return { messageWithPayment }
}

export function paymentFromRequest(request: JSONRPCRequest): {
  payment: V1PaymentPayload | null
  paymentId: string | null
} {
  const meta = request.params?._meta
  if (!meta) {
    return { payment: null, paymentId: null }
  }

  const payment = (meta["x402/payment"] as V1PaymentPayload) || null
  const paymentId = (meta["ampersend/paymentId"] as string) || null

  return { payment, paymentId }
}

export function addMeta(request: JSONRPCRequest, k: string, v: unknown): JSONRPCRequest {
  const base = request
  const baseParams = base.params || { _meta: {} }
  const baseParamsMeta = baseParams._meta || {}
  return {
    ...base,
    params: {
      ...baseParams,
      _meta: {
        ...baseParamsMeta,
        [k]: v,
      },
    },
  }
}

export function x402DataFromJSONRPCMessage(
  msg: JSONRPCMessage,
): McpX402PaymentResponse | McpX402PaymentRequired | null {
  if (isJSONRPCResponse(msg) && msg.result._meta && isMcpX402PaymentResponse(msg.result._meta)) {
    return msg.result._meta as McpX402PaymentResponse
  }

  if (isJSONRPCError(msg) && msg.error.code === 402 && msg.error.data && isMcpX402PaymentRequired(msg.error.data)) {
    return msg.error.data as McpX402PaymentRequired
  }

  return null
}

export function isMcpX402PaymentResponse(data: unknown): data is McpX402PaymentResponse {
  const result = McpX402PaymentResponseSchema.safeParse(data)
  return result.success
}

export function isMcpX402PaymentRequired(data: unknown): data is McpX402PaymentRequired {
  const result = McpX402PaymentRequiredSchema.safeParse(data)
  return result.success
}

function isPaymentRequirementsArray(arr: unknown): arr is Array<V1PaymentRequirements> {
  return Array.isArray(arr) && arr.length > 0 && arr.every((req) => req && typeof req === "object" && "scheme" in req)
}

function isX402Response(obj: unknown): obj is X402Response {
  if (!obj || typeof obj !== "object") return false
  if (!("x402Version" in obj) || !("accepts" in obj)) return false
  const candidate = obj as Record<string, unknown>
  return typeof candidate.x402Version === "number" && isPaymentRequirementsArray(candidate.accepts)
}

export function asX402Response(obj: unknown): X402Response | null {
  return isX402Response(obj) ? obj : null
}
