import { decodePaymentSignatureHeader, encodePaymentResponseHeader } from "@x402/core/http"
import type { PaymentRequirements } from "@x402/core/types"
import type { NextFunction, Request, RequestHandler, Response } from "express"

import { schemeOfPayload } from "./ampersend.ts"
import { withAmpersendX402Payment } from "./core.ts"
import type { X402ServerExecutor } from "./executor.ts"

/**
 * The requirements shape the seller advertises. A **v1-wire superset**: it
 * carries the v1-wire fields (`maxAmountRequired`, `resource`, `description`,
 * `mimeType`) on top of the `@x402/core` v2 {@link PaymentRequirements}
 * (which keeps `amount`). v1 clients — including the `ampersend` CLI buyer —
 * and the Effect/Zod `authorize-receipt` contract require the v1-wire fields
 * and ignore unknown keys; the `@x402/core` facilitator reads `amount`. So a
 * single superset object is wire-compatible with all three.
 *
 * The intersection stays assignable to `PaymentRequirements`, so this type
 * flows unchanged into the executor / facilitator verify+settle path.
 *
 * `resource` is optional here because the middleware fills it per-request
 * from the incoming request URL (mirroring upstream `@x402/express`).
 */
export type AmpersendPaymentRequirements = PaymentRequirements & {
  maxAmountRequired: string
  resource?: string
  description?: string
  mimeType?: string
}

/**
 * Per-route payment config. Mirrors the upstream `@x402/express`
 * route-keyed config shape (`"GET /api/joke": { accepts, ... }`) but the
 * verification/settlement run through an {@link X402ServerExecutor} instead
 * of the upstream facilitator-only verifier, so compliance gating applies.
 *
 * `accepts` are full v1-wire superset requirements (the requirements the
 * seller advertises in its 402). Keeping them explicit avoids re-deriving
 * price -> atomic amount here; sellers that want price strings can build the
 * requirements with the SDK's existing helpers.
 */
export interface AmpersendRoutePaymentConfig {
  accepts: Array<AmpersendPaymentRequirements>
}

export type AmpersendRoutesConfig = Record<string, AmpersendRoutePaymentConfig>

export interface AmpersendExpressPaymentOptions {
  executor: X402ServerExecutor
  routes: AmpersendRoutesConfig
}

interface CompiledRoute {
  method: string
  path: string
  config: AmpersendRoutePaymentConfig
}

/** Parse a `"GET /api/joke"` route key into its method + path parts. */
function compileRoutes(routes: AmpersendRoutesConfig): Array<CompiledRoute> {
  return Object.entries(routes).map(([key, config]) => {
    const trimmed = key.trim()
    const spaceIdx = trimmed.indexOf(" ")
    if (spaceIdx === -1) {
      // No method prefix — match the path on any method.
      return { method: "*", path: trimmed, config }
    }
    return {
      method: trimmed.slice(0, spaceIdx).toUpperCase(),
      path: trimmed.slice(spaceIdx + 1).trim(),
      config,
    }
  })
}

function matchRoute(routes: Array<CompiledRoute>, method: string, path: string): CompiledRoute | undefined {
  return routes.find((r) => (r.method === "*" || r.method === method.toUpperCase()) && r.path === path)
}

function send402(res: Response, accepts: Array<AmpersendPaymentRequirements>, error: string): void {
  // 402 with the full requirements body — the buyer can fix this by paying
  // (or paying differently). Mirrors the upstream x402 unpaid response.
  res.status(402).json({ x402Version: 1, accepts, error })
}

function sendGenericDeny(res: Response): void {
  // 403 with a deliberately generic body. Compliance denies (and any
  // executor/Ampersend failure under the fail-closed posture) must NOT leak
  // the reason / category / screening id to the buyer. x402 clients only
  // retry on 402, so a 403 short-circuits the buyer's payment loop without
  // any extra signaling.
  res.status(403).json({ error: "Payment rejected" })
}

/**
 * Express middleware that compliance-gates incoming x402 payments through an
 * {@link X402ServerExecutor} before honoring them.
 *
 * Flow per protected route:
 *   1. No `X-PAYMENT` header -> 402 with the advertised requirements.
 *   2. Undecodable header / no matching requirement -> 402.
 *   3. Run the executor (compliance gate + facilitator verify, then settle).
 *      - deny (compliance or any executor/Ampersend failure) -> 403 generic.
 *      - settle failure -> 402.
 *      - allow -> set `X-PAYMENT-RESPONSE` and call the route handler.
 *
 * Fail closed: the executor already returns a deny rather than throwing on a
 * compliance-API outage, and `withAmpersendX402Payment` defensively catches
 * any stray throw — so an outage surfaces as a generic 403, never an allow.
 */
export function ampersendPaymentMiddleware(options: AmpersendExpressPaymentOptions): RequestHandler {
  const compiled = compileRoutes(options.routes)

  return (req: Request, res: Response, next: NextFunction): void => {
    void (async () => {
      const route = matchRoute(compiled, req.method, req.path)
      if (!route) {
        next()
        return
      }

      // Fill `resource` per-request from the requested URL (mirrors upstream
      // @x402/express, where resource = the resource URL being paid for). This
      // completes the v1-wire object sent both in the 402 body and — on the
      // allow path — to authorize-receipt and the facilitator.
      const resourceUrl = `${req.protocol}://${req.get("host")}${req.originalUrl.split("?")[0]}`
      const accepts: Array<AmpersendPaymentRequirements> = route.config.accepts.map((r) =>
        r.resource === undefined ? { ...r, resource: resourceUrl } : r,
      )

      const paymentHeader = req.header("X-PAYMENT")
      if (!paymentHeader) {
        send402(res, accepts, "No X-PAYMENT header provided")
        return
      }

      let payment
      try {
        payment = decodePaymentSignatureHeader(paymentHeader)
      } catch {
        send402(res, accepts, "Invalid payment header format")
        return
      }

      const paymentScheme = schemeOfPayload(payment)
      const paymentNetwork =
        (payment as { network?: string }).network ?? (payment as { accepted?: { network?: string } }).accepted?.network
      const requirements = accepts.find((r) => r.scheme === paymentScheme && r.network === paymentNetwork)
      if (!requirements) {
        send402(res, accepts, "No matching payment requirements found")
        return
      }

      const outcome = await withAmpersendX402Payment(options.executor, payment, requirements)

      if (outcome.type === "deny") {
        sendGenericDeny(res)
        return
      }
      if (outcome.type === "retryable") {
        send402(res, accepts, outcome.reason)
        return
      }

      // Allowed + settled. Surface the settlement to the buyer and run the
      // handler. The settle already happened, so we attach the response
      // header up front; the route handler produces the body.
      res.setHeader("X-PAYMENT-RESPONSE", encodePaymentResponseHeader(outcome.settlement))
      next()
    })().catch((error: unknown) => {
      // Any unexpected error in the gate fails closed to a generic deny
      // rather than leaking a stack / 500.
      void error
      if (!res.headersSent) {
        sendGenericDeny(res)
      }
    })
  }
}
