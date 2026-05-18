import { COSIGNER_VALIDATOR } from "@/smart-account/constants.ts"
import { createSiwxSigner } from "@/x402/siwx.ts"
import { decodeAbiParameters, hashMessage, recoverAddress, type Address, type Hex } from "viem"
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts"
import { beforeEach, describe, expect, it, vi } from "vitest"

const { signSiwxChallenge } = vi.hoisted(() => ({
  signSiwxChallenge: vi.fn<(message: string) => Promise<{ serverSignature: Hex }>>(),
}))

vi.mock("@/ampersend/client.ts", () => ({
  ApiClient: class {
    signSiwxChallenge = signSiwxChallenge
  },
}))

describe("createSiwxSigner", () => {
  const validatorAddress = COSIGNER_VALIDATOR as Address
  const smartAccountAddress = "0x1111111111111111111111111111111111111111" as Address

  const sessionKey = generatePrivateKey()
  const sessionKeyAccount = privateKeyToAccount(sessionKey)
  const serverAccount = privateKeyToAccount(generatePrivateKey())

  const message = "example.com wants you to sign in with your Ethereum account:\n0x...\n\nNonce: abc123"

  beforeEach(() => {
    signSiwxChallenge.mockReset()
  })

  it("packs the agent + server signatures into a CoSignerValidator envelope", async () => {
    const expectedHash = hashMessage(message)
    const serverSignature = await serverAccount.sign({ hash: expectedHash })
    signSiwxChallenge.mockResolvedValue({ serverSignature })

    const signer = createSiwxSigner({
      smartAccountAddress,
      sessionKeyPrivateKey: sessionKey,
      apiUrl: "http://test.invalid",
    })

    const result = (await signer.signMessage({ message })) as Hex

    expect(result.toLowerCase().startsWith("0x" + validatorAddress.slice(2).toLowerCase())).toBe(true)

    const combinedHex = ("0x" + result.slice(2 + 40)) as Hex
    const [decodedAgentSig, decodedServerSig] = decodeAbiParameters([{ type: "bytes" }, { type: "bytes" }], combinedHex)

    expect(decodedServerSig).toBe(serverSignature)
    expect(decodedAgentSig.length).toBe(65 * 2 + 2)

    // The agent must sign the EIP-191 `hashMessage(message)` digest directly
    // (no further prefixing); CoSignerValidator recovers via ECDSA against
    // exactly this hash.
    const recovered = await recoverAddress({ hash: expectedHash, signature: decodedAgentSig as Hex })
    expect(recovered.toLowerCase()).toBe(sessionKeyAccount.address.toLowerCase())

    expect(signSiwxChallenge).toHaveBeenCalledExactlyOnceWith(message)
  })

  it("honors a custom validatorAddress in the envelope prefix", async () => {
    const customValidator = "0x4242424242424242424242424242424242424242" as Address
    const serverSignature = await serverAccount.sign({ hash: hashMessage(message) })
    signSiwxChallenge.mockResolvedValue({ serverSignature })

    const signer = createSiwxSigner({
      smartAccountAddress,
      sessionKeyPrivateKey: sessionKey,
      apiUrl: "http://test.invalid",
      validatorAddress: customValidator,
    })

    const result = (await signer.signMessage({ message })) as Hex
    expect(result.toLowerCase().startsWith("0x" + customValidator.slice(2).toLowerCase())).toBe(true)
  })

  it("rejects non-string SignableMessage shapes", async () => {
    const signer = createSiwxSigner({
      smartAccountAddress,
      sessionKeyPrivateKey: sessionKey,
      apiUrl: "http://test.invalid",
    })

    await expect(signer.signMessage({ message: { raw: "0xdeadbeef" } })).rejects.toThrow(
      /SIWE messages must be strings/,
    )
    expect(signSiwxChallenge).not.toHaveBeenCalled()
  })

  it("exposes the smart account as the signer address", () => {
    const signer = createSiwxSigner({
      smartAccountAddress,
      sessionKeyPrivateKey: sessionKey,
      apiUrl: "http://test.invalid",
    })
    expect(signer.address).toBe(smartAccountAddress)
  })
})
