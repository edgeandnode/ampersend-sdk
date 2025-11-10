export { Client } from "./client.ts"
export { X402Middleware } from "./middleware.ts"
export type { ClientOptions, PaymentEvent } from "./types.ts"

// Core abstractions (re-exported for convenience)
export type { Authorization, PaymentContext, PaymentStatus, X402Treasurer } from "../../x402/treasurer.ts"

// Re-export MCP types for convenience
export type { Tool } from "@modelcontextprotocol/sdk/types.js"

// Re-export x402 types for convenience
export type { PaymentPayload, PaymentRequirements } from "x402/types"
