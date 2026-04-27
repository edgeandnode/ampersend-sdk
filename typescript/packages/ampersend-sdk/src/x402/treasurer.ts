import type { PaymentRequirementsV1, PaymentRequirementsV2 } from "@x402/core/schemas"

import type { PaymentAuthorization, PaymentRequest } from "./envelopes.ts"

/**
 * Loose caller context — which protocol triggered the flow and any debugging
 * metadata. NOT payment details; those live on the {@link PaymentRequest}.
 */
export interface PaymentContext {
  method: string
  params?: any
  metadata?: Record<string, unknown>
}

export interface Authorization {
  payment: PaymentAuthorization
  authorizationId: string
  /**
   * The `accepts[i]` the wallet signed against. Must be `===` to an element
   * of the original `PaymentRequest.data.accepts` — reference equality is
   * load-bearing for downstream integrations (e.g. the `x402Client` subclass).
   */
  accepted: PaymentRequirementsV1 | PaymentRequirementsV2
}

export type PaymentStatus =
  | "sending" // submitted to seller
  | "accepted" // verified and accepted
  | "rejected" // rejected by seller
  | "declined" // declined by buyer
  | "error"

/**
 * Separates payment *decisions* from payment *creation*. Receives the seller's
 * full 402 body, returns a signed {@link Authorization} or `null` to decline.
 * Internally picks an index into `request.data.accepts[]` and hands the
 * resulting `PaymentInstruction` to a wallet; use {@link firstInstructionOf}
 * for the trivial "take the first option" case.
 *
 * Return `null` only for domain-level declines (budget exhausted, user
 * rejected, policy said no). Infrastructure failures — network errors, auth
 * failures, wallet signing errors — must **throw**, so callers can distinguish
 * "you can't have this payment" from "something is broken."
 */
export interface X402Treasurer {
  onPaymentRequired(request: PaymentRequest, context?: PaymentContext): Promise<Authorization | null>
  onStatus(status: PaymentStatus, authorization: Authorization, context?: PaymentContext): Promise<void>
}
