import type { Hex, LocalAccount } from "viem"
import { privateKeyToAccount } from "viem/accounts"
import { createPaymentHeader } from "x402/client"
import type { PaymentPayload as V1PaymentPayload, PaymentRequirements as V1PaymentRequirements } from "x402/types"

import type { PaymentAuthorization, PaymentInstruction } from "../../envelopes.ts"
import type { ServerAuthorizationData } from "../../types.ts"
import { WalletError, type X402Wallet } from "../../wallet.ts"

/**
 * AccountWallet - EOA (Externally Owned Account) wallet implementation.
 *
 * Signs a {@link PaymentInstruction} with an EOA private key. Currently supports
 * x402 v1 with the "exact" scheme only (the `x402/client` helper it wraps is
 * v1-specific).
 */
export class AccountWallet implements X402Wallet {
  private account: LocalAccount

  constructor(account: LocalAccount) {
    this.account = account
  }

  /**
   * Creates an AccountWallet from a private key
   */
  static fromPrivateKey(privateKey: Hex): AccountWallet {
    return new AccountWallet(privateKeyToAccount(privateKey))
  }

  async createPayment(
    instruction: PaymentInstruction,
    _serverAuthorization?: ServerAuthorizationData,
  ): Promise<PaymentAuthorization> {
    if (instruction.protocol !== "x402-v1") {
      throw new WalletError(`AccountWallet only supports x402-v1 instructions (got ${instruction.protocol}).`)
    }
    if (instruction.data.scheme !== "exact") {
      throw new WalletError(
        `Unsupported payment scheme: ${instruction.data.scheme}. AccountWallet only supports "exact".`,
      )
    }

    try {
      // x402/types is stricter (narrow network union) than @x402/core/schemas'
      // PaymentRequirementsV1; at runtime they are structurally compatible.
      const paymentHeader = await createPaymentHeader(this.account, 1, instruction.data as V1PaymentRequirements)
      const decoded = Buffer.from(paymentHeader, "base64").toString("utf-8")
      const v1Payment = JSON.parse(decoded) as V1PaymentPayload
      return { protocol: "x402-v1", data: v1Payment }
    } catch (error) {
      throw new WalletError(
        `Failed to create payment: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined,
      )
    }
  }

  /**
   * Returns the account address
   */
  get address(): Hex {
    return this.account.address
  }
}
