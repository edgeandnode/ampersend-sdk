import { toHex, type Address, type Hex } from "viem"

import { signERC3009Authorization } from "../../../smart-account/index.ts"
import type { PaymentAuthorization, PaymentOption } from "../../canonical.ts"

/**
 * Generates a random 32-byte nonce for use in authorization signatures
 */
function createNonce(): Hex {
  const cryptoObj =
    typeof globalThis.crypto !== "undefined" && typeof globalThis.crypto.getRandomValues === "function"
      ? globalThis.crypto
      : // Dynamic require is needed to support node.js
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require("crypto").webcrypto
  return toHex(cryptoObj.getRandomValues(new Uint8Array(32)))
}

/**
 * Configuration for creating an exact payment with ERC-3009
 */
export interface ExactPaymentConfig {
  /** Smart account address (payment sender) */
  smartAccountAddress: Address
  /** Session key private key for signing */
  sessionKeyPrivateKey: Hex
  /** Chain ID for the blockchain network */
  chainId: number
  /** OwnableValidator address for ERC-1271 validation */
  validatorAddress: Address
}

/**
 * Creates a canonical signed payment authorization using the "exact" scheme
 * with ERC-3009 USDC transfer authorization.
 *
 * The scheme uses USDC's `transferWithAuthorization` (ERC-3009) to create a
 * signed off-chain authorization. The signature is produced via ERC-1271 from
 * a smart account using the OwnableValidator module. The resulting
 * authorization is returned in ampersend's canonical form; HTTP/MCP adapters
 * wrap it in an x402 v1 or v2 envelope on the way out.
 *
 * @param option - Canonical payment option
 * @param config - Smart account signing configuration
 * @returns Canonical signed payment authorization
 */
export async function createExactPayment(
  option: PaymentOption,
  config: ExactPaymentConfig,
): Promise<PaymentAuthorization> {
  const nonce = createNonce()
  const validAfter = BigInt(Math.floor(Date.now() / 1000) - 600) // 10 minutes before
  const validBefore = BigInt(Math.floor(Date.now() / 1000) + option.maxTimeoutSeconds)

  const authData = {
    from: config.smartAccountAddress,
    to: option.payTo as Address,
    value: BigInt(option.amount),
    validAfter,
    validBefore,
    nonce,
  }

  // EIP-712 domain params come from the option's scheme-specific metadata.
  const domainName = option.extra?.name as string | undefined
  const domainVersion = option.extra?.version as string | undefined

  if (!domainName || !domainVersion) {
    throw new Error("option.extra must contain 'name' and 'version' for EIP-712 domain")
  }

  // Sign using ERC-1271 with OwnableValidator
  const signature = await signERC3009Authorization(
    config.sessionKeyPrivateKey,
    config.smartAccountAddress,
    authData,
    option.asset as Address,
    config.chainId,
    config.validatorAddress,
    domainName,
    domainVersion,
  )

  return {
    scheme: option.scheme,
    network: option.network,
    body: {
      signature: signature as string,
      authorization: {
        from: config.smartAccountAddress as string,
        to: option.payTo,
        value: option.amount,
        validAfter: validAfter.toString(),
        validBefore: validBefore.toString(),
        nonce: nonce as string,
      },
    },
  }
}
