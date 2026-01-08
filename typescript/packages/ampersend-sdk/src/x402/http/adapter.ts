import type {
  PaymentCreatedContext,
  PaymentCreationContext,
  PaymentCreationFailureContext,
  x402Client,
} from "@x402/core/client"
import type { PaymentRequirements } from "x402/types"

import type { Authorization, X402Treasurer } from "../treasurer.ts"

/**
 * Scheme client that retrieves payments from the treasurer via a shared WeakMap.
 * Compatible with @x402/core's SchemeNetworkClient interface for v1 protocol.
 *
 * Note: We don't implement SchemeNetworkClient directly because @x402/core
 * exports v2 types, but registerV1() passes v1 types at runtime.
 */
class TreasurerSchemeClient {
  readonly scheme = "exact"

  constructor(private readonly paymentStore: WeakMap<PaymentRequirements, Authorization>) {}

  async createPaymentPayload(
    x402Version: number,
    requirements: PaymentRequirements,
  ): Promise<{ x402Version: number; payload: Record<string, unknown> }> {
    const authorization = this.paymentStore.get(requirements)
    if (!authorization) {
      throw new Error("No payment authorization found for requirements")
    }

    // Clean up after retrieval
    this.paymentStore.delete(requirements)

    return {
      x402Version,
      payload: authorization.payment.payload,
    }
  }
}

/**
 * Wraps an x402Client to use an ampersend-sdk treasurer for payment decisions.
 *
 * This adapter integrates ampersend-sdk treasurers with Coinbase's x402 v2 SDK,
 * allowing you to use sophisticated payment authorization logic (budgets, policies,
 * approvals) with the standard x402 HTTP client ecosystem.
 *
 * Note: This adapter registers for v1 protocol because the underlying wallets
 * (AccountWallet, SmartAccountWallet) produce v1 payment payloads.
 *
 * @param client - The x402Client instance to wrap
 * @param treasurer - The X402Treasurer that handles payment authorization
 * @param networks - Array of v1 network names to register (e.g., 'base', 'base-sepolia')
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
  // Shared store for correlating payments between hooks and scheme client
  const paymentStore = new WeakMap<PaymentRequirements, Authorization>()

  // Register TreasurerSchemeClient for v1 protocol on each network
  // Using registerV1 because our wallets produce v1 payment payloads
  // Cast to any because @x402/core types are v2, but registerV1 accepts v1 at runtime
  const schemeClient = new TreasurerSchemeClient(paymentStore)
  for (const network of networks) {
    client.registerV1(network, schemeClient as any)
  }

  // Track authorization for status updates
  const authorizationByRequirements = new WeakMap<PaymentRequirements, Authorization>()

  // beforePaymentCreation: Consult treasurer for payment authorization
  client.onBeforePaymentCreation(async (context: PaymentCreationContext) => {
    // v1 requirements are passed directly to treasurer (no conversion needed)
    const requirements = context.selectedRequirements as unknown as PaymentRequirements

    const authorization = await treasurer.onPaymentRequired([requirements], {
      method: "http",
      params: {
        resource: context.paymentRequired.resource,
      },
    })

    if (!authorization) {
      return { abort: true, reason: "Payment declined by treasurer" }
    }

    // Store for scheme client to retrieve
    paymentStore.set(requirements, authorization)
    // Store for status tracking
    authorizationByRequirements.set(requirements, authorization)

    return
  })

  // afterPaymentCreation: Notify treasurer payment is being sent
  client.onAfterPaymentCreation(async (context: PaymentCreatedContext) => {
    const requirements = context.selectedRequirements as unknown as PaymentRequirements
    const authorization = authorizationByRequirements.get(requirements)
    if (authorization) {
      await treasurer.onStatus("sending", authorization, {
        method: "http",
        params: {
          resource: context.paymentRequired.resource,
        },
      })
    }
  })

  // onPaymentCreationFailure: Notify treasurer of error
  client.onPaymentCreationFailure(async (context: PaymentCreationFailureContext) => {
    const requirements = context.selectedRequirements as unknown as PaymentRequirements
    const authorization = authorizationByRequirements.get(requirements)
    if (authorization) {
      await treasurer.onStatus("error", authorization, {
        method: "http",
        params: {
          resource: context.paymentRequired.resource,
          error: context.error.message,
        },
      })
    }

    // Don't recover - let the error propagate
    return
  })

  return client
}
