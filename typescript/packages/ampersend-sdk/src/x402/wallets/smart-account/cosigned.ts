import { encodeAbiParameters, encodePacked, type Address, type Hex, type TypedDataDefinition } from "viem"
import { privateKeyToAccount } from "viem/accounts"

import { TRANSFER_WITH_AUTHORIZATION_TYPE } from "../../../smart-account/eip712-types.ts"
import { acceptedOf, buildAuthorization, type PaymentAuthorization, type PaymentInstruction } from "../../envelopes.ts"
import type { ServerAuthorizationData } from "../../types.ts"
import { chainIdOf } from "./chain.ts"

export interface CoSignedPaymentConfig {
  smartAccountAddress: Address
  sessionKeyPrivateKey: Hex
  coSignerValidatorAddress: Address
}

/**
 * CoSignerValidator ERC-1271 signature: agent signs → `abi.encode(agentSig, serverSig)`
 * → `encodePacked(validator, combined)`.
 */
export async function encodeCoSignedERC1271Signature(
  agentPrivateKey: Hex,
  typedDataParams: TypedDataDefinition,
  serverSignature: Hex,
  coSignerValidatorAddress: Address,
): Promise<Hex> {
  const agentAccount = privateKeyToAccount(agentPrivateKey)
  const agentSignature = await agentAccount.signTypedData(typedDataParams)

  const combinedSignature = encodeAbiParameters(
    [{ type: "bytes" }, { type: "bytes" }],
    [agentSignature, serverSignature],
  )

  return encodePacked(["address", "bytes"], [coSignerValidatorAddress, combinedSignature])
}

/**
 * Sign a co-signed `exact` instruction. Server supplies ERC-3009
 * authorization data + its signature; agent adds its own and the pair is
 * validated via CoSignerValidator under ERC-1271.
 */
export async function createCoSignedPayment(
  instruction: PaymentInstruction,
  config: CoSignedPaymentConfig,
  serverAuthorization: ServerAuthorizationData,
): Promise<PaymentAuthorization> {
  const { authorizationData, serverSignature } = serverAuthorization
  const accepted = acceptedOf(instruction)

  const domainName = accepted.extra?.name as string | undefined
  const domainVersion = accepted.extra?.version as string | undefined

  if (!domainName || !domainVersion) {
    throw new Error("accepted.extra must contain 'name' and 'version' for EIP-712 domain")
  }

  const chainId = chainIdOf(instruction)
  if (chainId === null) {
    throw new Error(`Unsupported network "${accepted.network}" — use a known v1 name or CAIP-2 "eip155:N".`)
  }

  const typedData: TypedDataDefinition = {
    domain: {
      name: domainName,
      version: domainVersion,
      chainId,
      verifyingContract: accepted.asset as Address,
    },
    types: {
      TransferWithAuthorization: TRANSFER_WITH_AUTHORIZATION_TYPE,
    },
    primaryType: "TransferWithAuthorization",
    message: {
      from: authorizationData.from,
      to: authorizationData.to,
      value: BigInt(authorizationData.value),
      validAfter: BigInt(authorizationData.validAfter),
      validBefore: BigInt(authorizationData.validBefore),
      nonce: authorizationData.nonce as Hex,
    },
  }

  const signature = await encodeCoSignedERC1271Signature(
    config.sessionKeyPrivateKey,
    typedData,
    serverSignature as Hex,
    config.coSignerValidatorAddress,
  )

  const signedPayload = {
    signature: signature as string,
    authorization: {
      from: authorizationData.from,
      to: authorizationData.to,
      value: authorizationData.value,
      validAfter: authorizationData.validAfter,
      validBefore: authorizationData.validBefore,
      nonce: authorizationData.nonce,
    },
  }

  return buildAuthorization(instruction, signedPayload)
}
