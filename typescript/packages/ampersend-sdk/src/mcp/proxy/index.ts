/**
 * MCP x402 Proxy - Public SDK Exports
 *
 * This module provides the core infrastructure for building MCP proxies
 * with x402 payment capabilities using the X402Treasurer pattern.
 */

// Core proxy infrastructure
export { initializeProxyServer } from "./server/index.ts"

// Smart account utilities
export { signERC3009Authorization, signSmartAccountTypedData } from "../../smart-account/index.ts"
export type { ERC3009AuthorizationData } from "../../smart-account/index.ts"

// Core abstractions (re-exported from x402 for convenience)
export {
  AccountWallet,
  SmartAccountWallet,
  NaiveTreasurer,
  createNaiveTreasurer,
  WalletError,
} from "../../x402/index.ts"
export type {
  Authorization,
  PaymentContext,
  PaymentStatus,
  X402Treasurer,
  X402Wallet,
  SmartAccountConfig,
} from "../../x402/index.ts"

// Proxy-specific types
export type {
  EOAWalletConfig,
  HTTPTransportOptions,
  WalletConfig,
  ProxyContext,
  ProxyServerOptions,
  SmartAccountWalletConfig,
  TransportConfig,
} from "./types.ts"
export { ProxyError } from "./types.ts"

// Utilities for proxy integrations
export { createWalletConfig, createTransportConfig } from "./cli.ts"
export { parseTargetFromQuery } from "./utils.ts"

// Environment variable validation
export { createEnvSchema, parseEnvConfig } from "./env.ts"
export type { ProxyEnvConfig } from "./env.ts"
