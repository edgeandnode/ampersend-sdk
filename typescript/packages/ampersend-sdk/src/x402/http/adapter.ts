import type {
  PaymentCreatedContext,
  PaymentCreationContext,
  PaymentCreationFailureContext,
  x402Client,
} from "@x402/core/client"
import type {
  PaymentPayload as V2PaymentPayload,
  PaymentRequired as V2PaymentRequired,
  PaymentRequirements as V2PaymentRequirements,
} from "@x402/core/types"
import type { PaymentRequirements as V1PaymentRequirements } from "x402/types"

import type { PaymentOption } from "../../ampersend/types.ts"
import type { Authorization, X402Treasurer } from "../treasurer.ts"
import {
  fromV1Requirements,
  fromV2Requirements,
  toV1PaymentPayload,
  toV2PaymentPayloadFragment,
  v1NetworkToCaip2,
} from "./conversions.ts"

/**
 * Store entry holding a canonical authorization alongside the original x402
 * wire-format requirements object it was produced for. The wire-format object
 * is kept so the outbound scheme clients can rebuild a correctly-shaped
 * envelope (v1 or v2) without needing a second round trip through the
 * treasurer.
 */
interface V1StoreEntry {
  version: 1
  authorization: Authorization
}

interface V2StoreEntry {
  version: 2
  authorization: Authorization
  resource: V2PaymentRequired["resource"]
  originalRequirements: V2PaymentRequirements
}

type StoreEntry = V1StoreEntry | V2StoreEntry

/**
 * Scheme client for x402 v1 protocol. Retrieves the canonical authorization
 * from the shared store and wraps it in a v1 PaymentPayload envelope.
 */
class TreasurerSchemeClientV1 {
  readonly scheme = "exact"

  constructor(private readonly paymentStore: WeakMap<object, StoreEntry>) {}

  async createPaymentPayload(
    x402Version: number,
    requirements: V1PaymentRequirements,
  ): Promise<{ x402Version: number; scheme: string; network: string; payload: Record<string, unknown> }> {
    const entry = this.paymentStore.get(requirements)
    if (!entry) {
      throw new Error("No payment authorization found for requirements")
    }

    this.paymentStore.delete(requirements)

    const v1Payload = toV1PaymentPayload(entry.authorization.payment)
    return {
      x402Version,
      scheme: v1Payload.scheme,
      network: v1Payload.network,
      payload: v1Payload.payload as Record<string, unknown>,
    }
  }
}

/**
 * Scheme client for x402 v2 protocol. Retrieves the canonical authorization
 * from the shared store and builds the v2 payload fragment expected by the
 * v2 client library.
 */
class TreasurerSchemeClientV2 {
  readonly scheme = "exact"

  constructor(private readonly paymentStore: WeakMap<object, StoreEntry>) {}

  async createPaymentPayload(
    _x402Version: number,
    requirements: V2PaymentRequirements,
  ): Promise<Pick<V2PaymentPayload, "x402Version" | "payload">> {
    const entry = this.paymentStore.get(requirements)
    if (!entry || entry.version !== 2) {
      throw new Error("No v2 payment authorization found for requirements")
    }

    this.paymentStore.delete(requirements)

    return toV2PaymentPayloadFragment(entry.authorization.payment, entry.originalRequirements, entry.resource)
  }
}

/**
 * Wraps an x402Client so payment decisions flow through an ampersend-sdk
 * treasurer speaking ampersend's canonical payment types.
 *
 * The wrapper registers per-network scheme clients for both x402 v1 and v2
 * protocols. When a 402 arrives, the before-payment hook translates the
 * seller's requirements into canonical form, consults the treasurer, and
 * stashes the resulting authorization so the outbound scheme client can
 * rebuild a correctly-shaped envelope without going through the treasurer
 * again.
 *
 * @param client - The x402Client instance to wrap
 * @param treasurer - The X402Treasurer that handles payment authorization
 * @param networks - Array of v1 network names to register (e.g. `'base'`, `'base-sepolia'`)
 * @returns The configured x402Client instance (same instance, mutated)
 *
 * @example
 * ```typescript
 * import { x402Client } from '@x402/core/client'
 * import { wrapFetchWithPayment } from '@x402/fetch'
 * import { wrapWithAmpersend, NaiveTreasurer, AccountWallet } from '@ampersend_ai/ampersend-sdk'
 *
 * const wallet = AccountWallet.fromPrivateKey('0x...')
 * const treasurer = new NaiveTreasurer(wallet)
 *
 * const client = wrapWithAmpersend(
 *   new x402Client(),
 *   treasurer,
 *   ['base', 'base-sepolia']
 * )
 *
 * const fetchWithPay = wrapFetchWithPayment(fetch, client)
 * const response = await fetchWithPay('https://paid-api.com/endpoint')
 * ```
 */
export function wrapWithAmpersend(client: x402Client, treasurer: X402Treasurer, networks: Array<string>): x402Client {
  // Shared store for correlating payments between hooks and scheme clients.
  // Keyed by the original wire-format requirements object (v1 or v2).
  const paymentStore = new WeakMap<object, StoreEntry>()

  const schemeClientV1 = new TreasurerSchemeClientV1(paymentStore)
  const schemeClientV2 = new TreasurerSchemeClientV2(paymentStore)

  for (const network of networks) {
    // v1: uses network names like "base-sepolia"
    client.registerV1(network, schemeClientV1 as any)

    // v2: uses CAIP-2 format like "eip155:84532"
    const caip2Network = v1NetworkToCaip2(network)
    client.register(caip2Network, schemeClientV2 as any)
  }

  // Track authorization for status updates, keyed by the wire-format
  // requirements object.
  const authorizationByRequirements = new WeakMap<object, Authorization>()

  client.onBeforePaymentCreation(async (context: PaymentCreationContext) => {
    const originalRequirements = context.selectedRequirements
    const paymentRequired = context.paymentRequired as V2PaymentRequired

    if (paymentRequired.x402Version !== 1 && paymentRequired.x402Version !== 2) {
      throw new Error(`Unsupported x402 version: ${paymentRequired.x402Version}`)
    }

    let canonicalOption: PaymentOption
    let storeEntry: StoreEntry
    let statusResource: string

    if (paymentRequired.x402Version === 2) {
      canonicalOption = fromV2Requirements(originalRequirements as V2PaymentRequirements, paymentRequired.resource)
      statusResource = paymentRequired.resource.url
    } else {
      canonicalOption = fromV1Requirements(originalRequirements as unknown as V1PaymentRequirements)
      statusResource = canonicalOption.resource.url
    }

    const authorization = await treasurer.onPaymentRequired([canonicalOption], {
      method: "http",
      params: {
        resource: statusResource,
      },
    })

    if (!authorization) {
      return { abort: true, reason: "Payment declined by treasurer" }
    }

    if (paymentRequired.x402Version === 2) {
      storeEntry = {
        version: 2,
        authorization,
        resource: paymentRequired.resource,
        originalRequirements: originalRequirements as V2PaymentRequirements,
      }
    } else {
      storeEntry = { version: 1, authorization }
    }

    paymentStore.set(originalRequirements, storeEntry)
    authorizationByRequirements.set(originalRequirements, authorization)

    return
  })

  client.onAfterPaymentCreation(async (context: PaymentCreatedContext) => {
    const paymentRequired = context.paymentRequired as V2PaymentRequired
    const authorization = authorizationByRequirements.get(context.selectedRequirements)
    if (authorization) {
      const resourceUrl =
        typeof paymentRequired.resource === "object" ? paymentRequired.resource.url : paymentRequired.resource
      await treasurer.onStatus("sending", authorization, {
        method: "http",
        params: {
          resource: resourceUrl,
        },
      })
    }
  })

  client.onPaymentCreationFailure(async (context: PaymentCreationFailureContext) => {
    const paymentRequired = context.paymentRequired as V2PaymentRequired
    const authorization = authorizationByRequirements.get(context.selectedRequirements)
    if (authorization) {
      const resourceUrl =
        typeof paymentRequired.resource === "object" ? paymentRequired.resource.url : paymentRequired.resource
      await treasurer.onStatus("error", authorization, {
        method: "http",
        params: {
          resource: resourceUrl,
          error: context.error.message,
        },
      })
    }

    // Don't recover - let the error propagate
    return
  })

  return client
}
