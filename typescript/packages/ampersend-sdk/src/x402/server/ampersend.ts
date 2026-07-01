import type { FacilitatorConfig } from "@x402/core/server"
import type { Network, PaymentPayload, PaymentRequirements, SettleResponse, VerifyResponse } from "@x402/core/types"

import { ApiClient } from "../../ampersend/client.ts"
import type { Address } from "../../ampersend/types.ts"
import type { X402ServerExecutor } from "./executor.ts"
import { FacilitatorX402ServerExecutor } from "./facilitator.ts"

/**
 * Hard timeout on the compliance API call, in milliseconds. The executor
 * fails closed if the API hangs — without this every paid verify would hang
 * with it. 5s is comfortable for a local API, an SSH tunnel, and a staging
 * API behind a tunnel; override via `AMPERSEND_COMPLIANCE_API_TIMEOUT_SECONDS`
 * (seconds, matching the Python SDK's env var). Same posture/value as the
 * Python `AmpersendX402ServerExecutor`.
 */
function complianceTimeoutMs(): number {
  const raw = process.env.AMPERSEND_COMPLIANCE_API_TIMEOUT_SECONDS
  const seconds = raw ? Number(raw) : 5.0
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return 5000
  }
  return Math.round(seconds * 1000)
}

/**
 * Generic deny surfaced to the buyer. The full detail (reason, reasonCode,
 * screeningId, payer) is logged server-side so the operator has the audit
 * trail without leaking it to the buyer — telling a sanctioned wallet which
 * category flagged it lets them wallet-shop or feel out the thresholds.
 */
export const GENERIC_DENY_REASON = "Payment rejected"

/**
 * Minimal logger surface. Defaults to `console` so a seller gets the
 * server-side WARNING audit trail out of the box; inject a structured logger
 * to route it elsewhere.
 */
export interface ComplianceLogger {
  warn(message: string, detail?: Record<string, unknown>): void
}

const defaultLogger: ComplianceLogger = {
  warn(message, detail) {
    if (detail) {
      console.warn(message, detail)
    } else {
      console.warn(message)
    }
  },
}

export interface AmpersendX402ServerExecutorOptions {
  /** Ampersend API base URL (e.g. `https://api.ampersend.ai`). */
  apiBaseUrl: string
  /** Seller agent smart-account address (the receiver). */
  sellerAgentAddress: Address
  /**
   * Seller agent signer — the session-key private key used to sign the SIWE
   * login under the seller agent's identity.
   */
  sellerSessionKeyPrivateKey: `0x${string}`
  /** Facilitator config (e.g. `{ url }`) for the verify/settle delegation. */
  facilitator?: FacilitatorConfig
  /** Network the default resource server registers the `exact` scheme for. */
  network: Network
  /**
   * Pre-built API client. Provide this to share auth with the buyer side (an
   * agent that both buys and sells reuses one client / one SIWE flow). When
   * omitted, one is constructed from `apiBaseUrl` + seller credentials.
   */
  apiClient?: ApiClient
  /**
   * Pre-built facilitator-backed executor. When omitted, a
   * `FacilitatorX402ServerExecutor` is built from `facilitator` + `network`.
   */
  facilitatorExecutor?: X402ServerExecutor
  /** Logger for the server-side compliance-deny audit trail. Defaults to `console`. */
  logger?: ComplianceLogger
}

/** Extracted EIP-3009 fields the compliance call needs from an exact payment. */
interface ExactAuthorizationFields {
  payerAddress: string
  nonce: string
  paymentSignature: string
}

/**
 * Read the payment scheme from a payload, tolerating both the v1 wire shape
 * (top-level `scheme`) and the canonical v2 shape (`accepted.scheme`).
 */
export function schemeOfPayload(payload: PaymentPayload): string | undefined {
  const v1 = (payload as { scheme?: unknown }).scheme
  if (typeof v1 === "string") {
    return v1
  }
  const accepted = (payload as { accepted?: { scheme?: unknown } }).accepted
  return typeof accepted?.scheme === "string" ? accepted.scheme : undefined
}

/**
 * Pull `from` / `nonce` / `signature` out of an `exact`-scheme payload.
 * Returns `null` for any non-exact scheme or a malformed payload — the
 * compliance call needs the EIP-3009 authorization block, which only the
 * `exact` scheme carries today. A future scheme would need its own
 * extraction logic.
 */
function extractExactAuthorization(payload: PaymentPayload): ExactAuthorizationFields | null {
  if (schemeOfPayload(payload) !== "exact") {
    return null
  }
  const inner = payload.payload as
    | { signature?: unknown; authorization?: { from?: unknown; nonce?: unknown } }
    | undefined
  const from = inner?.authorization?.from
  const nonce = inner?.authorization?.nonce
  const signature = inner?.signature
  if (typeof from !== "string" || typeof nonce !== "string" || typeof signature !== "string") {
    return null
  }
  return { payerAddress: from, nonce, paymentSignature: signature }
}

/**
 * Compliance-gated x402 server executor (TypeScript).
 *
 * Composes a `FacilitatorX402ServerExecutor`. On `verifyPayment` it first
 * calls Ampersend's `POST /api/v1/agents/:address/payment/authorize-receipt`
 * over a SIWE-authenticated bearer token; if compliance allows it delegates
 * to the facilitator's verify so on-chain settlement still happens, and if
 * compliance denies it returns a `VerifyResponse` with `isValid: false` and a
 * deliberately generic `invalidReason`. Settlement is unchanged — by the time
 * we settle the gate has already approved (today's `exact` scheme settles in
 * the same x402 round-trip, so the approval is fresh).
 *
 * ## Fail closed
 *
 * This TS v1 surface fails closed on BOTH the deny path AND on any
 * transport / timeout / HTTP error talking to Ampersend: the buyer gets a
 * generic deny and the payment is NOT honored. This deliberately DIVERGES
 * from the Python A2A `AmpersendX402ServerExecutor`, which lets outages
 * propagate as a 500. The TS v1 has no A2A surface — its consumers are HTTP
 * and MCP sellers, where a 500 invites blind retry under outage and masks
 * the buyer's choice of address. The Python FastAPI/HTTP middleware already
 * makes the same fail-closed-on-outage choice for the same reason; this
 * matches it. The full detail is logged at WARNING server-side regardless.
 */
export class AmpersendX402ServerExecutor implements X402ServerExecutor {
  private readonly apiClient: ApiClient
  private readonly facilitatorExecutor: X402ServerExecutor
  private readonly logger: ComplianceLogger

  constructor(options: AmpersendX402ServerExecutorOptions) {
    this.apiClient =
      options.apiClient ??
      new ApiClient({
        baseUrl: options.apiBaseUrl,
        agentAddress: options.sellerAgentAddress,
        sessionKeyPrivateKey: options.sellerSessionKeyPrivateKey,
      })
    this.facilitatorExecutor =
      options.facilitatorExecutor ??
      new FacilitatorX402ServerExecutor({
        ...(options.facilitator ? { facilitator: options.facilitator } : {}),
        network: options.network,
      })
    this.logger = options.logger ?? defaultLogger
  }

  async verifyPayment(payload: PaymentPayload, requirements: PaymentRequirements): Promise<VerifyResponse> {
    const fields = extractExactAuthorization(payload)
    if (!fields) {
      // Non-exact scheme (or malformed exact payload). We can't run the
      // compliance call without the EIP-3009 authorization block, so deny.
      return { isValid: false, invalidReason: "Unsupported payment scheme" }
    }

    let denyDetail: { reason: string; reasonCode: string; screeningId: string | null } | null = null
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), complianceTimeoutMs())
      let result
      try {
        result = await this.apiClient.authorizeReceipt(
          {
            payerAddress: fields.payerAddress,
            paymentRequirements: requirements,
            nonce: fields.nonce,
            paymentSignature: fields.paymentSignature,
          },
          { signal: controller.signal },
        )
      } finally {
        clearTimeout(timer)
      }

      if (result.authorized) {
        // Compliance allowed — delegate to the facilitator for the standard
        // x402 signature / amount / nonce checks.
        return this.facilitatorExecutor.verifyPayment(payload, requirements)
      }

      denyDetail = { reason: result.reason, reasonCode: result.reasonCode, screeningId: result.screeningId }
    } catch (error) {
      // Fail closed on any transport / timeout / HTTP / ApiError. The buyer
      // sees the same generic deny as a real compliance rejection; the
      // operator gets the outage signal via the WARNING log below.
      this.logger.warn("Compliance API call failed (transport/timeout/api-error)", {
        payerAddress: fields.payerAddress,
        error: error instanceof Error ? error.message : String(error),
      })
      return { isValid: false, invalidReason: GENERIC_DENY_REASON, payer: fields.payerAddress }
    }

    // Operator-side audit trail — the buyer gets the generic deny string;
    // the full detail (incl. screeningId for support-ticket correlation)
    // stays server-side. WARNING (not info) because compliance denies are
    // unusual events worth surfacing in default log filters and alerting.
    this.logger.warn("Compliance denied payment", {
      payerAddress: fields.payerAddress,
      reasonCode: denyDetail.reasonCode,
      reason: denyDetail.reason,
      screeningId: denyDetail.screeningId,
    })
    return { isValid: false, invalidReason: GENERIC_DENY_REASON, payer: fields.payerAddress }
  }

  settlePayment(payload: PaymentPayload, requirements: PaymentRequirements): Promise<SettleResponse> {
    return this.facilitatorExecutor.settlePayment(payload, requirements)
  }
}
