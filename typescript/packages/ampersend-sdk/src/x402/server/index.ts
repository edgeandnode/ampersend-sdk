// Seller-side x402 server executors and framework-agnostic adapter core.
//
// The Express adapter lives behind its own export subpath
// (`@ampersend_ai/ampersend-sdk/x402/server/express`) so buyer-only / MCP-only
// consumers don't pull `express`. The FastMCP adapter is here because the SDK
// already depends on `fastmcp`.

export type { X402ServerExecutor } from "./executor.ts"
export { FacilitatorX402ServerExecutor, type FacilitatorX402ServerExecutorOptions } from "./facilitator.ts"
export {
  AmpersendX402ServerExecutor,
  GENERIC_DENY_REASON,
  type AmpersendX402ServerExecutorOptions,
  type ComplianceLogger,
} from "./ampersend.ts"
export { withAmpersendX402Payment, type AmpersendX402Outcome } from "./core.ts"
export {
  createExecutorOnPayment,
  withAmpersendX402PaymentMcp,
  type WithAmpersendX402PaymentMcpOptions,
} from "./fastmcp.ts"
