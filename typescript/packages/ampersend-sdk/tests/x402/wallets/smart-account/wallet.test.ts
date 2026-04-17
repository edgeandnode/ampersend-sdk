import { SmartAccountWallet, type SmartAccountConfig } from "@/x402/wallets/smart-account/wallet.ts"
import type { Address, Hex } from "viem"
import { generatePrivateKey } from "viem/accounts"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

describe("SmartAccountWallet", () => {
  const baseConfig: SmartAccountConfig = {
    smartAccountAddress: "0x1111111111111111111111111111111111111111" as Address,
    sessionKeyPrivateKey: generatePrivateKey() as Hex,
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
        protocol: "x402-v2",
        request: {
          x402Version: 2,
          resource: { url: "test", description: "test", mimeType: "application/json" },
          accepts: [
            {
              scheme: "deferred",
              network: "eip155:84532",
              amount: "1000000",
              asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
              payTo: "0x2222222222222222222222222222222222222222",
              maxTimeoutSeconds: 300,
              extra: {},
            },
          ],
        },
        acceptsIndex: 0,
      }),
    ).rejects.toThrow("Unsupported payment scheme")
  })

  describe("chainId derivation", () => {
    it("signs a v2 instruction; chain id is derived from CAIP-2", async () => {
      const wallet = new SmartAccountWallet(baseConfig)
      const auth = await wallet.createPayment({
        protocol: "x402-v2",
        request: {
          x402Version: 2,
          resource: { url: "https://api.example.com/x" },
          accepts: [
            {
              scheme: "exact",
              network: "eip155:10", // Optimism
              amount: "1000000",
              asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
              payTo: "0x2222222222222222222222222222222222222222",
              maxTimeoutSeconds: 300,
              extra: { name: "USDC", version: "2" },
            },
          ],
        },
        acceptsIndex: 0,
      })
      expect(auth.protocol).toBe("x402-v2")
    })

    it("signs a v1 instruction; chain id is derived from the network name", async () => {
      const wallet = new SmartAccountWallet(baseConfig)
      const auth = await wallet.createPayment({
        protocol: "x402-v1",
        request: {
          x402Version: 1,
          accepts: [
            {
              scheme: "exact",
              network: "base-sepolia",
              maxAmountRequired: "1000000",
              resource: "https://api.example.com/x",
              description: "Test",
              mimeType: "application/json",
              payTo: "0x2222222222222222222222222222222222222222",
              maxTimeoutSeconds: 300,
              asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
              extra: { name: "USDC", version: "2" },
            },
          ],
        },
        acceptsIndex: 0,
      })
      expect(auth.protocol).toBe("x402-v1")
    })

    it("throws when the chain id cannot be derived (non-EVM v2 namespace)", async () => {
      const wallet = new SmartAccountWallet(baseConfig)
      await expect(
        wallet.createPayment({
          protocol: "x402-v2",
          request: {
            x402Version: 2,
            resource: { url: "https://api.example.com/x" },
            accepts: [
              {
                scheme: "exact",
                network: "solana:mainnet" as never,
                amount: "1000000",
                asset: "So11111111111111111111111111111111111111112",
                payTo: "0x2222222222222222222222222222222222222222",
                maxTimeoutSeconds: 300,
                extra: { name: "USDC", version: "2" },
              },
            ],
          },
          acceptsIndex: 0,
        }),
      ).rejects.toThrow(/Unsupported network/)
    })

    it("throws when the v1 network name is unknown", async () => {
      const wallet = new SmartAccountWallet(baseConfig)
      await expect(
        wallet.createPayment({
          protocol: "x402-v1",
          request: {
            x402Version: 1,
            accepts: [
              {
                scheme: "exact",
                network: "not-a-real-chain",
                maxAmountRequired: "1000000",
                resource: "https://api.example.com/x",
                description: "Test",
                mimeType: "application/json",
                payTo: "0x2222222222222222222222222222222222222222",
                maxTimeoutSeconds: 300,
                asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
                extra: { name: "USDC", version: "2" },
              },
            ],
          },
          acceptsIndex: 0,
        }),
      ).rejects.toThrow(/Unsupported network/)
    })
  })

  describe("authorization timestamps", () => {
    const PINNED_UNIX_SECONDS = 1_700_000_000
    const CLOCK_SKEW_BACKDATE_SECONDS = 600
    const maxTimeoutSeconds = 300

    beforeEach(() => {
      vi.useFakeTimers()
      vi.setSystemTime(PINNED_UNIX_SECONDS * 1000)
    })
    afterEach(() => {
      vi.useRealTimers()
    })

    it("derives validAfter and validBefore from a single clock read", async () => {
      const wallet = new SmartAccountWallet(baseConfig)
      const auth = await wallet.createPayment({
        protocol: "x402-v1",
        request: {
          x402Version: 1,
          accepts: [
            {
              scheme: "exact",
              network: "base-sepolia",
              maxAmountRequired: "1000000",
              resource: "https://api.example.com/x",
              description: "Test",
              mimeType: "application/json",
              payTo: "0x2222222222222222222222222222222222222222",
              maxTimeoutSeconds,
              asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
              extra: { name: "USDC", version: "2" },
            },
          ],
        },
        acceptsIndex: 0,
      })

      if (auth.protocol !== "x402-v1") throw new Error("expected v1")
      const inner = auth.data.payload as { authorization: Record<string, string> }
      expect(inner.authorization.validAfter).toBe(String(PINNED_UNIX_SECONDS - CLOCK_SKEW_BACKDATE_SECONDS))
      expect(inner.authorization.validBefore).toBe(String(PINNED_UNIX_SECONDS + maxTimeoutSeconds))
    })
  })
})
