import type { PaymentAuthorization, PaymentInstruction } from "./envelopes.ts"
import type { ServerAuthorizationData } from "./types.ts"

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
 * Signs a {@link PaymentInstruction} into a {@link PaymentAuthorization}.
 *
 * Implementations read fields via {@link acceptedOf} / {@link amountOf} and
 * return via {@link buildAuthorization}, which handles the v1/v2 envelope
 * packaging (including v2's `resource`/`accepted`/`extensions` echo).
 */
export interface X402Wallet {
  /** @throws {WalletError} for unsupported schemes, insufficient funds, etc. */
  createPayment(
    instruction: PaymentInstruction,
    serverAuthorization?: ServerAuthorizationData,
  ): Promise<PaymentAuthorization>
}
