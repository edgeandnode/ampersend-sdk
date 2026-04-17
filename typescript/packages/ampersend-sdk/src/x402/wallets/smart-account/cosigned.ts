import { encodeAbiParameters, encodePacked, type Address, type Hex, type TypedDataDefinition } from "viem"
import { privateKeyToAccount } from "viem/accounts"

import { TRANSFER_WITH_AUTHORIZATION_TYPE } from "../../../smart-account/eip712-types.ts"
import type { PaymentAuthorization, PaymentOption } from "../../canonical.ts"
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
 *
 * @param agentPrivateKey - Agent's session key private key
 * @param typedDataParams - EIP-712 typed data to sign
 * @param serverSignature - Server's ECDSA signature (65 bytes as hex)
 * @param coSignerValidatorAddress - CoSignerValidator contract address
 * @returns ERC-1271 formatted signature
 */
export async function encodeCoSignedERC1271Signature(
  agentPrivateKey: Hex,
  typedDataParams: TypedDataDefinition,
  serverSignature: Hex,
  coSignerValidatorAddress: Address,
): Promise<Hex> {
  // 1. Sign with agent key
  const agentAccount = privateKeyToAccount(agentPrivateKey)
  const agentSignature = await agentAccount.signTypedData(typedDataParams)

  // 2. Combine signatures: abi.encode(bytes agentSig, bytes serverSig)
  const combinedSignature = encodeAbiParameters(
    [{ type: "bytes" }, { type: "bytes" }],
    [agentSignature, serverSignature],
  )

  // 3. Encode for ERC-1271: encodePacked(address validator, bytes signature)
  return encodePacked(["address", "bytes"], [coSignerValidatorAddress, combinedSignature])
}

/**
 * Creates a canonical signed payment authorization using server co-signature.
 *
 * Used for co-signed agent keys where the server provides the ERC-3009
 * authorization data and its own signature. The agent key adds its signature
 * and the two are combined for ERC-1271 validation via CoSignerValidator.
 *
 * @param option - Canonical payment option
 * @param config - Smart account signing configuration
 * @param serverAuthorization - Server-provided authorization data and co-signature
 * @returns Canonical signed payment authorization
 */
export async function createCoSignedPayment(
  option: PaymentOption,
  config: CoSignedPaymentConfig,
  serverAuthorization: ServerAuthorizationData,
): Promise<PaymentAuthorization> {
  const { authorizationData, serverSignature } = serverAuthorization

  // Get EIP-712 domain params from the option's scheme-specific metadata
  const domainName = option.extra?.name as string | undefined
  const domainVersion = option.extra?.version as string | undefined

  if (!domainName || !domainVersion) {
    throw new Error("option.extra must contain 'name' and 'version' for EIP-712 domain")
  }

  // Construct EIP-712 typed data from server-provided authorization data
  const typedData: TypedDataDefinition = {
    domain: {
      name: domainName,
      version: domainVersion,
      chainId: config.chainId,
      verifyingContract: option.asset as Address,
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

  // Encode co-signed signature
  const signature = await encodeCoSignedERC1271Signature(
    config.sessionKeyPrivateKey,
    typedData,
    serverSignature as Hex,
    config.coSignerValidatorAddress,
  )

  return {
    scheme: option.scheme,
    network: option.network,
    body: {
      signature: signature as string,
      authorization: {
        from: authorizationData.from,
        to: authorizationData.to,
        value: authorizationData.value,
        validAfter: authorizationData.validAfter,
        validBefore: authorizationData.validBefore,
        nonce: authorizationData.nonce,
      },
    },
  }
}
