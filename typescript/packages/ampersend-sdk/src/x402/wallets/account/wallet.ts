import type { Hex, LocalAccount } from "viem"
import { privateKeyToAccount } from "viem/accounts"
import { createPaymentHeader } from "x402/client"
import type { PaymentPayload as V1PaymentPayload } from "x402/types"

import type { PaymentAuthorization, PaymentOption } from "../../envelopes.ts"
import type { ServerAuthorizationData } from "../../types.ts"
import { WalletError, type X402Wallet } from "../../wallet.ts"

/**
 * AccountWallet - EOA (Externally Owned Account) wallet implementation.
 *
 * Signs payment options with an EOA private key. Currently supports the x402
 * v1 protocol and the "exact" scheme only (the `x402/client` helper it wraps
 * is v1-specific).
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

  /**
   * Sign an "exact" scheme x402-v1 option into a PaymentAuthorization envelope.
   * Throws for unsupported protocols/schemes. `_serverAuthorization` is
   * ignored (EOA wallets have no co-signature path).
   */
  async createPayment(
    option: PaymentOption,
    _serverAuthorization?: ServerAuthorizationData,
  ): Promise<PaymentAuthorization> {
    if (option.protocol !== "x402-v1") {
      throw new WalletError(`AccountWallet only supports x402-v1 options (got ${option.protocol}).`)
    }
    if (option.data.scheme !== "exact") {
      throw new WalletError(`Unsupported payment scheme: ${option.data.scheme}. AccountWallet only supports "exact".`)
    }

    try {
      const paymentHeader = await createPaymentHeader(this.account, 1, option.data)
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
