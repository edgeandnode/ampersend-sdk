import { encodeAbiParameters, encodePacked, type Address, type Hex, type TypedDataDefinition } from "viem"
import { privateKeyToAccount } from "viem/accounts"
import type { PaymentPayload as V1PaymentPayload } from "x402/types"

import { TRANSFER_WITH_AUTHORIZATION_TYPE } from "../../../smart-account/eip712-types.ts"
import type { PaymentAuthorization, PaymentInstruction } from "../../envelopes.ts"
import type { ServerAuthorizationData } from "../../types.ts"

/**
 * Configuration for creating a co-signed payment
 */
export interface CoSignedPaymentConfig {
  /** Smart account address (payment sender) */
  smartAccountAddress: Address
  /** Session key private key for signing */
  sessionKeyPrivateKey: Hex
  /** Chain ID for the blockchain network */
  chainId: number
  /** CoSignerValidator address */
  coSignerValidatorAddress: Address
}

/**
 * Encode a co-signed ERC-1271 signature
 *
 * Combines agent signature + server signature according to CoSignerValidator format:
 * 1. Sign typed data with agent key (raw ECDSA)
 * 2. Combine: abi.encode(agentSig, serverSig)
 * 3. Wrap for ERC-1271: encodePacked(validatorAddress, combined)
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
 * Sign a co-signed "exact" instruction into a PaymentAuthorization envelope.
 *
 * The server provides ERC-3009 authorization data + its signature. The agent
 * key adds its signature; the two combine for ERC-1271 validation via
 * CoSignerValidator. The signed body is wrapped in a v1 or v2 envelope
 * depending on the input instruction's protocol.
 */
export async function createCoSignedPayment(
  instruction: PaymentInstruction,
  config: CoSignedPaymentConfig,
  serverAuthorization: ServerAuthorizationData,
): Promise<PaymentAuthorization> {
  const { authorizationData, serverSignature } = serverAuthorization

  const extra = instruction.data.extra
  const domainName = extra?.name as string | undefined
  const domainVersion = extra?.version as string | undefined

  if (!domainName || !domainVersion) {
    throw new Error("instruction.data.extra must contain 'name' and 'version' for EIP-712 domain")
  }

  const typedData: TypedDataDefinition = {
    domain: {
      name: domainName,
      version: domainVersion,
      chainId: config.chainId,
      verifyingContract: instruction.data.asset as Address,
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

  if (instruction.protocol === "x402-v1") {
    // x402/types uses a narrow network enum; @x402/core/schemas is looser.
    // Runtime values agree; cast at the boundary.
    return {
      protocol: "x402-v1",
      data: {
        x402Version: 1,
        scheme: "exact",
        network: instruction.data.network as V1PaymentPayload["network"],
        payload: signedPayload,
      },
    }
  }

  return {
    protocol: "x402-v2",
    data: {
      x402Version: 2,
      resource: instruction.resource,
      accepted: instruction.data,
      payload: signedPayload,
    },
  }
}
