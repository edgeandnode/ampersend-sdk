// Canonical payment types - ampersend's protocol-version-agnostic payment model.
// These are the types you'll see on treasurer/wallet interfaces and in MCP
// callbacks. Adapters at the HTTP/MCP boundary translate to/from x402 wire
// formats so the rest of the SDK never needs to know which protocol version a
// seller is speaking.
export type { PaymentAuthorization, PaymentOption, ResourceInfo, SettlementResult } from "./canonical.ts"

// Core abstractions
export type { Authorization, PaymentContext, PaymentStatus, X402Treasurer } from "./treasurer.ts"
export type { ERC3009AuthorizationData, ServerAuthorizationData } from "./types.ts"
export { WalletError } from "./wallet.ts"
export type { X402Wallet } from "./wallet.ts"

// Wallet implementations
export { AccountWallet, SmartAccountWallet, createWalletFromConfig } from "./wallets/index.ts"
export type { SmartAccountConfig, WalletConfig, EOAWalletConfig, SmartAccountWalletConfig } from "./wallets/index.ts"

// HTTP adapter
export { wrapWithAmpersend } from "./http/index.ts"

// x402 wire-format conversion helpers. These are narrow escape hatches for
// callers that still need to bridge canonical types to a v1 x402 library
// (e.g. `useFacilitator` from `x402/verify`).
export {
  fromV1PaymentPayload,
  fromV1Requirements,
  fromV1SettleResponse,
  toV1PaymentPayload,
  toV1Requirements,
  toV1SettleResponse,
} from "./http/conversions.ts"
