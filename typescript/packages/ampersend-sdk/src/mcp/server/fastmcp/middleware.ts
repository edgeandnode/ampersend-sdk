import {
  CustomMcpError,
  type AudioContent,
  type ContentResult,
  type ImageContent,
  type ResourceContent,
  type ResourceLink,
  type TextContent,
} from "fastmcp"
import type { PaymentPayload as V1PaymentPayload } from "x402/types"

import type { PaymentAuthorization, PaymentOption, SettlementResult } from "../../../x402/canonical.ts"
import { fromV1PaymentPayload, toV1Requirements, toV1SettleResponse } from "../../../x402/http/conversions.ts"

/**
 * Callback to determine if payment is required for a tool execution. Returns
 * the seller's payment option or null if no payment is required.
 */
export type OnExecute = (context: { args: unknown }) => Promise<PaymentOption | null>

/**
 * Callback invoked when a payment has been attached to a tool call.
 *
 * Both `payment` and `option` are in ampersend's canonical form.
 * Implementations that need to call a v1 facilitator can use
 * `toV1Requirements`/`toV1PaymentPayload`/`fromV1SettleResponse` from
 * `@ampersend_ai/ampersend-sdk/x402/conversions` to bridge.
 */
export type OnPayment = (context: {
  payment: PaymentAuthorization
  option: PaymentOption
}) => Promise<SettlementResult | void>

/**
 * Options for the x402 payment middleware
 */
export interface WithX402PaymentOptions {
  onExecute: OnExecute
  onPayment: OnPayment
}

/**
 * Payment error data structure with x402 fields (MCP wire shape)
 */
interface PaymentErrorData {
  message: string
  code: number
  x402Version: number
  accepts: Array<ReturnType<typeof toV1Requirements>>
  error?: string
  "x402/payment-response"?: ReturnType<typeof toV1SettleResponse>
}

/**
 * FastMCP context with request metadata
 */
interface FastMCPContext {
  requestMetadata?: {
    "x402/payment"?: V1PaymentPayload
    [key: string]: unknown
  }
  [key: string]: unknown
}

/**
 * The execute function signature from FastMCP
 */
type ExecuteFunction<TArgs = any, TResult = any> = (args: TArgs, context: FastMCPContext) => Promise<TResult>

/**
 * Creates a payment error with the seller's payment option (serialised to v1
 * wire shape).
 *
 * Workaround: embeds x402 data as JSON in the error message for when FastMCP
 * doesn't properly propagate the data field. This allows the client to fall
 * back to parsing the data from the message.
 */
function createPaymentError(
  option: PaymentOption,
  errorReason: string | null = null,
  settlement: SettlementResult | null = null,
): CustomMcpError {
  const data: PaymentErrorData = {
    message: "Payment required for tool execution",
    code: 402,
    x402Version: 1,
    accepts: [toV1Requirements(option)],
  }
  if (errorReason) {
    data.error = errorReason
  }
  if (settlement) {
    data["x402/payment-response"] = toV1SettleResponse(settlement)
  }

  return new CustomMcpError(402, data.message, data)
}

export type ToolExecuteReturn =
  | AudioContent
  | ContentResult
  | ImageContent
  | ResourceContent
  | ResourceLink
  | string
  | TextContent
  | void

function normalizeToolResult(result: ToolExecuteReturn): ContentResult {
  if (result === undefined || result === null) {
    return { content: [] }
  }

  if (typeof result === "string") {
    return { content: [{ text: result, type: "text" }] }
  }

  // Check if it's an individual content type (has 'type' property)
  if ("type" in result) {
    return { content: [result] }
  }

  // Already a ContentResult
  return result
}

/**
 * Middleware that wraps a FastMCP execute function to handle x402 payments
 *
 * Extracts payment from requestMetadata["x402/payment"] field and adds settlement
 * response to result _meta["x402/payment-response"] according to the official
 * MCP x402 spec. Both `onExecute` and `onPayment` callbacks receive canonical
 * ampersend types; the middleware translates to/from the x402 v1 wire shapes
 * used on the MCP layer at the boundary.
 */
export function withX402Payment<TArgs = any, TResult = any>(
  options: WithX402PaymentOptions,
): (execute: ExecuteFunction<TArgs, TResult>) => ExecuteFunction<TArgs, TResult> {
  return (execute: ExecuteFunction<TArgs, TResult>) => {
    return async (args: TArgs, context: FastMCPContext): Promise<TResult> => {
      // Extract wire-format payment from MCP request metadata
      const wirePayment = context.requestMetadata?.["x402/payment"]

      // Check if payment is required
      const option = await options.onExecute({ args })
      // No payment required - execute normally
      if (!option) {
        return execute(args, context)
      }

      // Payment is required
      if (!wirePayment) {
        throw createPaymentError(option)
      }

      // Translate wire payment to canonical for the user's onPayment callback
      const canonicalPayment = fromV1PaymentPayload(wirePayment)

      let settlement: SettlementResult | void
      try {
        settlement = await options.onPayment({
          payment: canonicalPayment,
          option,
        })
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error)
        throw createPaymentError(option, reason)
      }
      if (settlement && !settlement.success) {
        throw createPaymentError(option, settlement.errorReason ?? null, settlement)
      }

      // Payment valid - proceed with execution
      const result = await execute(args, context)

      if (!settlement) {
        return result
      }

      const normalizedResult = normalizeToolResult(result as ToolExecuteReturn)

      // Add settlement response to result _meta (v1 wire shape)
      normalizedResult._meta = {
        ...normalizedResult._meta,
        "x402/payment-response": toV1SettleResponse(settlement),
      }

      return normalizedResult as TResult
    }
  }
}

/**
 * Convenience function that directly wraps an execute function
 */
export function createX402Execute<TArgs = any, TResult = any>(
  options: WithX402PaymentOptions,
  execute: ExecuteFunction<TArgs, TResult>,
): ExecuteFunction<TArgs, TResult> {
  return withX402Payment(options)(execute)
}
