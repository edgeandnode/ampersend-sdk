import { HTTPFacilitatorClient, x402ResourceServer, type FacilitatorConfig } from "@x402/core/server"
import type { Network, PaymentPayload, PaymentRequirements, SettleResponse, VerifyResponse } from "@x402/core/types"
import { ExactEvmScheme } from "@x402/evm/exact/server"

import type { X402ServerExecutor } from "./executor.ts"

export interface FacilitatorX402ServerExecutorOptions {
  /**
   * A fully-configured `x402ResourceServer` (schemes already registered).
   * Use this when you need custom schemes / multiple networks. Mutually
   * exclusive with the `facilitator` + `network` shorthand below.
   */
  resourceServer?: x402ResourceServer
  /**
   * Facilitator config (e.g. `{ url }`, or a Coinbase facilitator). Used
   * with `network` to build a default `x402ResourceServer` registered with
   * the EVM `exact` scheme — matching the common single-network seller.
   */
  facilitator?: FacilitatorConfig
  /** Network the default resource server registers the `exact` scheme for. */
  network?: Network
}

/**
 * Default x402 server executor that delegates verify and settle straight to
 * the facilitator (via an `x402ResourceServer`). This is the non-compliance
 * baseline; `AmpersendX402ServerExecutor` composes it to add the screening
 * gate in front of verify.
 */
export class FacilitatorX402ServerExecutor implements X402ServerExecutor {
  private readonly resourceServer: x402ResourceServer

  constructor(options: FacilitatorX402ServerExecutorOptions) {
    if (options.resourceServer) {
      this.resourceServer = options.resourceServer
      return
    }
    if (!options.network) {
      throw new Error(
        "FacilitatorX402ServerExecutor requires either a `resourceServer` or a `network` to build a default one",
      )
    }
    const facilitatorClient = new HTTPFacilitatorClient(options.facilitator)
    this.resourceServer = new x402ResourceServer(facilitatorClient).register(options.network, new ExactEvmScheme())
  }

  verifyPayment(payload: PaymentPayload, requirements: PaymentRequirements): Promise<VerifyResponse> {
    return this.resourceServer.verifyPayment(payload, requirements)
  }

  settlePayment(payload: PaymentPayload, requirements: PaymentRequirements): Promise<SettleResponse> {
    return this.resourceServer.settlePayment(payload, requirements)
  }
}
