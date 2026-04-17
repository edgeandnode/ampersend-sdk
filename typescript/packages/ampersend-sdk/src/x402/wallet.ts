import type { PaymentAuthorization, PaymentOption } from "./canonical.ts"
import type { ServerAuthorizationData } from "./types.ts"

/**
 * Error thrown when wallet cannot create a payment
 */
export class WalletError extends Error {
  constructor(
    message: string,
    public cause?: Error,
  ) {
    super(message)
    this.name = "WalletError"
  }
}

/**
 * X402Wallet interface - creates signed payment authorizations from payment options.
 *
 * An X402Wallet is responsible for producing cryptographically signed payment
 * authorizations that can be submitted to sellers. Different wallet
 * implementations support different account types (EOA, smart accounts, etc.).
 *
 * Both the input option and the output authorization are in ampersend's
 * canonical form. Adapters at the HTTP/MCP boundary translate to x402 wire
 * format before the payment hits the network.
 *
 * @example
 * ```typescript
 * class MyWallet implements X402Wallet {
 *   async createPayment(option: PaymentOption): Promise<PaymentAuthorization> {
 *     if (option.scheme !== "exact") {
 *       throw new WalletError(`Unsupported scheme: ${option.scheme}`)
 *     }
 *     // Sign and return { scheme, network, body }
 *     return signedAuthorization
 *   }
 * }
 * ```
 */
export interface X402Wallet {
  /**
   * Creates a signed payment authorization from a canonical payment option.
   *
   * @param option - Canonical payment option
   * @param serverAuthorization - Optional server co-signature data (for co-signed smart account keys)
   * @returns Signed canonical payment authorization ready for adapter wrapping
   * @throws {WalletError} If unable to create payment (unsupported scheme, insufficient funds, etc.)
   */
  createPayment(option: PaymentOption, serverAuthorization?: ServerAuthorizationData): Promise<PaymentAuthorization>
}
