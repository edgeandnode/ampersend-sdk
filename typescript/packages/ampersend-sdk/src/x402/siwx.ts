/**
 * Sign-In-With-X (SIWX) integration for Ampersend smart accounts.
 *
 * Ampersend smart accounts cannot sign alone — every ERC-1271 signature must
 * pass `CoSignerValidator`, which requires the agent's session key AND the
 * ampersend service key to both sign the same hash. This module wires that
 * dual-sig requirement into the SIWX flow: the session key signs the SIWE
 * message hash locally, the API is asked to co-sign it, the two signatures
 * are packed into a `CoSignerValidator` envelope, and the result is sent as
 * the SIWX payload signature.
 *
 * Servers MUST verify with `eip1271` (e.g. viem `publicClient.verifyMessage`)
 * to accept the resulting signature.
 */

import { decodePaymentRequiredHeader } from "@x402/core/http"
import {
  createSIWxPayload,
  encodeSIWxHeader,
  SIGN_IN_WITH_X,
  type EVMSigner,
  type SIWxExtension,
} from "@x402/extensions/sign-in-with-x"
import { encodeAbiParameters, encodePacked, hashMessage, type Address, type Hex, type SignableMessage } from "viem"
import { privateKeyToAccount } from "viem/accounts"

import { ApiClient } from "../ampersend/client.ts"
import { COSIGNER_VALIDATOR } from "../smart-account/constants.ts"

export interface SiwxSignerConfig {
  /** Smart account address — the SIWX-claimed identity and the payment-history address. */
  smartAccountAddress: Address
  /** Session key authorized via CoSignerValidator to sign for the smart account. */
  sessionKeyPrivateKey: Hex
  /** Ampersend API base URL. */
  apiUrl: string
  /** CoSignerValidator address. Defaults to the standard CoSignerValidator. */
  validatorAddress?: Address
}

/**
 * Normalize viem's `SignableMessage` to the raw string SIWE produces.
 * SIWX message bodies are always strings per CAIP-122; reject the `{ raw }`
 * shape rather than guess what to send to the API for parsing.
 */
function requireStringMessage(message: SignableMessage): string {
  if (typeof message === "string") return message
  throw new Error("SIWX signer received a non-string message; SIWE messages must be strings")
}

/**
 * Build an EVMSigner that signs SIWX messages as the smart account.
 *
 * Each `signMessage` call dispatches a co-sign request to the Ampersend API,
 * so SIWX inherits the same liveness + policy boundary as payments. The
 * returned signature is a CoSignerValidator ERC-1271 envelope: server
 * verifiers call the Safe's `isValidSignature`, which routes to
 * CoSignerValidator, which recovers both keys against `hashMessage(message)`.
 */
export function createSiwxSigner(config: SiwxSignerConfig): EVMSigner {
  const validatorAddress = config.validatorAddress ?? COSIGNER_VALIDATOR
  const sessionKeyAccount = privateKeyToAccount(config.sessionKeyPrivateKey)
  const apiClient = new ApiClient({
    baseUrl: config.apiUrl,
    sessionKeyPrivateKey: config.sessionKeyPrivateKey,
    agentAddress: config.smartAccountAddress,
    timeout: 30000,
  })

  return {
    address: config.smartAccountAddress,
    signMessage: async ({ message }) => {
      const messageString = requireStringMessage(message)
      // viem's verifyMessage passes hashMessage(message) to the Safe's
      // isValidSignature; CoSignerValidator's `_validateDualSignature` then
      // calls `ECDSA.recover(hash, sig)` directly — no further EIP-191
      // wrapping. Both signatures MUST be raw ECDSA over this exact hash,
      // not signMessage({ raw }) (which would re-prefix and recover wrong).
      const messageHash = hashMessage(messageString)

      const [agentSignature, { serverSignature }] = await Promise.all([
        sessionKeyAccount.sign({ hash: messageHash }),
        apiClient.signSiwxChallenge(messageString),
      ])

      const combinedSignature = encodeAbiParameters(
        [{ type: "bytes" }, { type: "bytes" }],
        [agentSignature, serverSignature as Hex],
      )

      // ERC-7579 nested-validator framing — see x402/wallets/smart-account/cosigned.ts.
      return encodePacked(["address", "bytes"], [validatorAddress, combinedSignature])
    },
  }
}

/**
 * Wrap a fetch implementation so SIWX 402 challenges are satisfied
 * automatically, signing as the configured smart account.
 *
 * Pair with `wrapFetchWithPayment` from `@x402/fetch`, putting SIWX **inside**
 * the payment wrapper. SIWX short-circuits when the server has prior payment
 * for the wallet; otherwise the 402 propagates to the payment wrapper.
 *
 * @example
 * ```ts
 * const fetchWithSiwx = wrapFetchWithAmpersendSiwx(fetch, {
 *   smartAccountAddress,
 *   sessionKeyPrivateKey,
 * })
 * const fetchWithPayment = wrapFetchWithPayment(fetchWithSiwx, ampersendClient)
 * ```
 */
export function wrapFetchWithAmpersendSiwx(
  fetchImpl: typeof globalThis.fetch,
  config: SiwxSignerConfig,
): typeof globalThis.fetch {
  const signer = createSiwxSigner(config)

  // Upstream `wrapFetchWithSIWx` keys chain selection off `accepts[0].network`,
  // which breaks auth-only routes (`accepts: []`) — they hand off to the
  // payment wrapper which then errors on the empty accepts array. We pick the
  // chain from `accepts[0]` when present, otherwise fall back to the first
  // entry in `supportedChains`. Loop guard via the SIWX header is preserved.
  return async (input, init) => {
    const request = new Request(input, init)
    const clonedRequest = request.clone()

    const response = await fetchImpl(request)
    if (response.status !== 402) return response

    const paymentRequiredHeader = response.headers.get("PAYMENT-REQUIRED")
    if (!paymentRequiredHeader) return response

    const paymentRequired = decodePaymentRequiredHeader(paymentRequiredHeader)
    const siwxExtension = paymentRequired.extensions?.[SIGN_IN_WITH_X] as SIWxExtension | undefined
    if (!siwxExtension?.supportedChains?.length) return response

    if (clonedRequest.headers.has(SIGN_IN_WITH_X)) {
      throw new Error("SIWX authentication already attempted")
    }

    const paymentNetwork = paymentRequired.accepts?.[0]?.network
    const matchingChain = paymentNetwork
      ? siwxExtension.supportedChains.find((c) => c.chainId === paymentNetwork)
      : siwxExtension.supportedChains[0]
    if (!matchingChain) return response

    const completeInfo = {
      ...siwxExtension.info,
      chainId: matchingChain.chainId,
      type: matchingChain.type,
    }

    const payload = await createSIWxPayload(completeInfo, signer)
    clonedRequest.headers.set(SIGN_IN_WITH_X, encodeSIWxHeader(payload))
    return fetchImpl(clonedRequest)
  }
}
