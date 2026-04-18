import type { PaymentInstruction, PaymentRequest } from "../envelopes.ts"
import type { Authorization, PaymentContext, PaymentStatus, X402Treasurer } from "../treasurer.ts"
import type { X402Wallet } from "../wallet.ts"
import { createWalletFromConfig, type WalletConfig } from "../wallets/index.ts"

/**
 * NaiveTreasurer - Auto-approves all payment requests
 *
 * Picks the first entry from `request.data.accepts` and signs it without any
 * budget or policy checks. Intended for testing and development.
 *
 * @example
 * ```typescript
 * const wallet = new AccountWallet(account)
 * const treasurer = new NaiveTreasurer(wallet)
 * ```
 */
export class NaiveTreasurer implements X402Treasurer {
  constructor(private wallet: X402Wallet) {}

  async onPaymentRequired(request: PaymentRequest, _context?: PaymentContext): Promise<Authorization | null> {
    // v2 wire payload requires the offer-level `resource`; v1 carries resource inside `data`.
    let instruction: PaymentInstruction
    if (request.protocol === "x402-v1") {
      const first = request.data.accepts[0]
      if (!first) return null
      instruction = { protocol: "x402-v1", data: first }
    } else {
      const first = request.data.accepts[0]
      if (!first) return null
      instruction = { protocol: "x402-v2", data: first, resource: request.data.resource }
    }

    const payment = await this.wallet.createPayment(instruction)

    return {
      payment,
      authorizationId: crypto.randomUUID(),
    }
  }

  async onStatus(status: PaymentStatus, authorization: Authorization, _context?: PaymentContext): Promise<void> {
    console.log(`[NaiveTreasurer] Payment ${authorization.authorizationId}: ${status}`)
  }
}

/**
 * Creates a naive treasurer that automatically approves all payment requests.
 *
 * @example
 * ```typescript
 * const treasurer = createNaiveTreasurer({ type: "eoa", privateKey: "0x..." })
 * ```
 */
export function createNaiveTreasurer(walletConfig: WalletConfig): X402Treasurer {
  const wallet = createWalletFromConfig(walletConfig)
  return new NaiveTreasurer(wallet)
}
