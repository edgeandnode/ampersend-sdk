// Core abstractions
export type { Authorization, PaymentContext, PaymentStatus, X402Treasurer } from "./treasurer.ts"
export { WalletError } from "./wallet.ts"
export type { X402Wallet } from "./wallet.ts"

// X402Wallet implementations
export { AccountWallet, SmartAccountWallet, createWalletFromConfig } from "./wallets/index.ts"
export type { SmartAccountConfig, WalletConfig, EOAWalletConfig, SmartAccountWalletConfig } from "./wallets/index.ts"

// HTTP adapter for x402 v2 SDK
export { wrapWithAmpersend } from "./http/index.ts"

// NOTE: NaiveTreasurer is NOT exported here - use deep import:
// import { NaiveTreasurer } from "@ampersend_ai/ampersend-sdk/x402/treasurers"
