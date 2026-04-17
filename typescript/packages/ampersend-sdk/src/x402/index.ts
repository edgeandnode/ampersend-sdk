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
