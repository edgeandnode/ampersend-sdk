import { encodeAbiParameters, encodePacked, type Address, type Hex, type TypedDataDefinition } from "viem"
import { privateKeyToAccount } from "viem/accounts"
import type { PaymentPayload, PaymentRequirements } from "x402/types"

import type { ServerAuthorizationData } from "../../../ampersend/types.ts"

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
 * Creates a payment payload using server co-signature
 *
 * This is used for co-signed agent keys where the server provides the ERC-3009
 * authorization data and co-signature. The agent key adds its signature and
 * combines them for ERC-1271 validation via CoSignerValidator.
 *
 * @param requirements - Payment requirements from the x402 server
 * @param config - Configuration for the smart account wallet
 * @param serverAuthorization - Server-provided authorization data and co-signature
 * @returns Payment payload ready to send to x402 server
 * @throws Error if requirements are invalid or signing fails
 */
export async function createCoSignedPayment(
  requirements: PaymentRequirements,
  config: CoSignedPaymentConfig,
  serverAuthorization: ServerAuthorizationData,
): Promise<PaymentPayload> {
  const { authorizationData, serverSignature } = serverAuthorization

  // Get domain params from requirements.extra
  const domainName = requirements.extra?.name as string | undefined
  const domainVersion = requirements.extra?.version as string | undefined

  if (!domainName || !domainVersion) {
    throw new Error("requirements.extra must contain 'name' and 'version' for EIP-712 domain")
  }

  // Construct EIP-712 typed data from server-provided authorization data
  const typedData: TypedDataDefinition = {
    domain: {
      name: domainName,
      version: domainVersion,
      chainId: config.chainId,
      verifyingContract: requirements.asset as Address,
    },
    types: {
      TransferWithAuthorization: [
        { name: "from", type: "address" },
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
        { name: "validAfter", type: "uint256" },
        { name: "validBefore", type: "uint256" },
        { name: "nonce", type: "bytes32" },
      ],
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

  // Construct payment payload matching x402 exact scheme format
  const paymentPayload: PaymentPayload = {
    x402Version: 1,
    scheme: "exact" as const,
    network: requirements.network,
    payload: {
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

  return paymentPayload
}
