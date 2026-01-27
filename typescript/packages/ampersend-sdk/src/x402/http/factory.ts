/**
 * Simplified factory for Ampersend HTTP client.
 *
 * Provides one-liner setup for wrapping x402 HTTP clients with Ampersend payment support.
 */

import type { x402Client } from "@x402/core/client"
import type { Address, Hex } from "viem"

import { createAmpersendTreasurer } from "../../ampersend/treasurer.ts"
import { wrapWithAmpersend } from "./adapter.ts"

/** Default Ampersend API URL */
const DEFAULT_API_URL = "https://api.ampersend.ai"

/** Default chain ID (Base Sepolia) */
const DEFAULT_CHAIN_ID = 84532

/** Default networks to register */
const DEFAULT_NETWORKS = ["base-sepolia"]

/**
 * Simplified options for Ampersend HTTP client wrapper.
 */
export interface SimpleHttpClientOptions {
  /** The x402Client instance to wrap */
  client: x402Client
  /** Smart account address */
  smartAccountAddress: Address
  /** Session key private key for signing */
  sessionKeyPrivateKey: Hex
  /** Ampersend API URL (defaults to production) */
  apiUrl?: string
  /** Chain ID (defaults to Base Sepolia 84532) */
  chainId?: number
  /** Networks to register for v1 protocol (defaults to ["base-sepolia"]) */
  networks?: Array<string>
}

/**
 * Wrap an x402 HTTP client with Ampersend payment support.
 *
 * This integrates ampersend-sdk with Coinbase's x402 SDK, allowing you to use
 * sophisticated payment authorization logic with the standard x402 HTTP client ecosystem.
 *
 * @example
 * ```typescript
 * import { x402Client } from "@x402/core/client"
 * import { wrapFetchWithPayment } from "@x402/fetch"
 * import { createAmpersendHttpClient } from "@ampersend_ai/ampersend-sdk"
 *
 * const client = createAmpersendHttpClient({
 *   client: new x402Client(),
 *   smartAccountAddress: "0x...",
 *   sessionKeyPrivateKey: "0x...",
 * })
 *
 * const fetchWithPay = wrapFetchWithPayment(fetch, client)
 * const response = await fetchWithPay("https://paid-api.com/endpoint")
 * ```
 *
 * @param options - Simplified HTTP client configuration
 * @returns The configured x402Client instance (same instance, mutated)
 */
export function createAmpersendHttpClient(options: SimpleHttpClientOptions): x402Client {
  const treasurer = createAmpersendTreasurer({
    smartAccountAddress: options.smartAccountAddress,
    sessionKeyPrivateKey: options.sessionKeyPrivateKey,
    apiUrl: options.apiUrl ?? DEFAULT_API_URL,
    chainId: options.chainId ?? DEFAULT_CHAIN_ID,
  })

  return wrapWithAmpersend(options.client, treasurer, options.networks ?? DEFAULT_NETWORKS)
}

// Re-export original for advanced use cases
export { wrapWithAmpersend } from "./adapter.ts"
