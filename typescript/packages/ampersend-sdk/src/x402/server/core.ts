import type { PaymentPayload, PaymentRequirements, SettleResponse, VerifyResponse } from "@x402/core/types"

import { GENERIC_DENY_REASON } from "./ampersend.ts"
import type { X402ServerExecutor } from "./executor.ts"

/**
 * Normalized outcome of running an executor over a decoded payment. Framework
 * adapters map this to their transport-appropriate response.
 *
 * - `allow` — verify passed and settle succeeded; embed `settlement` in the
 *   response (`X-PAYMENT-RESPONSE` for HTTP, `_meta` for MCP).
 * - `deny` — verify rejected the payment (compliance or facilitator). The
 *   buyer should not be invited to retry the same payment. `reason` is
 *   already generic for compliance denials.
 * - `retryable` — settle failed after a valid verify. The handler may have
 *   run; the buyer can reasonably retry. Adapters surface this as a 402.
 */
export type AmpersendX402Outcome =
  | { type: "allow"; settlement: SettleResponse; verification: VerifyResponse }
  | { type: "deny"; reason: string; verification: VerifyResponse }
  | { type: "retryable"; reason: string; settlement?: SettleResponse }

/**
 * Framework-agnostic core: verify a decoded payment via the executor and, on
 * success, settle it. Returns a normalized {@link AmpersendX402Outcome}.
 *
 * Fail closed: any thrown error from verify is treated as a generic deny
 * (the payment is not honored). The executors themselves already fail closed
 * by returning `isValid: false` rather than throwing, but a defensive catch
 * here guarantees no path leaks an exception into an "allow".
 */
export async function withAmpersendX402Payment(
  executor: X402ServerExecutor,
  payment: PaymentPayload,
  requirements: PaymentRequirements,
): Promise<AmpersendX402Outcome> {
  let verification: VerifyResponse
  try {
    verification = await executor.verifyPayment(payment, requirements)
  } catch {
    // Defensive: a well-behaved executor returns a deny rather than throwing.
    // If one ever throws, fail closed with a generic deny.
    return { type: "deny", reason: GENERIC_DENY_REASON, verification: { isValid: false } }
  }

  if (!verification.isValid) {
    return { type: "deny", reason: verification.invalidReason ?? GENERIC_DENY_REASON, verification }
  }

  let settlement: SettleResponse
  try {
    settlement = await executor.settlePayment(payment, requirements)
  } catch (error) {
    return { type: "retryable", reason: error instanceof Error ? error.message : "Settle failed" }
  }

  if (!settlement.success) {
    return { type: "retryable", reason: settlement.errorReason ?? "Settle failed", settlement }
  }

  return { type: "allow", settlement, verification }
}
