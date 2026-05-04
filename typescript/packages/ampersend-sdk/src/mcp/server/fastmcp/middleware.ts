import type { PaymentPayloadV1, PaymentRequirementsV1 } from "@x402/core/schemas"
import type { SettleResponse } from "@x402/core/types"
import {
  CustomMcpError,
  type AudioContent,
  type ContentResult,
  type ImageContent,
  type ResourceContent,
  type ResourceLink,
  type TextContent,
} from "fastmcp"

/** Requirements to advertise, or `null` if payment isn't required. */
export type OnExecute = (context: { args: unknown }) => Promise<PaymentRequirementsV1 | null>

/** Return a {@link SettleResponse} to embed in `_meta`, or `void` to accept without settling. */
export type OnPayment = (context: {
  payment: PaymentPayloadV1
  requirements: PaymentRequirementsV1
}) => Promise<SettleResponse | void>

export interface WithX402PaymentOptions {
  onExecute: OnExecute
  onPayment: OnPayment
}

interface PaymentErrorData {
  message: string
  code: number
  x402Version: number
  accepts: Array<PaymentRequirementsV1>
  error?: string
  "x402/payment-response"?: SettleResponse
}

interface FastMCPContext {
  requestMetadata?: {
    "x402/payment"?: PaymentPayloadV1
    [key: string]: unknown
  }
  [key: string]: unknown
}

type ExecuteFunction<TArgs = any, TResult = any> = (args: TArgs, context: FastMCPContext) => Promise<TResult>

function createPaymentError(
  requirements: PaymentRequirementsV1,
  errorReason: string | null = null,
  settlement: SettleResponse | null = null,
): CustomMcpError {
  const data: PaymentErrorData = {
    message: "Payment required for tool execution",
    code: 402,
    x402Version: 1,
    accepts: [requirements],
  }
  if (errorReason) {
    data.error = errorReason
  }
  if (settlement) {
    data["x402/payment-response"] = settlement
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

/** Wrap a FastMCP `execute` with x402 payment handling per the MCP x402 spec. */
export function withX402Payment<TArgs = any, TResult = any>(
  options: WithX402PaymentOptions,
): (execute: ExecuteFunction<TArgs, TResult>) => ExecuteFunction<TArgs, TResult> {
  return (execute: ExecuteFunction<TArgs, TResult>) => {
    return async (args: TArgs, context: FastMCPContext): Promise<TResult> => {
      const payment = context.requestMetadata?.["x402/payment"]

      const requirements = await options.onExecute({ args })
      if (!requirements) {
        return execute(args, context)
      }

      if (!payment) {
        throw createPaymentError(requirements)
      }

      let settlement: SettleResponse | void
      try {
        settlement = await options.onPayment({ payment, requirements })
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error)
        throw createPaymentError(requirements, reason)
      }
      if (settlement && !settlement.success) {
        throw createPaymentError(requirements, settlement.errorReason ?? null, settlement)
      }

      const result = await execute(args, context)

      if (!settlement) {
        return result
      }

      const normalizedResult = normalizeToolResult(result as ToolExecuteReturn)
      normalizedResult._meta = {
        ...normalizedResult._meta,
        "x402/payment-response": settlement,
      }
      return normalizedResult as TResult
    }
  }
}

export function createX402Execute<TArgs = any, TResult = any>(
  options: WithX402PaymentOptions,
  execute: ExecuteFunction<TArgs, TResult>,
): ExecuteFunction<TArgs, TResult> {
  return withX402Payment(options)(execute)
}
