import type { Address, Hex } from "viem"
import { privateKeyToAccount } from "viem/accounts"

import { OWNABLE_VALIDATOR } from "../smart-account/index.ts"
import { acceptedOf, resourceUrlOf, type PaymentInstruction, type PaymentRequest } from "../x402/envelopes.ts"
import {
  createWalletFromConfig,
  type Authorization,
  type PaymentContext,
  type PaymentStatus,
  type SmartAccountWalletConfig,
  type WalletConfig,
  type X402Treasurer,
  type X402Wallet,
} from "../x402/index.ts"
import { ApiClient } from "./client.ts"
import type { PaymentEvent, ServerAuthorizationData } from "./types.ts"

const DEFAULT_API_URL = "https://api.ampersend.ai"

/** Simplified config for the common "smart account + session key" setup. */
export interface SimpleAmpersendTreasurerConfig {
  smartAccountAddress: Address
  sessionKeyPrivateKey: Hex
  /** Defaults to the production Ampersend API. */
  apiUrl?: string
}

/** Full config for EOA wallets or custom SIWE auth. */
export interface FullAmpersendTreasurerConfig {
  apiUrl: string
  walletConfig: WalletConfig
  authConfig?: {
    /** SIWE domain. */
    domain?: string
    /** SIWE statement. */
    statement?: string
  }
}

export type AmpersendTreasurerConfig = SimpleAmpersendTreasurerConfig | FullAmpersendTreasurerConfig

function isSimpleConfig(config: AmpersendTreasurerConfig): config is SimpleAmpersendTreasurerConfig {
  return "smartAccountAddress" in config && "sessionKeyPrivateKey" in config && !("walletConfig" in config)
}

/**
 * Forwards the 402 to the Ampersend API, which applies budget/policy and
 * returns an `acceptsIndex` to sign (plus optional co-signature).
 */
export class AmpersendTreasurer implements X402Treasurer {
  constructor(
    private apiClient: ApiClient,
    private wallet: X402Wallet,
  ) {}

  async onPaymentRequired(request: PaymentRequest, context?: PaymentContext): Promise<Authorization | null> {
    const response = await this.apiClient.authorizePayment(request, context)

    const selected = response.authorized.selected
    if (!selected) {
      const reasons = response.rejected
        .map((r) => `${resourceUrlOf(instructionFor(request, r.acceptsIndex))}: ${r.reason}`)
        .join(", ")
      console.log(`[AmpersendTreasurer] No options authorized. Reasons: ${reasons || "None provided"}`)
      return null
    }

    const instruction = instructionFor(request, selected.acceptsIndex)
    const serverAuth: ServerAuthorizationData | undefined = selected.coSignature
      ? {
          authorizationData: selected.coSignature.authorizationData,
          serverSignature: selected.coSignature.serverSignature,
        }
      : undefined
    const payment = await this.wallet.createPayment(instruction, serverAuth)

    return {
      payment,
      authorizationId: crypto.randomUUID(),
      accepted: acceptedOf(instruction),
    }
  }

  async onStatus(status: PaymentStatus, authorization: Authorization, _context?: PaymentContext): Promise<void> {
    try {
      const event = this.mapStatusToEvent(status)
      await this.apiClient.reportPaymentEvent(authorization.authorizationId, authorization.payment, event)
    } catch (error) {
      console.error(`[AmpersendTreasurer] Failed to report status ${status}:`, error)
    }
  }

  private mapStatusToEvent(status: PaymentStatus): PaymentEvent {
    switch (status) {
      case "sending":
        return { type: "sending" }
      case "accepted":
        return { type: "accepted" }
      case "rejected":
        return { type: "rejected", reason: "Payment rejected by server" }
      case "declined":
        return { type: "rejected", reason: "Payment declined by treasurer" }
      case "error":
        return { type: "error", reason: "Payment processing error" }
    }
  }
}

function instructionFor(request: PaymentRequest, acceptsIndex: number): PaymentInstruction {
  return request.protocol === "x402-v1"
    ? { protocol: "x402-v1", request: request.data, acceptsIndex }
    : { protocol: "x402-v2", request: request.data, acceptsIndex }
}

/**
 * @example Simple (recommended):
 * ```typescript
 * createAmpersendTreasurer({ smartAccountAddress: "0x...", sessionKeyPrivateKey: "0x..." })
 * ```
 * @example Full (EOA or custom auth):
 * ```typescript
 * createAmpersendTreasurer({
 *   apiUrl: "https://api.ampersend.ai",
 *   walletConfig: { type: "eoa", privateKey: "0x..." },
 * })
 * ```
 */
export function createAmpersendTreasurer(config: AmpersendTreasurerConfig): X402Treasurer {
  if (isSimpleConfig(config)) {
    const walletConfig: SmartAccountWalletConfig = {
      type: "smart-account",
      smartAccountAddress: config.smartAccountAddress,
      sessionKeyPrivateKey: config.sessionKeyPrivateKey,
      validatorAddress: OWNABLE_VALIDATOR,
    }

    const apiClient = new ApiClient({
      baseUrl: config.apiUrl ?? DEFAULT_API_URL,
      sessionKeyPrivateKey: config.sessionKeyPrivateKey,
      agentAddress: config.smartAccountAddress,
      timeout: 30000,
    })

    const wallet = createWalletFromConfig(walletConfig)
    return new AmpersendTreasurer(apiClient, wallet)
  }

  const { apiUrl, authConfig, walletConfig } = config

  const authPrivateKey = walletConfig.type === "eoa" ? walletConfig.privateKey : walletConfig.sessionKeyPrivateKey

  const agentAddress =
    walletConfig.type === "smart-account"
      ? walletConfig.smartAccountAddress
      : privateKeyToAccount(walletConfig.privateKey).address

  const apiClient = new ApiClient({
    baseUrl: apiUrl,
    sessionKeyPrivateKey: authPrivateKey,
    agentAddress,
    timeout: 30000,
    ...authConfig,
  })

  const wallet = createWalletFromConfig(walletConfig)

  return new AmpersendTreasurer(apiClient, wallet)
}
