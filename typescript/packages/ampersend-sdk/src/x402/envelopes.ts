/**
 * Ampersend-owned protocol envelopes.
 *
 * Every payment-related value crossing an SDK interface (treasurer, wallet,
 * MCP/A2A/HTTP adapters, Ampersend API wire) is wrapped in a `{ protocol, data }`
 * envelope. `protocol` is ampersend's dispatch tag; `data` is the byte-exact
 * payload from the underlying protocol package. We don't invent inner shapes.
 *
 * The x402 `x402Version` field inside `data` intentionally duplicates the outer
 * `protocol` tag. They serve different dispatch layers (ampersend vs upstream
 * x402) and happen to agree. Don't collapse them.
 *
 * Four stages, four types:
 *
 *   PaymentRequest         — what the seller is asking for (the full 402 body)
 *        ↓ treasurer picks one line-item
 *   PaymentInstruction     — the specific line-item the wallet will sign
 *        ↓ wallet signs
 *   PaymentAuthorization   — signed, ready to submit to the seller
 *        ↓ facilitator settles
 *   SettlementResult       — final outcome
 */

import type {
  PaymentPayloadV2,
  PaymentRequiredV1,
  PaymentRequiredV2,
  PaymentRequirementsV1,
  PaymentRequirementsV2,
  ResourceInfo,
} from "@x402/core/schemas"
import type { SettleResponse as V2SettleResponse } from "@x402/core/types"
import type { PaymentPayload as V1PaymentPayload, SettleResponse as V1SettleResponse } from "x402/types"

export type Protocol = "x402-v1" | "x402-v2"

/**
 * PaymentRequest — the seller's full "402 Payment Required" declaration.
 *
 * Wraps the upstream protocol's top-level response body. The treasurer receives
 * this and decides which (if any) of the `data.accepts` entries to sign against.
 */
export type PaymentRequest =
  | { readonly protocol: "x402-v1"; readonly data: PaymentRequiredV1 }
  | { readonly protocol: "x402-v2"; readonly data: PaymentRequiredV2 }

/**
 * PaymentInstruction — one concrete line-item the wallet will sign and package.
 *
 * For v2, the wallet also needs the offer-level `resource` to build the wire
 * payload (v2's `PaymentPayload` echoes `resource` as metadata). That info lives
 * outside `data` because it is not part of v2's per-option shape — it's a wire
 * concern, not a signing-input concern.
 */
export type PaymentInstruction =
  | { readonly protocol: "x402-v1"; readonly data: PaymentRequirementsV1 }
  | {
      readonly protocol: "x402-v2"
      readonly data: PaymentRequirementsV2
      readonly resource: ResourceInfo
    }

/**
 * PaymentAuthorization — signed payment, ready to submit.
 */
export type PaymentAuthorization =
  | { readonly protocol: "x402-v1"; readonly data: V1PaymentPayload }
  | { readonly protocol: "x402-v2"; readonly data: PaymentPayloadV2 }

/**
 * SettlementResult — facilitator's settlement outcome.
 */
export type SettlementResult =
  | { readonly protocol: "x402-v1"; readonly data: V1SettleResponse }
  | { readonly protocol: "x402-v2"; readonly data: V2SettleResponse }
