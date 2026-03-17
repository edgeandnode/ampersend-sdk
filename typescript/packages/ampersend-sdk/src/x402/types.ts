/**
 * Shared types for the x402 payment layer.
 *
 * These are plain interfaces used by the x402 wallet abstraction.
 * The ampersend-specific layer (ampersend/types.ts) defines Effect Schema
 * classes that are structurally compatible with these interfaces.
 */

/**
 * ERC-3009 TransferWithAuthorization data fields.
 * Used by wallets to construct EIP-712 typed data for signing.
 */
export interface ERC3009AuthorizationData {
  /** Sender address (agent smart account) */
  from: string
  /** Recipient address (seller) */
  to: string
  /** Transfer amount in wei (stringified bigint) */
  value: string
  /** Unix timestamp after which the authorization is valid (stringified bigint) */
  validAfter: string
  /** Unix timestamp before which the authorization expires (stringified bigint) */
  validBefore: string
  /** Random 32-byte nonce as hex string for replay protection */
  nonce: string
}

/**
 * Server co-signature data for co-signed agent keys.
 * Provided by the Ampersend API when authorizing payments for co-signed keys.
 */
export interface ServerAuthorizationData {
  /** ERC-3009 TransferWithAuthorization data */
  authorizationData: ERC3009AuthorizationData
  /** Server's ECDSA signature (65 bytes as hex string) */
  serverSignature: string
}
