import type { Hex, LocalAccount } from "viem"
import { privateKeyToAccount } from "viem/accounts"
import { createPaymentHeader } from "x402/client"
import type { PaymentPayload as V1PaymentPayload } from "x402/types"

import type { PaymentAuthorization, PaymentOption, ServerAuthorizationData } from "../../../ampersend/types.ts"
import { toV1Requirements } from "../../http/conversions.ts"
import { WalletError, type X402Wallet } from "../../wallet.ts"

/**
 * AccountWallet - EOA (Externally Owned Account) wallet implementation
 *
 * Creates signed payment authorizations using an EOA private key. Supports
 * only the "exact" payment scheme.
 *
 * @example
 * ```typescript
 * import { privateKeyToAccount } from "viem/accounts"
 *
 * // From viem Account
 * const account = privateKeyToAccount("0x...")
 * const wallet = new AccountWallet(account)
 *
 * // From private key directly
 * const wallet = AccountWallet.fromPrivateKey("0x...")
 * ```
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
   * Creates a signed payment authorization from a canonical payment option.
   * Only supports the "exact" payment scheme. `serverAuthorization` is ignored
   * for EOA wallets (only used by SmartAccountWallet).
   */
  async createPayment(
    option: PaymentOption,
    _serverAuthorization?: ServerAuthorizationData,
  ): Promise<PaymentAuthorization> {
    if (option.scheme !== "exact") {
      throw new WalletError(`Unsupported payment scheme: ${option.scheme}. AccountWallet only supports "exact".`)
    }

    try {
      // The x402 client helper still speaks v1 wire format; translate to v1
      // shape for the call and then strip the v1 envelope back off.
      const v1Requirements = toV1Requirements(option)
      const paymentHeader = await createPaymentHeader(this.account, 1, v1Requirements)
      const decoded = Buffer.from(paymentHeader, "base64").toString("utf-8")
      const v1Payment = JSON.parse(decoded) as V1PaymentPayload

      return {
        scheme: option.scheme,
        network: option.network,
        body: v1Payment.payload as Record<string, unknown>,
      }
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
