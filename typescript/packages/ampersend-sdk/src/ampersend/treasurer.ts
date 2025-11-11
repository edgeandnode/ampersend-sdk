import type { PaymentEvent } from "@edgeandnode/ampersend-sdk/mcp/client"
import {
  createWalletFromConfig,
  type Authorization,
  type PaymentContext,
  type PaymentStatus,
  type WalletConfig,
  type X402Treasurer,
  type X402Wallet,
} from "@edgeandnode/ampersend-sdk/x402"

import { ApiClient } from "./client.ts"

/**
 * Configuration for the Ampersend treasurer
 */
export interface AmpersendTreasurerConfig {
  /** Base URL of the Ampersend API server */
  apiUrl: string
  /** Wallet configuration (EOA or Smart Account) */
  walletConfig: WalletConfig
  /** Optional authentication configuration */
  authConfig?: {
    /** SIWE domain for authentication */
    domain?: string
    /** SIWE statement for authentication */
    statement?: string
  }
}

/**
 * AmpersendTreasurer - Ampersend API-based payment authorization with X402Treasurer pattern
 *
 * This treasurer:
 * 1. Authenticates with the Ampersend API using SIWE
 * 2. Requests payment authorization from the API before creating payments
 * 3. Creates payments only when authorized by the API
 * 4. Reports payment lifecycle events back to the API for tracking
 *
 * @example
 * ```typescript
 * const treasurer = createAmpersendTreasurer({
 *   apiUrl: "https://api.example.com",
 *   walletConfig: { type: "eoa", privateKey: "0x..." }
 * })
 * await initializeProxyServer({ transport, treasurer })
 * ```
 */
export class AmpersendTreasurer implements X402Treasurer {
  constructor(
    private apiClient: ApiClient,
    private wallet: X402Wallet,
  ) {}

  /**
   * Requests payment authorization from API before creating payment.
   * Only creates payment if API authorizes it.
   */
  async onPaymentRequired(requirements: Array<any>, context?: PaymentContext): Promise<Authorization | null> {
    try {
      // Authorize payment with API
      const response = await this.apiClient.authorizePayment(requirements as any, context)

      if (!response.authorized) {
        console.log(`[AmpersendTreasurer] Payment not authorized: ${response.reason || "No reason provided"}`)
        return null // Decline
      }

      // Get first requirement
      const firstRequirement = requirements[0]
      if (!firstRequirement) {
        throw new Error("No payment requirements provided")
      }

      // Create payment with wallet
      const payment = await this.wallet.createPayment(firstRequirement)

      return {
        payment,
        authorizationId: crypto.randomUUID(),
      }
    } catch (error) {
      console.error("[AmpersendTreasurer] Payment authorization failed:", error)
      return null
    }
  }

  /**
   * Reports payment status updates back to API for tracking.
   * Logs errors but doesn't fail on tracking errors.
   */
  async onStatus(status: PaymentStatus, authorization: Authorization, _context?: PaymentContext): Promise<void> {
    try {
      // Map status to event type for API
      const event = this.mapStatusToEvent(status)
      await this.apiClient.reportPaymentEvent(authorization.authorizationId, authorization.payment, event)
    } catch (error) {
      // Log but don't fail on event tracking errors
      console.error(`[AmpersendTreasurer] Failed to report status ${status}:`, error)
    }
  }

  /**
   * Maps X402 PaymentStatus to legacy PaymentEvent for API compatibility
   */
  private mapStatusToEvent(status: PaymentStatus): PaymentEvent {
    switch (status) {
      case "sending":
        return { type: "sending" }
      case "accepted":
        return { type: "accepted" }
      case "rejected":
        return { type: "rejected", reason: "Payment rejected by server" }
      case "declined":
        return { type: "rejected", reason: "Payment declined by treasurer" }
      case "error":
        return { type: "error", reason: "Payment processing error" }
    }
  }
}

/**
 * Creates an Ampersend treasurer that consults the Ampersend API before making payments.
 *
 * This treasurer:
 * 1. Authenticates with the Ampersend API using SIWE
 * 2. Requests payment authorization from the API
 * 3. Creates payments only when authorized
 * 4. Reports payment lifecycle events back to the API
 *
 * @param config - Configuration for the Ampersend treasurer
 * @returns An X402Treasurer implementation
 */
export function createAmpersendTreasurer(config: AmpersendTreasurerConfig): X402Treasurer {
  const { apiUrl, authConfig, walletConfig } = config

  // Determine which private key to use for API authentication
  const authPrivateKey = walletConfig.type === "eoa" ? walletConfig.privateKey : walletConfig.sessionKeyPrivateKey

  // Create API client
  const apiClient = new ApiClient({
    baseUrl: apiUrl,
    sessionKeyPrivateKey: authPrivateKey,
    timeout: 30000,
    ...authConfig,
  })

  // Create wallet from configuration
  const wallet = createWalletFromConfig(walletConfig)

  return new AmpersendTreasurer(apiClient, wallet)
}
