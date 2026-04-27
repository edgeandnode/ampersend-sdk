import { AccountWallet } from "@/x402/wallets/account/wallet.ts"
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts"
import { describe, expect, it } from "vitest"

const USDC_BASE_SEPOLIA = "0x036CbD53842c5426634e7929541eC2318f3dCF7e"
const PAY_TO = "0x2222222222222222222222222222222222222222"

describe("AccountWallet", () => {
  it("creates a v1 authorization envelope for an EVM `exact` instruction", async () => {
    const wallet = AccountWallet.fromPrivateKey(generatePrivateKey())
    const auth = await wallet.createPayment({
      protocol: "x402-v1",
      request: {
        x402Version: 1,
        accepts: [
          {
            scheme: "exact",
            network: "base-sepolia",
            maxAmountRequired: "1000000",
            resource: "https://api.example.com/resource",
            description: "test",
            mimeType: "application/json",
            payTo: PAY_TO,
            maxTimeoutSeconds: 300,
            asset: USDC_BASE_SEPOLIA,
            extra: { name: "USDC", version: "2" },
          },
        ],
      },
      acceptsIndex: 0,
    })

    expect(auth.protocol).toBe("x402-v1")
    if (auth.protocol !== "x402-v1") return
    expect(auth.data.x402Version).toBe(1)
    expect(auth.data.scheme).toBe("exact")
    expect(auth.data.network).toBe("base-sepolia")
    const inner = auth.data.payload as { signature: string; authorization: Record<string, string> }
    expect(inner.signature).toMatch(/^0x[0-9a-fA-F]+$/)
    expect(inner.authorization.from.toLowerCase()).toBe(wallet.address.toLowerCase())
    expect(inner.authorization.to).toBe(PAY_TO)
    expect(inner.authorization.value).toBe("1000000")
    expect(inner.authorization.nonce).toMatch(/^0x[0-9a-fA-F]{64}$/)
  })

  it("creates a v2 authorization envelope (echoes resource and accepted verbatim)", async () => {
    const wallet = AccountWallet.fromPrivateKey(generatePrivateKey())
    const accepted = {
      scheme: "exact",
      network: "eip155:84532",
      amount: "1000000",
      asset: USDC_BASE_SEPOLIA,
      payTo: PAY_TO,
      maxTimeoutSeconds: 300,
      extra: { name: "USDC", version: "2" },
    }
    const resource = {
      url: "https://api.example.com/resource",
      description: "Test resource",
      mimeType: "application/json",
    }
    const auth = await wallet.createPayment({
      protocol: "x402-v2",
      request: {
        x402Version: 2,
        resource,
        accepts: [accepted],
      },
      acceptsIndex: 0,
    })

    expect(auth.protocol).toBe("x402-v2")
    if (auth.protocol !== "x402-v2") return
    expect(auth.data.x402Version).toBe(2)
    // v2 echoes are byte-exact, per spec §5.1.3.
    expect(auth.data.resource).toEqual(resource)
    expect(auth.data.accepted).toEqual(accepted)
    const inner = auth.data.payload as { signature: string; authorization: Record<string, string> }
    expect(inner.authorization.value).toBe("1000000")
    expect(inner.authorization.to).toBe(PAY_TO)
  })

  it("signs v1 and v2 identically when asset/chain/terms match (protocol differs only in envelope)", async () => {
    const privateKey = generatePrivateKey()
    const wallet = AccountWallet.fromPrivateKey(privateKey)
    const account = privateKeyToAccount(privateKey)
    expect(wallet.address).toBe(account.address)

    // Pin time so nonces differ but validAfter/validBefore coincide.
    const nowSec = 1_700_000_000
    const realDateNow = Date.now
    Date.now = () => nowSec * 1000
    try {
      const v1Auth = await wallet.createPayment({
        protocol: "x402-v1",
        request: {
          x402Version: 1,
          accepts: [
            {
              scheme: "exact",
              network: "base-sepolia",
              maxAmountRequired: "1000000",
              resource: "https://api.example.com/resource",
              description: "test",
              mimeType: "application/json",
              payTo: PAY_TO,
              maxTimeoutSeconds: 300,
              asset: USDC_BASE_SEPOLIA,
              extra: { name: "USDC", version: "2" },
            },
          ],
        },
        acceptsIndex: 0,
      })
      const v2Auth = await wallet.createPayment({
        protocol: "x402-v2",
        request: {
          x402Version: 2,
          resource: { url: "https://api.example.com/resource" },
          accepts: [
            {
              scheme: "exact",
              network: "eip155:84532",
              amount: "1000000",
              asset: USDC_BASE_SEPOLIA,
              payTo: PAY_TO,
              maxTimeoutSeconds: 300,
              extra: { name: "USDC", version: "2" },
            },
          ],
        },
        acceptsIndex: 0,
      })
      if (v1Auth.protocol !== "x402-v1" || v2Auth.protocol !== "x402-v2") throw new Error("unreachable")
      const v1Body = v1Auth.data.payload as { authorization: Record<string, string> }
      const v2Body = v2Auth.data.payload as { authorization: Record<string, string> }
      expect(v1Body.authorization.validAfter).toBe(v2Body.authorization.validAfter)
      expect(v1Body.authorization.validBefore).toBe(v2Body.authorization.validBefore)
      // Nonces differ (random); everything else about the signed authorization matches.
      expect(v1Body.authorization.from).toBe(v2Body.authorization.from)
      expect(v1Body.authorization.to).toBe(v2Body.authorization.to)
      expect(v1Body.authorization.value).toBe(v2Body.authorization.value)
    } finally {
      Date.now = realDateNow
    }
  })

  it("rejects unsupported payment schemes", async () => {
    const wallet = AccountWallet.fromPrivateKey(generatePrivateKey())
    await expect(
      wallet.createPayment({
        protocol: "x402-v1",
        request: {
          x402Version: 1,
          accepts: [
            {
              scheme: "deferred",
              network: "base-sepolia",
              maxAmountRequired: "1000000",
              resource: "test",
              description: "test",
              mimeType: "application/json",
              payTo: PAY_TO,
              maxTimeoutSeconds: 300,
              asset: USDC_BASE_SEPOLIA,
              extra: { name: "USDC", version: "2" },
            },
          ],
        },
        acceptsIndex: 0,
      }),
    ).rejects.toThrow("Unsupported payment scheme")
  })

  it("rejects v2 non-EVM networks", async () => {
    const wallet = AccountWallet.fromPrivateKey(generatePrivateKey())
    await expect(
      wallet.createPayment({
        protocol: "x402-v2",
        request: {
          x402Version: 2,
          resource: { url: "https://api.example.com/resource" },
          accepts: [
            {
              scheme: "exact",
              network: "solana:mainnet",
              amount: "1000000",
              asset: "So11111111111111111111111111111111111111112",
              payTo: PAY_TO,
              maxTimeoutSeconds: 300,
              extra: { name: "USDC", version: "2" },
            },
          ],
        },
        acceptsIndex: 0,
      }),
    ).rejects.toThrow(/solana:mainnet/i)
  })

  it("rejects v1 networks upstream doesn't know", async () => {
    const wallet = AccountWallet.fromPrivateKey(generatePrivateKey())
    await expect(
      wallet.createPayment({
        protocol: "x402-v1",
        request: {
          x402Version: 1,
          accepts: [
            {
              scheme: "exact",
              network: "totally-made-up-chain",
              maxAmountRequired: "1000000",
              resource: "test",
              description: "test",
              mimeType: "application/json",
              payTo: PAY_TO,
              maxTimeoutSeconds: 300,
              asset: USDC_BASE_SEPOLIA,
              extra: { name: "USDC", version: "2" },
            },
          ],
        },
        acceptsIndex: 0,
      }),
    ).rejects.toThrow(/totally-made-up-chain/)
  })

  it("rejects co-signed authorizations — EOAs can't produce ERC-1271 co-signatures", async () => {
    const wallet = AccountWallet.fromPrivateKey(generatePrivateKey())
    const serverAuthorization = {
      authorizationData: {
        from: "0x1111111111111111111111111111111111111111",
        to: PAY_TO,
        value: "1000000",
        validAfter: "0",
        validBefore: "9999999999",
        nonce: "0x" + "0".repeat(64),
      },
      serverSignature: "0x" + "a".repeat(130),
    }
    await expect(
      wallet.createPayment(
        {
          protocol: "x402-v1",
          request: {
            x402Version: 1,
            accepts: [
              {
                scheme: "exact",
                network: "base-sepolia",
                maxAmountRequired: "1000000",
                resource: "test",
                description: "test",
                mimeType: "application/json",
                payTo: PAY_TO,
                maxTimeoutSeconds: 300,
                asset: USDC_BASE_SEPOLIA,
                extra: { name: "USDC", version: "2" },
              },
            ],
          },
          acceptsIndex: 0,
        },
        serverAuthorization,
      ),
    ).rejects.toThrow(/co-signed/i)
  })
})
