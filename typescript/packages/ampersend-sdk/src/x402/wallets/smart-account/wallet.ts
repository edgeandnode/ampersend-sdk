import { type Address, type Hex } from "viem"

import { COSIGNER_VALIDATOR, OWNABLE_VALIDATOR } from "../../../smart-account/constants.ts"
import type { PaymentAuthorization, PaymentInstruction } from "../../envelopes.ts"
import type { ServerAuthorizationData } from "../../types.ts"
import { WalletError, type X402Wallet } from "../../wallet.ts"
import { createCoSignedPayment } from "./cosigned.ts"
import { createExactPayment } from "./exact.ts"

/**
 * Configuration for SmartAccountWallet
 */
export interface SmartAccountConfig {
  /** Smart account address */
  smartAccountAddress: Address
  /** Session key private key for signing */
  sessionKeyPrivateKey: Hex
  /** Chain ID for the blockchain network */
  chainId: number
  /** OwnableValidator address (defaults to standard OwnableValidator) */
  validatorAddress?: Address
  /** CoSignerValidator address (defaults to standard CoSignerValidator) */
  coSignerValidatorAddress?: Address
}

/**
 * SmartAccountWallet - Smart account wallet implementation using ERC-1271
 *
 * Creates signed payment authorizations from a smart account using the
 * ERC-1271 standard. Supports Safe accounts with OwnableValidator module and
 * only the "exact" payment scheme with ERC-3009 (USDC) authorizations.
 *
 * @example
 * ```typescript
 * const wallet = new SmartAccountWallet({
 *   smartAccountAddress: "0x...",  // Smart account address
 *   sessionKeyPrivateKey: "0x...",  // Session key
 *   chainId: 84532,  // Base Sepolia
 *   validatorAddress: "0x..."  // OwnableValidator (optional, defaults to standard validator)
 * })
 *
 * const payment = await wallet.createPayment(requirements)
 * ```
 */
export class SmartAccountWallet implements X402Wallet {
  private readonly config: SmartAccountConfig & { validatorAddress: Address; coSignerValidatorAddress: Address }

  constructor(config: SmartAccountConfig) {
    // Apply default validator addresses if not provided
    this.config = {
      ...config,
      validatorAddress: config.validatorAddress ?? OWNABLE_VALIDATOR,
      coSignerValidatorAddress: config.coSignerValidatorAddress ?? COSIGNER_VALIDATOR,
    }
  }

  /**
   * Signs a {@link PaymentInstruction} into a {@link PaymentAuthorization}.
   * Only supports the "exact" scheme with ERC-3009 authorizations.
   */
  async createPayment(
    instruction: PaymentInstruction,
    serverAuthorization?: ServerAuthorizationData,
  ): Promise<PaymentAuthorization> {
    if (instruction.data.scheme !== "exact") {
      throw new WalletError(
        `Unsupported payment scheme: ${instruction.data.scheme}. SmartAccountWallet only supports "exact".`,
      )
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

  /**
   * Returns the smart account address
   */
  get address(): Address {
    return this.config.smartAccountAddress
  }
}
