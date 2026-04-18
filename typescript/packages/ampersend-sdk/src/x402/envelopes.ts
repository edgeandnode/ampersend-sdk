/**
 * Ampersend-owned protocol envelopes.
 *
 * Every payment-related value that crosses an SDK interface — treasurer,
 * wallet, MCP callbacks, HTTP adapter, and the wire to the ampersend API —
 * is wrapped in one of these envelopes. The envelope has two fields:
 *
 *   - `protocol`: ampersend's dispatch tag. Grows as we add protocols
 *     (x402-v3, mpp-v1, etc). Distinct from any protocol's internal version.
 *   - `data`: byte-exact payload produced by the seller (or, for
 *     authorizations, by our wallet). Types for `data` come from upstream
 *     protocol packages; we don't invent inner shapes.
 *
 * For x402 specifically, the outer `protocol` tag intentionally duplicates
 * `data.x402Version`. They serve different dispatch layers (ampersend vs
 * x402) and happen to agree; don't collapse them.
 */

import type { PaymentPayloadV2, PaymentRequirementsV2, ResourceInfo } from "@x402/core/schemas"
import type { SettleResponse as V2SettleResponse } from "@x402/core/types"
import type {
  PaymentPayload as V1PaymentPayload,
  PaymentRequirements as V1PaymentRequirements,
  SettleResponse as V1SettleResponse,
} from "x402/types"

export type Protocol = "x402-v1" | "x402-v2"

/**
 * A payment option advertised by a seller.
 *
 * v2 carries `resource` on the envelope because v2 puts resource info outside
 * the per-option `accepts[]` entry (on the outer `PaymentRequired` response).
 * v1 has `resource` flat inside `data`, so v1 envelopes don't need the extra
 * field. The asymmetry reflects the underlying protocol shapes.
 */
export type PaymentOption =
  | { readonly protocol: "x402-v1"; readonly data: V1PaymentRequirements }
  | {
      readonly protocol: "x402-v2"
      readonly data: PaymentRequirementsV2
      readonly resource: ResourceInfo
    }

/**
 * A signed payment authorization produced by a wallet, ready to submit to
 * the seller.
 */
export type PaymentAuthorization =
  | { readonly protocol: "x402-v1"; readonly data: V1PaymentPayload }
  | { readonly protocol: "x402-v2"; readonly data: PaymentPayloadV2 }

/**
 * Settlement result returned by a facilitator after a payment.
 */
export type SettlementResult =
  | { readonly protocol: "x402-v1"; readonly data: V1SettleResponse }
  | { readonly protocol: "x402-v2"; readonly data: V2SettleResponse }
