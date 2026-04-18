/**
 * Accessors for PaymentOption fields that differ across protocols.
 *
 * Only the fields that genuinely diverge between v1 and v2 need helpers.
 * Fields with identical names across protocols (`scheme`, `asset`, `payTo`,
 * `maxTimeoutSeconds`, `extra`) are read directly via `option.data.X`
 * after narrowing on `option.protocol` when the caller needs to.
 */

import { ChainIdToNetwork, EvmNetworkToChainId } from "x402/types"

import type { PaymentOption } from "./envelopes.ts"

/**
 * Translate an x402 v1 network name to a CAIP-2 identifier.
 * Internal helper; not exported from `x402/index.ts`.
 */
function v1NetworkToCaip2(network: string): `eip155:${number}` {
  const chainId = EvmNetworkToChainId.get(network as Parameters<typeof EvmNetworkToChainId.get>[0])
  if (chainId === undefined) {
    throw new Error(`Unknown v1 network: ${network}`)
  }
  return `eip155:${chainId}`
}

/**
 * Translate a CAIP-2 identifier to an x402 v1 network name.
 * Internal helper; not exported from `x402/index.ts`. Used by wallets that
 * build v1 wire shapes after signing.
 */
export function caip2ToV1Network(network: string): string {
  const parts = network.split(":")
  const chainIdStr = parts.length > 1 ? parts[1] : parts[0]
  const chainId = parseInt(chainIdStr, 10)
  const v1Network = ChainIdToNetwork[chainId]
  if (!v1Network) {
    throw new Error(`Unknown chain ID: ${chainId}`)
  }
  return v1Network
}

/**
 * Read the payment amount (atomic units, stringified integer) from an option.
 *
 * x402 v1 calls this field `maxAmountRequired`; v2 calls it `amount`.
 */
export function getAmount(option: PaymentOption): string {
  return option.protocol === "x402-v1" ? option.data.maxAmountRequired : option.data.amount
}

/**
 * Read the network as a CAIP-2 identifier (`eip155:<chainId>`).
 *
 * v2 already uses CAIP-2. v1 uses short names (`"base"`, `"base-sepolia"`) —
 * we translate.
 */
export function getNetworkCaip2(option: PaymentOption): `eip155:${number}` {
  return option.protocol === "x402-v1"
    ? v1NetworkToCaip2(option.data.network)
    : (option.data.network as `eip155:${number}`)
}

/**
 * Read the URL of the resource being paid for.
 *
 * v1 stores `resource` as a flat string on the requirement itself. v2 puts
 * `ResourceInfo` outside the per-option entry, on the outer `PaymentRequired`;
 * we carry it on the envelope for v2.
 */
export function getResourceUrl(option: PaymentOption): string {
  return option.protocol === "x402-v1" ? option.data.resource : option.resource.url
}
