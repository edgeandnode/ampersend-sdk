/**
 * Returns an `x402Client` subclass, so the result drops into
 * `wrapFetchWithPayment` unchanged. For advanced setups, construct
 * `AmpersendX402Client` directly.
 */

import { EVM_NETWORK_CHAIN_ID_MAP } from "@x402/evm/v1"
import type { Address, Hex } from "viem"

import { createAmpersendTreasurer } from "../../ampersend/treasurer.ts"
import { AmpersendX402Client } from "./client.ts"

const DEFAULT_API_URL = "https://api.ampersend.ai"

// Ampersend smart accounts run on Base. Register both mainnet and testnet so
// the buyer can pay sellers on either without per-call configuration; the API
// arbitrates which one is actually authorized.
const SUPPORTED_V1_NETWORKS = ["base", "base-sepolia"] as const

export interface SimpleHttpClientOptions {
  /** Smart account address. */
  smartAccountAddress: Address
  /** Session key private key for signing. */
  sessionKeyPrivateKey: Hex
  /** Ampersend API URL. Defaults to production. */
  apiUrl?: string
}

/**
 * Create an `AmpersendX402Client` wired to the Ampersend API.
 *
 * @example
 * ```typescript
 * import { wrapFetchWithPayment } from "@x402/fetch"
 * import { createAmpersendHttpClient } from "@ampersend_ai/ampersend-sdk"
 *
 * const client = createAmpersendHttpClient({
 *   smartAccountAddress: "0x...",
 *   sessionKeyPrivateKey: "0x...",
 * })
 * const fetchWithPay = wrapFetchWithPayment(fetch, client)
 * const response = await fetchWithPay("https://paid-api.com/endpoint")
 * ```
 */
export function createAmpersendHttpClient(options: SimpleHttpClientOptions): AmpersendX402Client {
  const chainIds = SUPPORTED_V1_NETWORKS.map((network) => {
    const chainId = (EVM_NETWORK_CHAIN_ID_MAP as Readonly<Record<string, number>>)[network]
    if (chainId === undefined) {
      throw new Error(`Unknown network: ${network}`)
    }
    return chainId
  })

  const treasurer = createAmpersendTreasurer({
    smartAccountAddress: options.smartAccountAddress,
    sessionKeyPrivateKey: options.sessionKeyPrivateKey,
    apiUrl: options.apiUrl ?? DEFAULT_API_URL,
  })

  return new AmpersendX402Client(treasurer).withNetworks({
    v1: SUPPORTED_V1_NETWORKS,
    v2: chainIds.map((id) => `eip155:${id}`),
  })
}
