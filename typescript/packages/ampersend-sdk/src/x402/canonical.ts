/**
 * Ampersend's canonical payment types.
 *
 * These are protocol-version-agnostic domain types. The SDK uses them
 * everywhere internal code touches payment concepts — treasurer, wallet, and
 * the public interface surface. Adapters in `src/x402/http/conversions.ts`
 * translate between x402 wire formats (v1 or v2) and these canonical types so
 * the rest of the SDK never needs to know which protocol version is on the
 * wire.
 *
 * The canonical model is owned by ampersend and evolves independently of any
 * x402 version. `PaymentOption` describes one advertised payment alternative;
 * `PaymentAuthorization` is the signed artifact an agent produces to pay.
 */

/**
 * Information about the resource requiring payment.
 *
 * x402 v1 flattens `resource`, `description`, and `mimeType` directly into
 * its PaymentRequirements. x402 v2 extracts them into a separate ResourceInfo.
 * Canonically we keep it as its own type so adapters can populate it from
 * either wire layout without losing information.
 */
export interface ResourceInfo {
  /** URL of the resource being paid for */
  readonly url: string
  /** Human-readable description of the resource */
  readonly description?: string
  /** MIME type of the resource response */
  readonly mimeType?: string
}

/**
 * A single payment option advertised by a seller.
 *
 * A 402 response may carry several options; treasurers and wallets operate on
 * one at a time. From the buyer-agent's perspective these are options to pick
 * from, not requirements — x402 calls them requirements because the protocol
 * is seller-centric, but ampersend is buyer-centric.
 */
export interface PaymentOption {
  /** Payment scheme identifier, e.g. `"exact"` */
  readonly scheme: string
  /** CAIP-2 network identifier, e.g. `"eip155:84532"` */
  readonly network: string
  /** Exact payment amount in atomic token units (stringified integer) */
  readonly amount: string
  /** Token contract address */
  readonly asset: string
  /** Recipient wallet address */
  readonly payTo: string
  /** Authorization validity window in seconds */
  readonly maxTimeoutSeconds: number
  /** Resource being paid for */
  readonly resource: ResourceInfo
  /** Scheme-specific metadata (e.g. EIP-712 domain fields for exact EVM) */
  readonly extra: Readonly<Record<string, unknown>>
}

/**
 * Signed payment authorization produced by a wallet.
 *
 * Carries the scheme-specific signed body (e.g. `{ signature, authorization }`
 * for the exact EVM scheme) without being tied to any x402 wire format
 * version. Adapters wrap this in a v1 or v2 envelope on the way out.
 */
export interface PaymentAuthorization {
  /** Payment scheme identifier, matches the option that was signed */
  readonly scheme: string
  /** CAIP-2 network identifier, matches the option that was signed */
  readonly network: string
  /** Scheme-specific signed body */
  readonly body: Readonly<Record<string, unknown>>
}

/**
 * Canonical settlement result returned by the server after a payment.
 */
export interface SettlementResult {
  readonly success: boolean
  /** Address that paid */
  readonly payer?: string
  /** On-chain transaction hash (empty or omitted on failure) */
  readonly transaction?: string
  /** CAIP-2 network identifier */
  readonly network: string
  /** Machine-readable error code, if settlement failed */
  readonly errorReason?: string
  /** Human-readable error message, if settlement failed */
  readonly errorMessage?: string
}
