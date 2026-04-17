import type { ClientOptions as McpClientOptions } from "@modelcontextprotocol/sdk/client/index.js"
import type {
  PaymentPayload as V1PaymentPayload,
  PaymentRequirements as V1PaymentRequirements,
  SettleResponse as V1SettleResponse,
} from "x402/types"

import type { X402Treasurer } from "../../x402/treasurer.ts"

/**
 * HTTP 402 response structure with payment requirements (MCP wire format).
 *
 * This is an internal wire-format type. The MCP spec currently uses x402 v1
 * shapes embedded in JSON-RPC error data; canonical conversion happens at the
 * boundary in `client.ts`/`middleware.ts` before anything reaches the
 * treasurer.
 */
export interface X402Response {
  readonly x402Version: number
  readonly accepts: ReadonlyArray<V1PaymentRequirements>
  readonly error?: string
}

/**
 * MCP-specific meta field types for x402 payments (wire format).
 * Used internally when building/parsing JSON-RPC `_meta` fields.
 */
export interface X402MetaFields {
  "x402/payment"?: V1PaymentPayload
  "x402/payment-response"?: V1SettleResponse
}

/**
 * Payment tracking events (for API compatibility)
 */
export type PaymentEvent =
  | { type: "sending" }
  | { type: "accepted" }
  | { type: "rejected"; reason: string }
  | { type: "error"; reason: string }

/**
 * Client options that wrap MCP options and add x402 payment handling
 */
export interface ClientOptions {
  /** Standard MCP client options */
  readonly mcpOptions: McpClientOptions
  /** X402Treasurer for handling payment decisions and status tracking */
  readonly treasurer: X402Treasurer
}
