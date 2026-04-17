import type { ClientOptions as McpClientOptions } from "@modelcontextprotocol/sdk/client/index.js"
import type { PaymentPayloadV1, PaymentRequirementsV1 } from "@x402/core/schemas"
import type { SettleResponse } from "@x402/core/types"

import type { X402Treasurer } from "../../x402/treasurer.ts"

/** Internal 402 shape embedded in JSON-RPC error data; wrapped into a `PaymentRequest` before the treasurer sees it. */
export interface X402Response {
  readonly x402Version: number
  readonly accepts: ReadonlyArray<PaymentRequirementsV1>
  readonly error?: string
}

/** `_meta` fields the MCP x402 spec defines on requests/results. */
export interface X402MetaFields {
  "x402/payment"?: PaymentPayloadV1
  "x402/payment-response"?: SettleResponse
}

export type PaymentEvent =
  | { type: "sending" }
  | { type: "accepted" }
  | { type: "rejected"; reason: string }
  | { type: "error"; reason: string }

export interface ClientOptions {
  readonly mcpOptions: McpClientOptions
  readonly treasurer: X402Treasurer
}
