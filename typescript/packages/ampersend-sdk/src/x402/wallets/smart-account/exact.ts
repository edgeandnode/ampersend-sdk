import { toHex, type Address, type Hex } from "viem"

import { signERC3009Authorization } from "../../../smart-account/index.ts"
import {
  acceptedOf,
  amountOf,
  buildAuthorization,
  type PaymentAuthorization,
  type PaymentInstruction,
} from "../../envelopes.ts"
import { chainIdOf } from "./chain.ts"

function createNonce(): Hex {
  const cryptoObj =
    typeof globalThis.crypto !== "undefined" && typeof globalThis.crypto.getRandomValues === "function"
      ? globalThis.crypto
      : // Dynamic require for node.js compatibility.
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require("crypto").webcrypto
  return toHex(cryptoObj.getRandomValues(new Uint8Array(32)))
}

export interface ExactPaymentConfig {
  smartAccountAddress: Address
  sessionKeyPrivateKey: Hex
  /** OwnableValidator address used for ERC-1271 validation. */
  validatorAddress: Address
}

/**
 * Sign an `exact` instruction: ERC-3009 `transferWithAuthorization` via
 * ERC-1271 with OwnableValidator. {@link buildAuthorization} packages the
 * signed body for v1 or v2.
 */
export async function createExactPayment(
  instruction: PaymentInstruction,
  config: ExactPaymentConfig,
): Promise<PaymentAuthorization> {
  const accepted = acceptedOf(instruction)
  const payTo = accepted.payTo as Address
  const asset = accepted.asset as Address

  const nonce = createNonce()
  const now = Math.floor(Date.now() / 1000)
  const validAfter = BigInt(now - 600) // 10 minutes of clock-skew tolerance
  const validBefore = BigInt(now + accepted.maxTimeoutSeconds)

  const authData = {
    from: config.smartAccountAddress,
    to: payTo,
    value: BigInt(amountOf(instruction)),
    validAfter,
    validBefore,
    nonce,
  }

  const domainName = accepted.extra?.name as string | undefined
  const domainVersion = accepted.extra?.version as string | undefined

  if (!domainName || !domainVersion) {
    throw new Error("accepted.extra must contain 'name' and 'version' for EIP-712 domain")
  }

  const chainId = chainIdOf(instruction)
  if (chainId === null) {
    throw new Error(`Unsupported network "${accepted.network}" — use a known v1 name or CAIP-2 "eip155:N".`)
  }

  const signature = await signERC3009Authorization(
    config.sessionKeyPrivateKey,
    config.smartAccountAddress,
    authData,
    asset,
    chainId,
    config.validatorAddress,
    domainName,
    domainVersion,
  )

  const signedPayload = {
    signature: signature as string,
    authorization: {
      from: config.smartAccountAddress as string,
      to: payTo as string,
      value: amountOf(instruction),
      validAfter: validAfter.toString(),
      validBefore: validBefore.toString(),
      nonce: nonce as string,
    },
  }

  return buildAuthorization(instruction, signedPayload)
}
