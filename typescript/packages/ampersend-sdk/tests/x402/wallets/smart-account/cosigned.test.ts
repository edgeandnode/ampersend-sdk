import { COSIGNER_VALIDATOR } from "@/smart-account/constants.ts"
import { TRANSFER_WITH_AUTHORIZATION_TYPE } from "@/smart-account/eip712-types.ts"
import { encodeCoSignedERC1271Signature } from "@/x402/wallets/smart-account/cosigned.ts"
import { decodeAbiParameters, type Address, type Hex } from "viem"
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts"
import { describe, expect, it } from "vitest"

describe("encodeCoSignedERC1271Signature", () => {
  const validatorAddress = COSIGNER_VALIDATOR as Address

  // Deterministic keys for reproducible tests
  const agentPrivateKey = generatePrivateKey()
  const serverAccount = privateKeyToAccount(generatePrivateKey())

  // Minimal EIP-712 typed data for testing
  const typedDataParams = {
    domain: {
      name: "USD Coin",
      version: "2",
      chainId: 84532,
      verifyingContract: "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as Address,
    },
    types: { TransferWithAuthorization: TRANSFER_WITH_AUTHORIZATION_TYPE },
    primaryType: "TransferWithAuthorization" as const,
    message: {
      from: "0x1111111111111111111111111111111111111111" as Address,
      to: "0x2222222222222222222222222222222222222222" as Address,
      value: 1000000n,
      validAfter: 0n,
      validBefore: 9999999999n,
      nonce: "0x0000000000000000000000000000000000000000000000000000000000000001" as Hex,
    },
  }

  it("should produce a signature prefixed with the validator address", async () => {
    const serverSignature = await serverAccount.signTypedData(typedDataParams)

    const result = await encodeCoSignedERC1271Signature(
      agentPrivateKey,
      typedDataParams,
      serverSignature,
      validatorAddress,
    )

    // Result should start with the validator address (20 bytes = 40 hex chars + 0x prefix)
    expect(result.toLowerCase().startsWith("0x" + validatorAddress.slice(2).toLowerCase())).toBe(true)
  })

  it("should contain both agent and server signatures ABI-encoded", async () => {
    const serverSignature = await serverAccount.signTypedData(typedDataParams)

    const result = await encodeCoSignedERC1271Signature(
      agentPrivateKey,
      typedDataParams,
      serverSignature,
      validatorAddress,
    )

    // Strip the 20-byte validator address prefix to get the ABI-encoded combined signature
    const combinedHex = ("0x" + result.slice(2 + 40)) as Hex

    // Decode as (bytes, bytes)
    const [decodedAgentSig, decodedServerSig] = decodeAbiParameters([{ type: "bytes" }, { type: "bytes" }], combinedHex)

    // Both signatures should be 65 bytes (ECDSA r + s + v)
    expect(decodedAgentSig.length).toBe(65 * 2 + 2) // hex string: 0x + 130 chars
    expect(decodedServerSig).toBe(serverSignature)
  })
})
