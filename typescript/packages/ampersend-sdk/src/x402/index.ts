// Protocol envelopes — see envelopes.ts for the `{ protocol, data }` rationale.
export type {
  PaymentAuthorization,
  PaymentInstruction,
  PaymentRequest,
  Protocol,
  SchemeSpecificPayload,
  SettlementResult,
} from "./envelopes.ts"
export { acceptedOf, amountOf, buildAuthorization, firstInstructionOf, resourceUrlOf } from "./envelopes.ts"

// Core abstractions
export type { Authorization, PaymentContext, PaymentStatus, X402Treasurer } from "./treasurer.ts"
export type { ERC3009AuthorizationData, ServerAuthorizationData } from "./types.ts"
export { WalletError } from "./wallet.ts"
export type { X402Wallet } from "./wallet.ts"

// Wallet implementations
export { AccountWallet, SmartAccountWallet, createWalletFromConfig } from "./wallets/index.ts"
export type { SmartAccountConfig, WalletConfig, EOAWalletConfig, SmartAccountWalletConfig } from "./wallets/index.ts"

// HTTP integration
export {
  AmpersendX402Client,
  PaymentDeclinedError,
  UnsupportedProtocolError,
  createAmpersendHttpClient,
} from "./http/index.ts"
export type { AmpersendNetworks, SimpleHttpClientOptions } from "./http/index.ts"

// Sign-In-With-X integration
export { createSiwxSigner, wrapFetchWithAmpersendSiwx } from "./siwx.ts"
export type { SiwxSignerConfig } from "./siwx.ts"

// Seller-side server executors + adapters are intentionally NOT re-exported
// from this general barrel. They live only behind the dedicated subpaths
// `@ampersend_ai/ampersend-sdk/x402/server` and `.../x402/server/express`.
// Re-exporting them here would pull the node-only server deps
// (`@x402/core/server` -> `node:module`) into every consumer of this module —
// including `ampersend/treasurer.ts`, which imports from here and is bundled
// into browser/client builds downstream (the monorepo dashboard). Keeping the
// server surface subpath-only is what stops that node:module leak.
