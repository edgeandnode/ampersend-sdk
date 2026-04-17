import { SmartAccountWallet, type SmartAccountConfig } from "@/x402/wallets/smart-account/wallet.ts"
import type { Address, Hex } from "viem"
import { generatePrivateKey } from "viem/accounts"
import { describe, expect, it } from "vitest"

describe("SmartAccountWallet", () => {
  const baseConfig: SmartAccountConfig = {
    smartAccountAddress: "0x1111111111111111111111111111111111111111" as Address,
    sessionKeyPrivateKey: generatePrivateKey() as Hex,
    chainId: 84532,
  }

  it("should default validatorAddress to OWNABLE_VALIDATOR", () => {
    const wallet = new SmartAccountWallet(baseConfig)
    expect(wallet.address).toBe(baseConfig.smartAccountAddress)
  })

  it("should default coSignerValidatorAddress to COSIGNER_VALIDATOR", () => {
    const wallet = new SmartAccountWallet(baseConfig)
    expect(wallet.address).toBe(baseConfig.smartAccountAddress)
  })

  it("should use provided coSignerValidatorAddress when given", () => {
    const customValidator = "0x9999999999999999999999999999999999999999" as Address
    const wallet = new SmartAccountWallet({
      ...baseConfig,
      coSignerValidatorAddress: customValidator,
    })
    expect(wallet.address).toBe(baseConfig.smartAccountAddress)
  })

  it("should reject unsupported payment schemes", async () => {
    const wallet = new SmartAccountWallet(baseConfig)
    await expect(
      wallet.createPayment({
        scheme: "deferred",
        network: "eip155:84532",
        amount: "1000000",
        asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
        payTo: "0x2222222222222222222222222222222222222222",
        maxTimeoutSeconds: 300,
        resource: { url: "test", description: "test", mimeType: "application/json" },
        extra: {},
      }),
    ).rejects.toThrow("Unsupported payment scheme")
  })
})
