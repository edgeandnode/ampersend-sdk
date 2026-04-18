// Ampersend protocol envelopes. Every payment-related value on SDK interfaces
// and the wire is wrapped in `{ protocol, data }`, where `data` is byte-exact
// protocol payload (v1 or v2 x402) and `protocol` is ampersend's dispatch tag.
export type { PaymentAuthorization, PaymentOption, Protocol, SettlementResult } from "./envelopes.ts"

// Cross-protocol accessors for fields whose shape differs between v1 and v2.
// Other fields that share names across protocols (`scheme`, `asset`, `payTo`,
// `maxTimeoutSeconds`, `extra`) are read directly as `option.data.X`.
export { getAmount, getNetworkCaip2, getResourceUrl } from "./accessors.ts"

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
