import type { Address, Hex } from "viem"
import { privateKeyToAccount } from "viem/accounts"

import { OWNABLE_VALIDATOR } from "../smart-account/index.ts"
import type { PaymentAuthorization, PaymentInstruction, PaymentRequest } from "../x402/envelopes.ts"
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

/** Default Ampersend API URL */
const DEFAULT_API_URL = "https://api.ampersend.ai"

/** Default chain ID (Base mainnet) */
const DEFAULT_CHAIN_ID = 8453

/**
 * Simplified configuration for quick setup with smart accounts.
 *
 * @example
 * ```typescript
 * const treasurer = createAmpersendTreasurer({
 *   smartAccountAddress: "0x...",
 *   sessionKeyPrivateKey: "0x...",
 * })
 * ```
 */
export interface SimpleAmpersendTreasurerConfig {
  /** Smart account address */
  smartAccountAddress: Address
  /** Session key private key for signing */
  sessionKeyPrivateKey: Hex
  /** Ampersend API URL (defaults to production) */
  apiUrl?: string
  /** Chain ID (defaults to Base mainnet 8453) */
  chainId?: number
}

/**
 * Full configuration for advanced use cases with complete wallet control.
 */
export interface FullAmpersendTreasurerConfig {
  /** Base URL of the Ampersend API server */
  apiUrl: string
  /** Wallet configuration (EOA or Smart Account) */
  walletConfig: WalletConfig
  /** Optional authentication configuration */
  authConfig?: {
    /** SIWE domain for authentication */
    domain?: string
    /** SIWE statement for authentication */
    statement?: string
  }
}

export type AmpersendTreasurerConfig = SimpleAmpersendTreasurerConfig | FullAmpersendTreasurerConfig

function isSimpleConfig(config: AmpersendTreasurerConfig): config is SimpleAmpersendTreasurerConfig {
  return "smartAccountAddress" in config && "sessionKeyPrivateKey" in config && !("walletConfig" in config)
}

/**
 * AmpersendTreasurer - Ampersend API-based payment authorization.
 *
 * Forwards the seller's {@link PaymentRequest} to the Ampersend API, which
 * applies budget/policy and returns a selected instruction (plus optional
 * co-signature). The treasurer then has the wallet sign that instruction.
 */
export class AmpersendTreasurer implements X402Treasurer {
  constructor(
    private apiClient: ApiClient,
    private wallet: X402Wallet,
  ) {}

  async onPaymentRequired(request: PaymentRequest, context?: PaymentContext): Promise<Authorization | null> {
    try {
      if (request.data.accepts.length === 0) return null

      const response = await this.apiClient.authorizePayment(request, context)

      const selected = response.authorized.selected
      if (!selected) {
        const reasons = response.rejected
          .map((r) => `${resourceUrlOf(r.instruction as unknown as PaymentInstruction)}: ${r.reason}`)
          .join(", ")
        console.log(`[AmpersendTreasurer] No instructions authorized. Reasons: ${reasons || "None provided"}`)
        return null
      }

      // The API echoes back the envelope shape it chose; carry it to the wallet.
      // Wire shape is loose (`data` is `Record<string, unknown>` in the Effect
      // schema); the wallet narrows further on `instruction.protocol`.
      const instruction = selected.instruction as unknown as PaymentInstruction

      let payment: PaymentAuthorization
      if (selected.coSignature) {
        const serverAuth: ServerAuthorizationData = {
          authorizationData: selected.coSignature.authorizationData,
          serverSignature: selected.coSignature.serverSignature,
        }
        payment = await this.wallet.createPayment(instruction, serverAuth)
      } else {
        payment = await this.wallet.createPayment(instruction)
      }

      return {
        payment,
        authorizationId: crypto.randomUUID(),
      }
    } catch (error) {
      console.error("[AmpersendTreasurer] Payment authorization failed:", error)
      return null
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

/** Read the resource URL from an instruction, regardless of protocol. */
function resourceUrlOf(instruction: PaymentInstruction): string {
  return instruction.protocol === "x402-v1" ? instruction.data.resource : instruction.resource.url
}

/**
 * Creates an Ampersend treasurer that consults the Ampersend API before making payments.
 *
 * @example Simple setup (recommended):
 * ```typescript
 * const treasurer = createAmpersendTreasurer({
 *   smartAccountAddress: "0x...",
 *   sessionKeyPrivateKey: "0x...",
 * })
 * ```
 *
 * @example Full control:
 * ```typescript
 * const treasurer = createAmpersendTreasurer({
 *   apiUrl: "https://api.ampersend.ai",
 *   walletConfig: { type: "eoa", privateKey: "0x..." }
 * })
 * ```
 */
export function createAmpersendTreasurer(config: AmpersendTreasurerConfig): X402Treasurer {
  if (isSimpleConfig(config)) {
    const walletConfig: SmartAccountWalletConfig = {
      type: "smart-account",
      smartAccountAddress: config.smartAccountAddress,
      sessionKeyPrivateKey: config.sessionKeyPrivateKey,
      chainId: config.chainId ?? DEFAULT_CHAIN_ID,
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
