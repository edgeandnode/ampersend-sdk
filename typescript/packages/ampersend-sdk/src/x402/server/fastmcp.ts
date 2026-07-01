import type { PaymentPayload, PaymentRequirements, SettleResponse } from "@x402/core/types"

import { withX402Payment, type OnExecute, type OnPayment } from "../../mcp/server/fastmcp/middleware.ts"
import { withAmpersendX402Payment } from "./core.ts"
import type { X402ServerExecutor } from "./executor.ts"

/**
 * Build a FastMCP `onPayment` callback backed by an {@link X402ServerExecutor}.
 *
 * Runs the executor's verify (compliance gate + facilitator) and, on success,
 * settle. On a deny it throws — the existing `withX402Payment` middleware
 * turns that into the 402 payment-rejected error path, so a denied payment is
 * never silently allowed. On success it returns the `SettleResponse` to embed
 * in the tool result `_meta`.
 *
 * The thrown reason for a compliance deny is already generic ("Payment
 * rejected"); the full detail is logged server-side by the executor.
 */
export function createExecutorOnPayment(executor: X402ServerExecutor): OnPayment {
  return async ({ payment, requirements }): Promise<SettleResponse | void> => {
    // The FastMCP middleware decodes v1 wire payloads; the executor / facilitator
    // accept the canonical `PaymentPayload`. The shapes are runtime-compatible
    // (scheme/network are read defensively from either), so cast across.
    const outcome = await withAmpersendX402Payment(
      executor,
      payment as unknown as PaymentPayload,
      requirements as unknown as PaymentRequirements,
    )
    if (outcome.type === "allow") {
      return outcome.settlement
    }
    // Deny or settle-failure: throw so the middleware emits the 402
    // payment-required/rejected error. Fail closed — no silent allow.
    //
    // This deliberately diverges from the Express adapter, which returns 403 on
    // a compliance deny to short-circuit the buyer's retry loop. The FastMCP
    // path routes deny through the pre-existing `withX402Payment` middleware,
    // which only speaks 402 (retry-invited). Still fail-closed and leak-free —
    // for a compliance rejection `outcome.reason` is the generic deny and each
    // retry re-screens — just a weaker retry-discouragement than the HTTP surface.
    throw new Error(outcome.reason)
  }
}

export interface WithAmpersendX402PaymentMcpOptions {
  executor: X402ServerExecutor
  onExecute: OnExecute
}

/**
 * FastMCP middleware wrapper that gates a tool's `execute` through an
 * {@link X402ServerExecutor}. Thin wrapper over the SDK's existing
 * `withX402Payment` with its `onPayment` backed by the executor.
 */
export function withAmpersendX402PaymentMcp<TArgs = unknown, TResult = unknown>(
  options: WithAmpersendX402PaymentMcpOptions,
): ReturnType<typeof withX402Payment<TArgs, TResult>> {
  return withX402Payment<TArgs, TResult>({
    onExecute: options.onExecute,
    onPayment: createExecutorOnPayment(options.executor),
  })
}
