/**
 * Anti-corruption layer between x402 wire formats (v1, v2) and ampersend's
 * canonical payment types.
 *
 * Every function in this module is pure: canonical ↔ wire. No SDK state, no
 * side effects. This is the only place in the SDK that imports x402 types —
 * everywhere else speaks canonical.
 */

import type {
  PaymentPayload as V2PaymentPayload,
  PaymentRequired as V2PaymentRequired,
  PaymentRequirements as V2PaymentRequirements,
} from "@x402/core/types"
import {
  ChainIdToNetwork,
  EvmNetworkToChainId,
  type PaymentPayload as V1PaymentPayload,
  type PaymentRequirements as V1PaymentRequirements,
  type SettleResponse as V1SettleResponse,
} from "x402/types"

import type { PaymentAuthorization, PaymentOption, ResourceInfo, SettlementResult } from "../../ampersend/types.ts"

const DEFAULT_MAX_TIMEOUT_SECONDS = 300

/**
 * Narrow an inbound wire-format scheme string to the schemes canonical accepts.
 * Every SDK wallet today only signs "exact"; expand when a second scheme lands.
 */
function narrowScheme(scheme: string): "exact" {
  if (scheme !== "exact") {
    throw new Error(`Unsupported x402 scheme: "${scheme}". SDK only supports "exact".`)
  }
  return scheme
}

// ============================================================================
// Network identifier translation
// ============================================================================

/**
 * Convert a v1 x402 network name to a CAIP-2 identifier.
 *
 * @example v1NetworkToCaip2("base-sepolia") // => "eip155:84532"
 */
export function v1NetworkToCaip2(network: string): `eip155:${number}` {
  const chainId = EvmNetworkToChainId.get(network as Parameters<typeof EvmNetworkToChainId.get>[0])
  if (chainId === undefined) {
    throw new Error(`Unknown v1 network: ${network}`)
  }
  return `eip155:${chainId}`
}

/**
 * Extract the numeric chain ID from a CAIP-2 identifier (or a bare number).
 *
 * @example parseCaip2ChainId("eip155:8453") // => 8453
 */
export function parseCaip2ChainId(network: string): number {
  const parts = network.split(":")
  const chainIdStr = parts.length > 1 ? parts[1] : parts[0]
  return parseInt(chainIdStr, 10)
}

/**
 * Convert a CAIP-2 identifier to a v1 x402 network name.
 *
 * @example caip2ToV1Network("eip155:84532") // => "base-sepolia"
 */
export function caip2ToV1Network(network: string): string {
  const chainId = parseCaip2ChainId(network)
  const v1Network = ChainIdToNetwork[chainId]
  if (!v1Network) {
    throw new Error(`Unknown chain ID: ${chainId}`)
  }
  return v1Network
}

// ============================================================================
// Inbound: x402 wire → canonical
// ============================================================================

/**
 * Translate an x402 v1 PaymentRequirements object to a canonical PaymentOption.
 *
 * v1 embeds resource/description/mimeType directly in the requirements and
 * uses `maxAmountRequired` for the amount. We lift them out so the rest of the
 * SDK can read one consistent shape.
 */
export function fromV1Requirements(v1Req: V1PaymentRequirements): PaymentOption {
  const resource: ResourceInfo = {
    url: v1Req.resource,
    ...(v1Req.description ? { description: v1Req.description } : {}),
    ...(v1Req.mimeType ? { mimeType: v1Req.mimeType } : {}),
  }
  return {
    scheme: narrowScheme(v1Req.scheme),
    network: v1NetworkToCaip2(v1Req.network),
    amount: v1Req.maxAmountRequired,
    asset: v1Req.asset,
    payTo: v1Req.payTo,
    maxTimeoutSeconds: v1Req.maxTimeoutSeconds,
    resource,
    extra: v1Req.extra ?? {},
  }
}

/**
 * Translate an x402 v2 PaymentRequirements object to a canonical PaymentOption.
 *
 * v2 already separates the ResourceInfo, which is passed alongside the
 * requirements (it lives on the 402 response, not each individual option).
 */
export function fromV2Requirements(
  v2Req: V2PaymentRequirements,
  resource: V2PaymentRequired["resource"],
): PaymentOption {
  const resourceInfo: ResourceInfo = {
    url: resource.url,
    ...(resource.description ? { description: resource.description } : {}),
    ...(resource.mimeType ? { mimeType: resource.mimeType } : {}),
  }
  return {
    scheme: narrowScheme(v2Req.scheme),
    network: v2Req.network,
    amount: v2Req.amount,
    asset: v2Req.asset,
    payTo: v2Req.payTo,
    maxTimeoutSeconds: v2Req.maxTimeoutSeconds ?? DEFAULT_MAX_TIMEOUT_SECONDS,
    resource: resourceInfo,
    extra: v2Req.extra ?? {},
  }
}

// ============================================================================
// Outbound: canonical → x402 wire
// ============================================================================

/**
 * Build an x402 v1 PaymentRequirements shape from a canonical PaymentOption.
 *
 * Used when an internal component only speaks v1 wire format (e.g. the
 * `createPaymentHeader` helper from `x402/client`) and we need to hand it
 * something it understands.
 */
export function toV1Requirements(option: PaymentOption): V1PaymentRequirements {
  return {
    scheme: option.scheme as V1PaymentRequirements["scheme"],
    network: caip2ToV1Network(option.network) as V1PaymentRequirements["network"],
    maxAmountRequired: option.amount,
    resource: option.resource.url,
    description: option.resource.description || option.resource.url,
    mimeType: option.resource.mimeType || "",
    payTo: option.payTo,
    maxTimeoutSeconds: option.maxTimeoutSeconds,
    asset: option.asset,
    extra: { ...option.extra },
  }
}

/**
 * Wrap a canonical PaymentAuthorization in an x402 v1 PaymentPayload envelope.
 *
 * The v1 envelope carries `{ x402Version: 1, scheme, network, payload }` with
 * the network as a string name. The canonical `body` is already scheme-specific
 * and protocol-version-agnostic (e.g. `{ signature, authorization }` for
 * exact EVM) — it maps directly to v1's `payload` field.
 */
export function toV1PaymentPayload(auth: PaymentAuthorization): V1PaymentPayload {
  return {
    x402Version: 1,
    scheme: auth.scheme as V1PaymentPayload["scheme"],
    network: caip2ToV1Network(auth.network) as V1PaymentPayload["network"],
    payload: auth.body as V1PaymentPayload["payload"],
  }
}

/**
 * Build the x402 v2 PaymentPayload fragment expected by the v2 client library.
 *
 * The v2 library reconstructs the outer envelope itself; scheme clients
 * return `{ x402Version, payload }` plus optional resource/accepted echoes.
 */
export function toV2PaymentPayloadFragment(
  auth: PaymentAuthorization,
  originalV2Requirements: V2PaymentRequirements,
  resource: V2PaymentRequired["resource"],
): Pick<V2PaymentPayload, "x402Version" | "payload"> & Partial<V2PaymentPayload> {
  return {
    x402Version: 2,
    resource,
    accepted: originalV2Requirements,
    payload: auth.body as V2PaymentPayload["payload"],
  }
}

/**
 * Strip the v1 PaymentPayload envelope off a wire-format payment, yielding
 * the canonical PaymentAuthorization that was wrapped inside.
 *
 * Used on the seller side where the server receives a v1 payment from the
 * wire and wants to hand it to canonical-speaking business logic.
 */
export function fromV1PaymentPayload(v1: V1PaymentPayload): PaymentAuthorization {
  return {
    scheme: v1.scheme,
    network: v1NetworkToCaip2(v1.network),
    body: v1.payload as Record<string, unknown>,
  }
}

/**
 * Translate a canonical SettlementResult into the v1 SettleResponse wire shape
 * (for embedding into MCP or HTTP responses that still speak v1).
 */
export function toV1SettleResponse(result: SettlementResult): V1SettleResponse {
  return {
    success: result.success,
    transaction: (result.transaction ?? "") as V1SettleResponse["transaction"],
    network: caip2ToV1Network(result.network) as V1SettleResponse["network"],
    ...(result.errorReason !== undefined ? { errorReason: result.errorReason as V1SettleResponse["errorReason"] } : {}),
    ...(result.payer !== undefined ? { payer: result.payer as V1SettleResponse["payer"] } : {}),
  }
}

/**
 * Translate a v1 SettleResponse into a canonical SettlementResult.
 *
 * Convenience helper for seller-side code that still talks to a v1
 * facilitator (e.g. `useFacilitator` from `x402/verify`).
 */
export function fromV1SettleResponse(v1: V1SettleResponse): SettlementResult {
  return {
    success: v1.success,
    network: v1NetworkToCaip2(v1.network),
    ...(v1.payer !== undefined ? { payer: v1.payer } : {}),
    ...(v1.transaction ? { transaction: v1.transaction } : {}),
    ...(v1.errorReason !== undefined ? { errorReason: v1.errorReason } : {}),
  }
}
