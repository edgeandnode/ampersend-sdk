import type { PaymentPayload, PaymentRequirements, SettleResponse, VerifyResponse } from "@x402/core/types"

/**
 * Seller-side x402 server executor.
 *
 * Mirrors the Python SDK's `X402ServerExecutor` so the two SDKs stay
 * conceptually aligned. An executor verifies an incoming payment (deciding
 * whether the seller should honor it) and settles it on-chain.
 *
 * `verifyPayment` returns a `VerifyResponse` with `isValid: false` (and an
 * `invalidReason`) on rejection rather than throwing — adapters translate
 * that into the framework-appropriate response.
 */
export interface X402ServerExecutor {
  verifyPayment(payload: PaymentPayload, requirements: PaymentRequirements): Promise<VerifyResponse>
  settlePayment(payload: PaymentPayload, requirements: PaymentRequirements): Promise<SettleResponse>
}
