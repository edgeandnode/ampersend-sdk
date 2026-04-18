import type { PaymentAuthorization, PaymentInstruction } from "./envelopes.ts"
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
 * X402Wallet interface - signs a {@link PaymentInstruction} into a
 * {@link PaymentAuthorization}.
 *
 * Wallets narrow on `instruction.protocol` for protocol-specific fields and
 * emit an authorization tagged with the same protocol.
 *
 * @example
 * ```typescript
 * class MyWallet implements X402Wallet {
 *   async createPayment(instruction: PaymentInstruction): Promise<PaymentAuthorization> {
 *     if (instruction.data.scheme !== "exact") {
 *       throw new WalletError(`Unsupported scheme: ${instruction.data.scheme}`)
 *     }
 *     // Sign, then return an envelope matching `instruction.protocol`
 *     return { protocol: instruction.protocol, data: signedPayload } as PaymentAuthorization
 *   }
 * }
 * ```
 */
export interface X402Wallet {
  /**
   * Sign a payment instruction into a payment authorization.
   *
   * @param instruction - One concrete line-item to sign and package
   * @param serverAuthorization - Optional server co-signature data (for co-signed smart account keys)
   * @returns Signed payment, tagged with the same protocol as the instruction
   * @throws {WalletError} If unable to create payment (unsupported scheme, insufficient funds, etc.)
   */
  createPayment(
    instruction: PaymentInstruction,
    serverAuthorization?: ServerAuthorizationData,
  ): Promise<PaymentAuthorization>
}
