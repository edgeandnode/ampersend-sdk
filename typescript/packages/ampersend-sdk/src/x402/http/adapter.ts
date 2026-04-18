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
import { EvmNetworkToChainId, type PaymentRequirements as V1PaymentRequirements } from "x402/types"

import type { PaymentOption } from "../envelopes.ts"
import type { Authorization, X402Treasurer } from "../treasurer.ts"

// `@x402/core` ships two flavors of v2 ResourceInfo (loose/schemas vs strict/types).
// At the boundary we accept either; the v2 client library is the authoritative
// consumer, and accepts the strict shape we get from `paymentRequired.resource`.
type V2Resource = V2PaymentRequired["resource"]

function caip2FromV1Name(network: string): `eip155:${number}` {
  const chainId = EvmNetworkToChainId.get(network as Parameters<typeof EvmNetworkToChainId.get>[0])
  if (chainId === undefined) throw new Error(`Unknown v1 network: ${network}`)
  return `eip155:${chainId}`
}

/**
 * Store entry keyed by the wire-format requirements object the x402 client
 * handed us. Holds the envelope-tagged authorization produced by the
 * treasurer, plus (for v2) the resource info that the outgoing payload needs
 * to echo.
 */
interface V1StoreEntry {
  version: 1
  authorization: Authorization
}

interface V2StoreEntry {
  version: 2
  authorization: Authorization
  resource: V2Resource
  originalRequirements: V2PaymentRequirements
}

type StoreEntry = V1StoreEntry | V2StoreEntry

/**
 * Scheme client for x402 v1 protocol. Pulls the envelope-tagged authorization
 * out of the shared store and returns its byte-exact `PaymentPayload`.
 */
class TreasurerSchemeClientV1 {
  readonly scheme = "exact"

  constructor(private readonly paymentStore: WeakMap<object, StoreEntry>) {}

  async createPaymentPayload(
    _x402Version: number,
    requirements: V1PaymentRequirements,
  ): Promise<{ x402Version: number; scheme: string; network: string; payload: Record<string, unknown> }> {
    const entry = this.paymentStore.get(requirements)
    if (!entry || entry.version !== 1) {
      throw new Error("No v1 payment authorization found for requirements")
    }
    this.paymentStore.delete(requirements)

    const payment = entry.authorization.payment
    if (payment.protocol !== "x402-v1") {
      throw new Error(`Expected v1 authorization; got ${payment.protocol}`)
    }
    return {
      x402Version: payment.data.x402Version,
      scheme: payment.data.scheme,
      network: payment.data.network,
      payload: payment.data.payload as Record<string, unknown>,
    }
  }
}

/**
 * Scheme client for x402 v2 protocol. Pulls the envelope-tagged authorization
 * out of the shared store and returns the v2 payload fragment the v2 client
 * library expects.
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

    const payment = entry.authorization.payment
    if (payment.protocol !== "x402-v2") {
      throw new Error(`Expected v2 authorization; got ${payment.protocol}`)
    }
    return payment.data
  }
}

/**
 * Wrap an `x402Client` so payment decisions flow through an ampersend-sdk
 * treasurer.
 *
 * When a 402 arrives, the before-payment hook tags the seller's requirements
 * as an ampersend envelope (byte-exact inside), consults the treasurer, and
 * stashes the resulting authorization keyed by the original requirements
 * object so the outbound scheme client can hand it back to x402Client
 * without a second treasurer round-trip.
 */
export function wrapWithAmpersend(client: x402Client, treasurer: X402Treasurer, networks: Array<string>): x402Client {
  const paymentStore = new WeakMap<object, StoreEntry>()

  const schemeClientV1 = new TreasurerSchemeClientV1(paymentStore)
  const schemeClientV2 = new TreasurerSchemeClientV2(paymentStore)

  for (const network of networks) {
    // v1 registration keys on the network name ("base-sepolia"); v2 keys on CAIP-2.
    client.registerV1(network, schemeClientV1 as any)
    client.register(caip2FromV1Name(network), schemeClientV2 as any)
  }

  const authorizationByRequirements = new WeakMap<object, Authorization>()

  client.onBeforePaymentCreation(async (context: PaymentCreationContext) => {
    const originalRequirements = context.selectedRequirements
    const paymentRequired = context.paymentRequired as V2PaymentRequired

    if (paymentRequired.x402Version !== 1 && paymentRequired.x402Version !== 2) {
      throw new Error(`Unsupported x402 version: ${paymentRequired.x402Version}`)
    }

    let option: PaymentOption
    let storeEntry: StoreEntry
    let statusResource: string

    if (paymentRequired.x402Version === 2) {
      option = {
        protocol: "x402-v2",
        data: originalRequirements as V2PaymentRequirements,
        resource: paymentRequired.resource,
      }
      statusResource = paymentRequired.resource.url
    } else {
      option = { protocol: "x402-v1", data: originalRequirements as unknown as V1PaymentRequirements }
      statusResource = option.data.resource
    }

    const authorization = await treasurer.onPaymentRequired([option], {
      method: "http",
      params: { resource: statusResource },
    })

    if (!authorization) {
      return { abort: true, reason: "Payment declined by treasurer" }
    }

    if (option.protocol === "x402-v2") {
      storeEntry = {
        version: 2,
        authorization,
        // Casts bridge the loose (schemas) vs strict (mechanisms) v2 type pair.
        resource: option.resource as V2Resource,
        originalRequirements: option.data as V2PaymentRequirements,
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
        params: { resource: resourceUrl },
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
        params: { resource: resourceUrl, error: context.error.message },
      })
    }
    return
  })

  return client
}
