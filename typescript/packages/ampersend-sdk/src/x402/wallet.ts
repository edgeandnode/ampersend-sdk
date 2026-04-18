import type { PaymentAuthorization, PaymentOption } from "./envelopes.ts"
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
 * X402Wallet interface - signs payment options into payment authorizations.
 *
 * Input and output are ampersend protocol envelopes. The wallet narrows on
 * `option.protocol` to read protocol-specific fields and emits an
 * authorization tagged with the same protocol.
 *
 * @example
 * ```typescript
 * class MyWallet implements X402Wallet {
 *   async createPayment(option: PaymentOption): Promise<PaymentAuthorization> {
 *     if (option.data.scheme !== "exact") {
 *       throw new WalletError(`Unsupported scheme: ${option.data.scheme}`)
 *     }
 *     // Sign, then return an envelope matching `option.protocol`
 *     return { protocol: option.protocol, data: signedPayload } as PaymentAuthorization
 *   }
 * }
 * ```
 */
export interface X402Wallet {
  /**
   * Sign a payment option into a payment authorization.
   *
   * @param option - Ampersend envelope wrapping a seller-provided x402 option
   * @param serverAuthorization - Optional server co-signature data (for co-signed smart account keys)
   * @returns Ampersend envelope wrapping the signed payment, tagged with the same protocol
   * @throws {WalletError} If unable to create payment (unsupported scheme, insufficient funds, etc.)
   */
  createPayment(option: PaymentOption, serverAuthorization?: ServerAuthorizationData): Promise<PaymentAuthorization>
}
