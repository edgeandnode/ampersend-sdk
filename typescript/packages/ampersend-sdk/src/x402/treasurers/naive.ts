import type { PaymentOption } from "../../ampersend/types.ts"
import type { Authorization, PaymentContext, PaymentStatus, X402Treasurer } from "../treasurer.ts"
import type { X402Wallet } from "../wallet.ts"
import { createWalletFromConfig, type WalletConfig } from "../wallets/index.ts"

/**
 * NaiveTreasurer - Auto-approves all payment requests
 *
 * This treasurer automatically approves all payment requests without
 * any budget checks or user confirmation. Useful for:
 * - Testing and development
 * - Trusted sellers where all requests should be paid
 * - Simple use cases without budget limits
 *
 * @example
 * ```typescript
 * const wallet = new AccountWallet(account)
 * const treasurer = new NaiveTreasurer(wallet)
 *
 * // Auto-approves all payments
 * const client = new X402Client({ treasurer })
 * ```
 */
export class NaiveTreasurer implements X402Treasurer {
  constructor(private wallet: X402Wallet) {}

  /**
   * Always approves payment by creating a payment with the wallet.
   * Uses the first option from the array.
   */
  async onPaymentRequired(
    options: ReadonlyArray<PaymentOption>,
    _context?: PaymentContext,
  ): Promise<Authorization | null> {
    if (options.length === 0) {
      return null
    }

    const payment = await this.wallet.createPayment(options[0])

    return {
      payment,
      authorizationId: crypto.randomUUID(),
    }
  }

  /**
   * Logs payment status to console for debugging.
   */
  async onStatus(status: PaymentStatus, authorization: Authorization, _context?: PaymentContext): Promise<void> {
    console.log(`[NaiveTreasurer] Payment ${authorization.authorizationId}: ${status}`)
  }
}

/**
 * Creates a naive treasurer that automatically approves all payment requests.
 * This treasurer selects the first payment requirement and creates a payment immediately.
 *
 * @param walletConfig - Configuration for the wallet to use
 * @returns An X402Treasurer implementation
 *
 * @example
 * ```typescript
 * const treasurer = createNaiveTreasurer({
 *   type: 'eoa',
 *   privateKey: '0x...'
 * })
 * ```
 */
export function createNaiveTreasurer(walletConfig: WalletConfig): X402Treasurer {
  const wallet = createWalletFromConfig(walletConfig)
  return new NaiveTreasurer(wallet)
}
