import { type Address, type Hex } from "viem"

import { COSIGNER_VALIDATOR, OWNABLE_VALIDATOR } from "../../../smart-account/constants.ts"
import { acceptedOf, type PaymentAuthorization, type PaymentInstruction } from "../../envelopes.ts"
import type { ServerAuthorizationData } from "../../types.ts"
import { WalletError, type X402Wallet } from "../../wallet.ts"
import { createCoSignedPayment } from "./cosigned.ts"
import { createExactPayment } from "./exact.ts"

export interface SmartAccountConfig {
  smartAccountAddress: Address
  sessionKeyPrivateKey: Hex
  /** OwnableValidator address. Defaults to the standard OwnableValidator. */
  validatorAddress?: Address
  /** CoSignerValidator address. Defaults to the standard CoSignerValidator. */
  coSignerValidatorAddress?: Address
}

/**
 * Smart account wallet using ERC-1271. Supports Safe accounts with the
 * OwnableValidator module and only the `exact` scheme (ERC-3009 / USDC).
 */
export class SmartAccountWallet implements X402Wallet {
  private readonly config: SmartAccountConfig & { validatorAddress: Address; coSignerValidatorAddress: Address }

  constructor(config: SmartAccountConfig) {
    this.config = {
      ...config,
      validatorAddress: config.validatorAddress ?? OWNABLE_VALIDATOR,
      coSignerValidatorAddress: config.coSignerValidatorAddress ?? COSIGNER_VALIDATOR,
    }
  }

  async createPayment(
    instruction: PaymentInstruction,
    serverAuthorization?: ServerAuthorizationData,
  ): Promise<PaymentAuthorization> {
    const accepted = acceptedOf(instruction)
    if (accepted.scheme !== "exact") {
      throw new WalletError(`Unsupported payment scheme: ${accepted.scheme}. SmartAccountWallet only supports "exact".`)
    }

    try {
      if (serverAuthorization) {
        return await createCoSignedPayment(instruction, this.config, serverAuthorization)
      }
      return await createExactPayment(instruction, this.config)
    } catch (error) {
      throw new WalletError(
        `Failed to create smart account payment: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined,
      )
    }
  }

  get address(): Address {
    return this.config.smartAccountAddress
  }
}
