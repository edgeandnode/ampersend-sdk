import { acceptedOf, firstInstructionOf, type PaymentRequest } from "../envelopes.ts"
import type { Authorization, PaymentContext, PaymentStatus, X402Treasurer } from "../treasurer.ts"
import type { X402Wallet } from "../wallet.ts"
import { createWalletFromConfig, type WalletConfig } from "../wallets/index.ts"

/**
 * Auto-approves any request by signing its first `accepts[]` entry. No budget
 * or policy checks; for testing and development only.
 */
export class NaiveTreasurer implements X402Treasurer {
  constructor(private wallet: X402Wallet) {}

  async onPaymentRequired(request: PaymentRequest, _context?: PaymentContext): Promise<Authorization | null> {
    const instruction = firstInstructionOf(request)
    const payment = await this.wallet.createPayment(instruction)
    return {
      payment,
      authorizationId: crypto.randomUUID(),
      accepted: acceptedOf(instruction),
    }
  }

  async onStatus(status: PaymentStatus, authorization: Authorization, _context?: PaymentContext): Promise<void> {
    console.log(`[NaiveTreasurer] Payment ${authorization.authorizationId}: ${status}`)
  }
}

export function createNaiveTreasurer(walletConfig: WalletConfig): X402Treasurer {
  const wallet = createWalletFromConfig(walletConfig)
  return new NaiveTreasurer(wallet)
}
