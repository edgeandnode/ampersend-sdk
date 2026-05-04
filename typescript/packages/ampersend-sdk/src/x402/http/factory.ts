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
const DEFAULT_NETWORK = "base"

export interface SimpleHttpClientOptions {
  /** Smart account address. */
  smartAccountAddress: Address
  /** Session key private key for signing. */
  sessionKeyPrivateKey: Hex
  /** Ampersend API URL. Defaults to production. */
  apiUrl?: string
  /** v1 network name (e.g. `"base"`). v1 and v2 (CAIP-2) are both registered. */
  network?: string
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
  const network = options.network ?? DEFAULT_NETWORK
  const chainId = (EVM_NETWORK_CHAIN_ID_MAP as Readonly<Record<string, number>>)[network]
  if (chainId === undefined) {
    throw new Error(`Unknown network: ${network}`)
  }

  const treasurer = createAmpersendTreasurer({
    smartAccountAddress: options.smartAccountAddress,
    sessionKeyPrivateKey: options.sessionKeyPrivateKey,
    apiUrl: options.apiUrl ?? DEFAULT_API_URL,
  })

  return new AmpersendX402Client(treasurer).withNetworks({
    v1: [network],
    v2: [`eip155:${chainId}`],
  })
}
