#!/usr/bin/env node

// =============================================================================
// PRIMARY API - Simplified Setup (Recommended)
// =============================================================================

// Treasurer - core payment authorization
export {
  createAmpersendTreasurer,
  AmpersendTreasurer,
  type AmpersendTreasurerConfig,
  type SimpleAmpersendTreasurerConfig,
  type FullAmpersendTreasurerConfig,
} from "./ampersend/index.ts"

// MCP Proxy - simplified setup
export { createAmpersendProxy, type SimpleProxyOptions } from "./mcp/proxy/factory.ts"

// MCP Client - simplified setup
export { createAmpersendMcpClient, type SimpleClientOptions } from "./mcp/client/factory.ts"

// HTTP Client - simplified setup
export { createAmpersendHttpClient, type SimpleHttpClientOptions } from "./x402/http/factory.ts"

// =============================================================================
// TYPES - For type annotations
// =============================================================================
export type { X402Treasurer, Authorization, PaymentContext, PaymentStatus } from "./x402/index.ts"
export type { X402Wallet, SmartAccountConfig } from "./x402/index.ts"

// =============================================================================
// ADVANCED - Building blocks (NaiveTreasurer requires deep import)
// =============================================================================

// Wallets
export { AccountWallet, SmartAccountWallet, WalletError } from "./x402/index.ts"

// Advanced MCP (original functions that take treasurer directly)
export { initializeProxyServer } from "./mcp/proxy/index.ts"
export { Client } from "./mcp/client/index.ts"

// Advanced HTTP
export { wrapWithAmpersend } from "./x402/http/index.ts"

// =============================================================================
// NOTE: NaiveTreasurer is NOT exported here - use deep import for testing:
// import { NaiveTreasurer } from "@ampersend_ai/ampersend-sdk/x402/treasurers"
// =============================================================================
