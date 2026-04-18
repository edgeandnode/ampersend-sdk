import type {
  PaymentCreatedContext,
  PaymentCreationContext,
  PaymentCreationFailureContext,
  x402Client,
} from "@x402/core/client"
import type { PaymentRequiredV1, PaymentRequiredV2 } from "@x402/core/schemas"
import type {
  PaymentPayload as V2PaymentPayload,
  PaymentRequired as V2PaymentRequired,
  PaymentRequirements as V2PaymentRequirements,
} from "@x402/core/types"
import { EvmNetworkToChainId } from "x402/types"

import type { PaymentRequest } from "../envelopes.ts"
import type { Authorization, X402Treasurer } from "../treasurer.ts"

function caip2FromV1Name(network: string): `eip155:${number}` {
  const chainId = EvmNetworkToChainId.get(network as Parameters<typeof EvmNetworkToChainId.get>[0])
  if (chainId === undefined) throw new Error(`Unknown v1 network: ${network}`)
  return `eip155:${chainId}`
}

/**
 * Store entry keyed by the wire-format requirements object the x402 client
 * handed us. Holds the envelope-tagged authorization produced by the treasurer.
 */
interface StoreEntry {
  version: 1 | 2
  authorization: Authorization
}

/**
 * Scheme client for x402 v1 protocol. Pulls the envelope-tagged authorization
 * out of the shared store and returns its byte-exact `PaymentPayload`.
 */
class TreasurerSchemeClientV1 {
  readonly scheme = "exact"

  constructor(private readonly paymentStore: WeakMap<object, StoreEntry>) {}

  async createPaymentPayload(
    _x402Version: number,
    requirements: object,
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
 * When a 402 arrives, the before-payment hook builds a {@link PaymentRequest}
 * from the full 402 body and hands it to the treasurer. The resulting
 * authorization is stashed keyed by x402's `selectedRequirements` object, and
 * an outbound scheme client returns it on the way back out.
 *
 * Treasurers are expected to sign against the same `accepts[i]` that x402Client
 * pre-selected. To override x402's selection, register a custom
 * `selectPaymentRequirements` on the `x402Client` before wrapping.
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
    const paymentRequired = context.paymentRequired as V2PaymentRequired

    if (paymentRequired.x402Version !== 1 && paymentRequired.x402Version !== 2) {
      throw new Error(`Unsupported x402 version: ${paymentRequired.x402Version}`)
    }

    // x402Client types the 402 body as its v2 `PaymentRequired` surface, but
    // for v1 the runtime shape is `PaymentRequiredV1` (flat `resource` inside
    // each `accepts[i]`, no offer-level resource). Cast into the strict
    // per-version schemas types used by the envelope.
    const request: PaymentRequest =
      paymentRequired.x402Version === 2
        ? { protocol: "x402-v2", data: paymentRequired as unknown as PaymentRequiredV2 }
        : { protocol: "x402-v1", data: paymentRequired as unknown as PaymentRequiredV1 }

    // Treasurers read resource info directly off `request.data` (v2 top-level
    // or v1 per-option). No need to duplicate it on the context.
    const authorization = await treasurer.onPaymentRequired(request, { method: "http" })

    if (!authorization) {
      return { abort: true, reason: "Payment declined by treasurer" }
    }

    const version: 1 | 2 = paymentRequired.x402Version
    paymentStore.set(context.selectedRequirements, { version, authorization })
    authorizationByRequirements.set(context.selectedRequirements, authorization)
    return
  })

  client.onAfterPaymentCreation(async (context: PaymentCreatedContext) => {
    const authorization = authorizationByRequirements.get(context.selectedRequirements)
    if (authorization) {
      await treasurer.onStatus("sending", authorization, { method: "http" })
    }
  })

  client.onPaymentCreationFailure(async (context: PaymentCreationFailureContext) => {
    const authorization = authorizationByRequirements.get(context.selectedRequirements)
    if (authorization) {
      await treasurer.onStatus("error", authorization, {
        method: "http",
        params: { error: context.error.message },
      })
    }
    return
  })

  return client
}
