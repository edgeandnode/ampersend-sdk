import {
  CustomMcpError,
  type AudioContent,
  type ContentResult,
  type ImageContent,
  type ResourceContent,
  type ResourceLink,
  type TextContent,
} from "fastmcp"
import type {
  PaymentPayload as V1PaymentPayload,
  PaymentRequirements as V1PaymentRequirements,
  SettleResponse as V1SettleResponse,
} from "x402/types"

import type { PaymentAuthorization, PaymentOption, SettlementResult } from "../../../x402/envelopes.ts"

/**
 * Callback to determine if payment is required for a tool execution. Returns
 * the seller's payment option (envelope) or null if no payment is required.
 * The MCP spec currently uses x402-v1, so this middleware expects v1-tagged
 * envelopes.
 */
export type OnExecute = (context: { args: unknown }) => Promise<PaymentOption | null>

/**
 * Callback invoked when a payment has been attached to a tool call.
 *
 * Inputs and outputs are ampersend envelopes. Because the MCP spec is v1,
 * implementations return v1-tagged settlement envelopes (or void).
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
  accepts: Array<V1PaymentRequirements>
  error?: string
  "x402/payment-response"?: V1SettleResponse
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

/** Require MCP-flavoured envelope (x402-v1); otherwise error. */
function requireV1Option(option: PaymentOption): V1PaymentRequirements {
  if (option.protocol !== "x402-v1") {
    throw new Error(`MCP x402 middleware only supports x402-v1 options (got ${option.protocol}).`)
  }
  return option.data
}

function requireV1Settlement(settlement: SettlementResult): V1SettleResponse {
  if (settlement.protocol !== "x402-v1") {
    throw new Error(`MCP x402 middleware only supports x402-v1 settlements (got ${settlement.protocol}).`)
  }
  return settlement.data
}

function createPaymentError(
  option: PaymentOption,
  errorReason: string | null = null,
  settlement: SettlementResult | null = null,
): CustomMcpError {
  const data: PaymentErrorData = {
    message: "Payment required for tool execution",
    code: 402,
    x402Version: 1,
    accepts: [requireV1Option(option)],
  }
  if (errorReason) {
    data.error = errorReason
  }
  if (settlement) {
    data["x402/payment-response"] = requireV1Settlement(settlement)
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

  if ("type" in result) {
    return { content: [result] }
  }

  return result
}

/**
 * Wraps a FastMCP `execute` function with x402 payment handling.
 *
 * Extracts the wire-format x402-v1 payment from `requestMetadata["x402/payment"]`,
 * hands it to `onPayment` as an ampersend envelope, and writes the settlement
 * envelope back as v1 wire shape in `result._meta["x402/payment-response"]`
 * per the MCP x402 spec.
 */
export function withX402Payment<TArgs = any, TResult = any>(
  options: WithX402PaymentOptions,
): (execute: ExecuteFunction<TArgs, TResult>) => ExecuteFunction<TArgs, TResult> {
  return (execute: ExecuteFunction<TArgs, TResult>) => {
    return async (args: TArgs, context: FastMCPContext): Promise<TResult> => {
      const wirePayment = context.requestMetadata?.["x402/payment"]

      const option = await options.onExecute({ args })
      if (!option) {
        return execute(args, context)
      }

      if (!wirePayment) {
        throw createPaymentError(option)
      }

      // MCP spec is v1-only; wrap the wire payment back into a v1 envelope.
      const payment: PaymentAuthorization = { protocol: "x402-v1", data: wirePayment }

      let settlement: SettlementResult | void
      try {
        settlement = await options.onPayment({ payment, option })
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error)
        throw createPaymentError(option, reason)
      }
      if (settlement) {
        const v1 = requireV1Settlement(settlement)
        if (!v1.success) {
          throw createPaymentError(option, v1.errorReason ?? null, settlement)
        }
      }

      const result = await execute(args, context)

      if (!settlement) {
        return result
      }

      const normalizedResult = normalizeToolResult(result as ToolExecuteReturn)
      normalizedResult._meta = {
        ...normalizedResult._meta,
        "x402/payment-response": requireV1Settlement(settlement),
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
