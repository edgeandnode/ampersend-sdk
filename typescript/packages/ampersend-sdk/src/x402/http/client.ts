import { x402Client } from "@x402/core/client"
import type { PaymentPayloadV1, PaymentRequiredV1, PaymentRequiredV2 } from "@x402/core/schemas"
import type {
  PaymentPayloadResult,
  SchemeNetworkClient,
  PaymentPayload as V2PaymentPayload,
  PaymentRequired as V2PaymentRequired,
  PaymentRequirements as V2PaymentRequirements,
} from "@x402/core/types"

import type { PaymentRequest } from "../envelopes.ts"
import type { Authorization, X402Treasurer } from "../treasurer.ts"

/**
 * v1 uses network names (`"base"`), v2 uses CAIP-2 (`"eip155:8453"`) or
 * wildcards (`"eip155:*"`). Register whichever protocols you want to accept.
 */
export interface AmpersendNetworks {
  v1?: ReadonlyArray<string>
  v2?: ReadonlyArray<string>
}

export class PaymentDeclinedError extends Error {
  constructor() {
    super("Payment declined by treasurer")
    this.name = "PaymentDeclinedError"
  }
}

export class UnsupportedProtocolError extends Error {
  constructor(public readonly x402Version: number) {
    super(
      `No scheme registered for x402 version ${x402Version}. ` +
        `Register at least one network for this version via \`.withNetworks({ v${x402Version}: [...] })\`.`,
    )
    this.name = "UnsupportedProtocolError"
  }
}

/**
 * `x402Client` whose `accepts[i]` selection is driven by an async treasurer.
 *
 * Upstream's selector is sync, so we override `createPaymentPayload` to run
 * the treasurer first, stash `{ accepted → authorization }` in a WeakMap,
 * and delegate to `super`. The installed selector returns the stashed entry
 * by reference equality; our scheme client hands back the pre-signed payload.
 * Hooks, policies, extensions, and failure recovery stay upstream's.
 *
 * Reference equality on `Authorization.accepted` is load-bearing — the
 * treasurer must return the original `accepts[i]`, not a clone.
 */
export class AmpersendX402Client extends x402Client {
  readonly #treasurer: X402Treasurer
  readonly #authByAccepted: WeakMap<object, Authorization>
  readonly #supportedVersions = new Set<number>()

  constructor(treasurer: X402Treasurer) {
    const authByAccepted = new WeakMap<object, Authorization>()

    super((_x402Version, accepts) => {
      for (const accept of accepts) {
        if (authByAccepted.has(accept as object)) return accept
      }
      throw new Error(
        "AmpersendX402Client: the treasurer's pick is not present in the filtered " +
          "accepts[]. It was either filtered out by a registered policy or the scheme/" +
          "network is not registered. Register the network with `.withNetworks()` or " +
          "relax the policy so the treasurer's pick survives.",
      )
    })

    this.#treasurer = treasurer
    this.#authByAccepted = authByAccepted
  }

  withNetworks(networks: AmpersendNetworks): this {
    const schemeClient = new TreasurerSchemeClient(this.#authByAccepted)
    if (networks.v1?.length) this.#supportedVersions.add(1)
    if (networks.v2?.length) this.#supportedVersions.add(2)
    for (const network of networks.v1 ?? []) {
      this.registerV1(network, schemeClient)
    }
    for (const network of networks.v2 ?? []) {
      // Upstream pattern-matches networks (including wildcards), but types
      // them as CAIP-2 template literals.
      this.register(network as `${string}:${string}`, schemeClient)
    }
    return this
  }

  override async createPaymentPayload(paymentRequired: V2PaymentRequired): Promise<V2PaymentPayload> {
    // Fail before calling the treasurer — avoids wasting an API round-trip on an unsignable request.
    if (!this.#supportedVersions.has(paymentRequired.x402Version)) {
      throw new UnsupportedProtocolError(paymentRequired.x402Version)
    }

    const request = toPaymentRequest(paymentRequired)

    let authorization: Authorization | null
    try {
      authorization = await this.#treasurer.onPaymentRequired(request, { method: "http" })
    } catch (error) {
      throw new Error(`Treasurer failed: ${error instanceof Error ? error.message : String(error)}`)
    }
    if (!authorization) throw new PaymentDeclinedError()

    const accepted = authorization.accepted as unknown as object
    if (!paymentRequired.accepts.includes(authorization.accepted as never)) {
      throw new Error(
        "AmpersendX402Client: Authorization.accepted is not an element of " +
          "paymentRequired.accepts (reference equality required). The treasurer must " +
          "return the original accepts[i] reference, not a clone.",
      )
    }

    this.#authByAccepted.set(accepted, authorization)
    try {
      const payload = await super.createPaymentPayload(paymentRequired)
      await this.#treasurer.onStatus("sending", authorization, { method: "http" })
      return payload
    } catch (error) {
      await this.#treasurer.onStatus("error", authorization, {
        method: "http",
        params: { error: error instanceof Error ? error.message : String(error) },
      })
      throw error
    } finally {
      this.#authByAccepted.delete(accepted)
    }
  }
}

/** Does not sign — returns the treasurer's pre-signed payload, looked up by `accepts[i]` reference. */
class TreasurerSchemeClient implements SchemeNetworkClient {
  readonly scheme = "exact"

  constructor(private readonly store: WeakMap<object, Authorization>) {}

  async createPaymentPayload(
    x402Version: number,
    requirements: V2PaymentRequirements,
  ): Promise<PaymentPayloadV1 | PaymentPayloadResult> {
    const authorization = this.store.get(requirements as unknown as object)
    if (!authorization) {
      throw new Error(
        "TreasurerSchemeClient invoked without a stashed authorization. This " +
          "indicates a call path that bypassed AmpersendX402Client.createPaymentPayload.",
      )
    }

    const payment = authorization.payment
    if (x402Version === 1) {
      if (payment.protocol !== "x402-v1") {
        throw new Error(`Expected v1 authorization; got ${payment.protocol}`)
      }
      return payment.data
    }

    if (payment.protocol !== "x402-v2") {
      throw new Error(`Expected v2 authorization; got ${payment.protocol}`)
    }
    // Upstream reconstructs `resource` and `accepted` from paymentRequired,
    // so we only return x402Version + payload + optional extensions.
    const result: PaymentPayloadResult = {
      x402Version: payment.data.x402Version,
      payload: payment.data.payload,
    }
    if (payment.data.extensions != null) {
      result.extensions = payment.data.extensions
    }
    return result
  }
}

function toPaymentRequest(paymentRequired: V2PaymentRequired): PaymentRequest {
  switch (paymentRequired.x402Version) {
    case 1:
      return { protocol: "x402-v1", data: paymentRequired as unknown as PaymentRequiredV1 }
    case 2:
      return { protocol: "x402-v2", data: paymentRequired as unknown as PaymentRequiredV2 }
    default:
      throw new Error(`Unsupported x402 version: ${paymentRequired.x402Version}`)
  }
}
