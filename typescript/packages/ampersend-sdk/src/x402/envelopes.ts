/**
 * Ampersend protocol envelopes: `{ protocol, data }` wrappers where `data` is
 * the byte-exact upstream payload (no re-serialization).
 *
 *   PaymentRequest        (seller's 402)
 *        ↓ treasurer picks accepts[i]
 *   PaymentInstruction    (request + index; wallet input)
 *        ↓ wallet signs
 *   PaymentAuthorization  (signed, ready to submit)
 *        ↓ facilitator settles
 *   SettlementResult
 *
 * `PaymentInstruction` keeps the full request by reference so v2's
 * `deepEqual(accepts[i], …)` check (spec §5.1.3) can't drift.
 */

import type {
  PaymentPayloadV1,
  PaymentPayloadV2,
  PaymentRequiredV1,
  PaymentRequiredV2,
  PaymentRequirementsV1,
  PaymentRequirementsV2,
} from "@x402/core/schemas"
import type { SettleResponse } from "@x402/core/types"

export type Protocol = "x402-v1" | "x402-v2"

/** The seller's full 402 body. Treasurers pick one `data.accepts[i]` (or none). */
export type PaymentRequest =
  | { readonly protocol: "x402-v1"; readonly data: PaymentRequiredV1 }
  | { readonly protocol: "x402-v2"; readonly data: PaymentRequiredV2 }

/** Request + `acceptsIndex`. Full request rides along so v2 echo is byte-exact. */
export type PaymentInstruction =
  | {
      readonly protocol: "x402-v1"
      readonly request: PaymentRequiredV1
      readonly acceptsIndex: number
    }
  | {
      readonly protocol: "x402-v2"
      readonly request: PaymentRequiredV2
      readonly acceptsIndex: number
    }

export type PaymentAuthorization =
  | { readonly protocol: "x402-v1"; readonly data: PaymentPayloadV1 }
  | { readonly protocol: "x402-v2"; readonly data: PaymentPayloadV2 }

/** Upstream ships one `SettleResponse` for both versions. */
export type SettlementResult =
  | { readonly protocol: "x402-v1"; readonly data: SettleResponse }
  | { readonly protocol: "x402-v2"; readonly data: SettleResponse }

export function acceptedOf(instruction: PaymentInstruction): PaymentRequirementsV1 | PaymentRequirementsV2 {
  const accepted = instruction.request.accepts[instruction.acceptsIndex]
  if (!accepted) {
    throw new Error(
      `PaymentInstruction.acceptsIndex ${instruction.acceptsIndex} out of bounds (accepts.length=${instruction.request.accepts.length})`,
    )
  }
  return accepted
}

/** Payment amount in atomic units (stringified bigint). */
export function amountOf(instruction: PaymentInstruction): string {
  return instruction.protocol === "x402-v1"
    ? instruction.request.accepts[instruction.acceptsIndex]!.maxAmountRequired
    : instruction.request.accepts[instruction.acceptsIndex]!.amount
}

export function resourceUrlOf(instruction: PaymentInstruction): string {
  return instruction.protocol === "x402-v1"
    ? instruction.request.accepts[instruction.acceptsIndex]!.resource
    : instruction.request.resource.url
}

/** Wrap a request at `acceptsIndex: 0`. Upstream `accepts.min(1)` guarantees non-empty. */
export function firstInstructionOf(request: PaymentRequest): PaymentInstruction {
  return request.protocol === "x402-v1"
    ? { protocol: "x402-v1", request: request.data, acceptsIndex: 0 }
    : { protocol: "x402-v2", request: request.data, acceptsIndex: 0 }
}

/** Scheme-specific signed body. exact-EVM: `{ signature, authorization }`. */
export type SchemeSpecificPayload = Record<string, unknown>

/** Wrap a signed payload into a `PaymentAuthorization`. v2 echoes `resource`, `accepted`, `extensions` verbatim. */
export function buildAuthorization(
  instruction: PaymentInstruction,
  signedPayload: SchemeSpecificPayload,
): PaymentAuthorization {
  if (instruction.protocol === "x402-v1") {
    const accepted = instruction.request.accepts[instruction.acceptsIndex]
    if (!accepted) {
      throw new Error(`PaymentInstruction.acceptsIndex ${instruction.acceptsIndex} out of bounds`)
    }
    return {
      protocol: "x402-v1",
      data: {
        x402Version: 1,
        scheme: accepted.scheme,
        network: accepted.network,
        payload: signedPayload,
      },
    }
  }
  const accepted = instruction.request.accepts[instruction.acceptsIndex]
  if (!accepted) {
    throw new Error(`PaymentInstruction.acceptsIndex ${instruction.acceptsIndex} out of bounds`)
  }
  return {
    protocol: "x402-v2",
    data: {
      x402Version: 2,
      resource: instruction.request.resource,
      accepted,
      payload: signedPayload,
      ...(instruction.request.extensions !== undefined &&
        instruction.request.extensions !== null && { extensions: instruction.request.extensions }),
    },
  }
}
