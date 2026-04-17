import type { PaymentAuthorization, PaymentOption } from "./canonical.ts"

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
 * All payment data crosses this interface in ampersend's canonical form —
 * the SDK's HTTP/MCP adapters translate to and from x402 wire formats at the
 * boundary so treasurer implementations never need to know which x402 version
 * a seller is speaking.
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
