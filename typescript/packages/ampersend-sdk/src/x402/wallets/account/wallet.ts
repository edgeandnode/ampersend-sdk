import type { PaymentRequirements as UpstreamPaymentRequirements } from "@x402/core/types"
import { ExactEvmScheme, toClientEvmSigner, type ClientEvmSigner } from "@x402/evm"
import { ExactEvmSchemeV1 } from "@x402/evm/v1"
import type { Hex, LocalAccount } from "viem"
import { privateKeyToAccount } from "viem/accounts"

import { acceptedOf, buildAuthorization, type PaymentAuthorization, type PaymentInstruction } from "../../envelopes.ts"
import type { ServerAuthorizationData } from "../../types.ts"
import { WalletError, type X402Wallet } from "../../wallet.ts"

/**
 * EOA wallet for x402 `exact` on EVM. A `LocalAccount` is sufficient for
 * EIP-3009 and base Permit2; EIP-2612 permit enrichment is skipped because it
 * needs `readContract`, which `LocalAccount` lacks.
 */
export class AccountWallet implements X402Wallet {
  private account: LocalAccount
  private signer: ClientEvmSigner
  private schemeV1: ExactEvmSchemeV1
  private schemeV2: ExactEvmScheme

  constructor(account: LocalAccount) {
    this.account = account
    this.signer = toClientEvmSigner({
      address: account.address,
      signTypedData: (msg) => account.signTypedData(msg),
    })
    this.schemeV1 = new ExactEvmSchemeV1(this.signer)
    this.schemeV2 = new ExactEvmScheme(this.signer)
  }

  static fromPrivateKey(privateKey: Hex): AccountWallet {
    return new AccountWallet(privateKeyToAccount(privateKey))
  }

  async createPayment(
    instruction: PaymentInstruction,
    serverAuthorization?: ServerAuthorizationData,
  ): Promise<PaymentAuthorization> {
    if (serverAuthorization) {
      throw new WalletError(
        "AccountWallet received a co-signed authorization from the server, but EOA accounts " +
          "cannot produce ERC-1271 co-signed payments. Use SmartAccountWallet for co-signed agent keys.",
      )
    }
    const accepted = acceptedOf(instruction)
    if (accepted.scheme !== "exact") {
      throw new WalletError(`Unsupported payment scheme: ${accepted.scheme}. AccountWallet only supports "exact".`)
    }

    // Zod-inferred shape → upstream v2-surface shape. Nominal mismatch only;
    // each scheme re-narrows to the version it needs at runtime.
    const requirements = accepted as UpstreamPaymentRequirements
    try {
      const result =
        instruction.protocol === "x402-v1"
          ? await this.schemeV1.createPaymentPayload(1, requirements)
          : await this.schemeV2.createPaymentPayload(
              2,
              requirements,
              instruction.request.extensions ? { extensions: instruction.request.extensions } : undefined,
            )
      return buildAuthorization(instruction, result.payload)
    } catch (error) {
      throw new WalletError(
        `Failed to create payment: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined,
      )
    }
  }

  get address(): Hex {
    return this.account.address
  }
}
