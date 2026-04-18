import { toHex, type Address, type Hex } from "viem"

import { signERC3009Authorization } from "../../../smart-account/index.ts"
import { getAmount, getNetworkCaip2 } from "../../accessors.ts"
import type { PaymentAuthorization, PaymentOption } from "../../envelopes.ts"

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
 * Sign an "exact" scheme option into a PaymentAuthorization envelope.
 *
 * Uses USDC's `transferWithAuthorization` (ERC-3009) via ERC-1271 with the
 * OwnableValidator module. The same signed body is wrapped in a v1 or v2
 * envelope depending on the input option's protocol.
 */
export async function createExactPayment(
  option: PaymentOption,
  config: ExactPaymentConfig,
): Promise<PaymentAuthorization> {
  const maxTimeoutSeconds = option.data.maxTimeoutSeconds
  const payTo = option.data.payTo as Address
  const asset = option.data.asset as Address
  const amount = getAmount(option)

  const nonce = createNonce()
  const validAfter = BigInt(Math.floor(Date.now() / 1000) - 600) // 10 minutes before
  const validBefore = BigInt(Math.floor(Date.now() / 1000) + maxTimeoutSeconds)

  const authData = {
    from: config.smartAccountAddress,
    to: payTo,
    value: BigInt(amount),
    validAfter,
    validBefore,
    nonce,
  }

  // EIP-712 domain params come from the seller's scheme-specific metadata.
  const extra = option.data.extra
  const domainName = extra?.name as string | undefined
  const domainVersion = extra?.version as string | undefined

  if (!domainName || !domainVersion) {
    throw new Error("option.data.extra must contain 'name' and 'version' for EIP-712 domain")
  }

  // Sign using ERC-1271 with OwnableValidator
  const signature = await signERC3009Authorization(
    config.sessionKeyPrivateKey,
    config.smartAccountAddress,
    authData,
    asset,
    config.chainId,
    config.validatorAddress,
    domainName,
    domainVersion,
  )

  const signedPayload = {
    signature: signature as string,
    authorization: {
      from: config.smartAccountAddress as string,
      to: payTo as string,
      value: amount,
      validAfter: validAfter.toString(),
      validBefore: validBefore.toString(),
      nonce: nonce as string,
    },
  }

  if (option.protocol === "x402-v1") {
    return {
      protocol: "x402-v1",
      data: {
        x402Version: 1,
        scheme: "exact",
        network: option.data.network,
        payload: signedPayload,
      },
    }
  }

  // v2: the PaymentPayloadV2 carries `resource` (from the 402 response) and
  // `accepted` (echo of the requirement we signed), alongside the signed body.
  return {
    protocol: "x402-v2",
    data: {
      x402Version: 2,
      resource: option.resource,
      accepted: {
        scheme: option.data.scheme,
        network: getNetworkCaip2(option),
        amount: option.data.amount,
        asset: option.data.asset,
        payTo: option.data.payTo,
        maxTimeoutSeconds: option.data.maxTimeoutSeconds,
        extra: option.data.extra,
      },
      payload: signedPayload,
    },
  }
}
