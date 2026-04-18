import type { PaymentAuthorization, PaymentOption } from "./envelopes.ts"

/**
 * Context information for payment decisions
 */
export interface PaymentContext {
  method: string
  params: any
  metadata?: Record<string, unknown>
}

/**
 * Authorization linking a signed payment with a tracking ID
 */
export interface Authorization {
  payment: PaymentAuthorization
  authorizationId: string
}

/**
 * Payment status types for tracking payment lifecycle
 */
export type PaymentStatus =
  | "sending" // Payment submitted to seller
  | "accepted" // Payment verified and accepted
  | "rejected" // Payment rejected by seller
  | "declined" // Buyer declined to pay
  | "error" // Error during payment processing

/**
 * X402Treasurer interface - separates payment decision logic from payment creation.
 *
 * An X402Treasurer decides whether to approve or reject payment requests,
 * tracks payment status, and delegates actual payment creation to an X402Wallet.
 *
 * Payments cross this interface as ampersend protocol envelopes — each option
 * and authorization carries a `protocol` tag with byte-exact protocol data
 * inside `data`. Treasurer implementations narrow on `option.protocol` when
 * they need protocol-specific fields; the `accessors` helpers (`getAmount`,
 * `getNetworkCaip2`, `getResourceUrl`) cover the cross-protocol reads.
 *
 * @example
 * ```typescript
 * class BudgetTreasurer implements X402Treasurer {
 *   constructor(private wallet: X402Wallet, private dailyLimit: number) {}
 *
 *   async onPaymentRequired(options, context) {
 *     if (this.wouldExceedBudget(options[0])) {
 *       return null // Decline
 *     }
 *     const payment = await this.wallet.createPayment(options[0])
 *     return { payment, authorizationId: crypto.randomUUID() }
 *   }
 *
 *   async onStatus(status, authorization, context) {
 *     console.log(`Payment ${authorization.authorizationId}: ${status}`)
 *   }
 * }
 * ```
 */
export interface X402Treasurer {
  /**
   * Called when payment is required.
   *
   * @param options - Array of payment options from seller (typically use the first)
   * @param context - Optional context about the request requiring payment
   * @returns Authorization to proceed with payment, or null to decline
   */
  onPaymentRequired(options: ReadonlyArray<PaymentOption>, context?: PaymentContext): Promise<Authorization | null>

  /**
   * Called with payment status updates throughout the payment lifecycle.
   *
   * @param status - Current payment status
   * @param authorization - The authorization returned from onPaymentRequired
   * @param context - Optional context about the status update
   */
  onStatus(status: PaymentStatus, authorization: Authorization, context?: PaymentContext): Promise<void>
}
