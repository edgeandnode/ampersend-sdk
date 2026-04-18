import type { PaymentAuthorization, PaymentRequest } from "./envelopes.ts"

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
 * The treasurer receives the seller's full {@link PaymentRequest} (the 402
 * response), decides whether and how to pay, and returns a signed
 * {@link Authorization} or null to decline. Internally it narrows on
 * `request.protocol` and picks one entry from `request.data.accepts` to build a
 * {@link PaymentInstruction} for its wallet.
 *
 * @example
 * ```typescript
 * class BudgetTreasurer implements X402Treasurer {
 *   constructor(private wallet: X402Wallet, private dailyLimit: number) {}
 *
 *   async onPaymentRequired(request, context) {
 *     const first = request.data.accepts[0]
 *     if (!first || this.wouldExceedBudget(first)) return null
 *     const instruction: PaymentInstruction =
 *       request.protocol === "x402-v1"
 *         ? { protocol: "x402-v1", data: first }
 *         : { protocol: "x402-v2", data: first, resource: request.data.resource }
 *     const payment = await this.wallet.createPayment(instruction)
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
   * @param request - The seller's full payment request (402 response body)
   * @param context - Optional context about the request requiring payment
   * @returns Authorization to proceed with payment, or null to decline
   */
  onPaymentRequired(request: PaymentRequest, context?: PaymentContext): Promise<Authorization | null>

  /**
   * Called with payment status updates throughout the payment lifecycle.
   *
   * @param status - Current payment status
   * @param authorization - The authorization returned from onPaymentRequired
   * @param context - Optional context about the status update
   */
  onStatus(status: PaymentStatus, authorization: Authorization, context?: PaymentContext): Promise<void>
}
