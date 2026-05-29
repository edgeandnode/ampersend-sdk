import { ApiClient } from "@/ampersend/client.ts"
import { VERSION } from "@/version.ts"
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const sessionKey = generatePrivateKey()
const agentAddress = privateKeyToAccount(sessionKey).address

function clientHeaderFromFirstCall(stubFetch: ReturnType<typeof vi.fn>): string | null {
  const init = stubFetch.mock.calls[0]?.[1] as RequestInit | undefined
  return new Headers(init?.headers).get("Ampersend-Client")
}

describe("ApiClient — Ampersend-Client header", () => {
  let stubFetch: ReturnType<typeof vi.fn>

  beforeEach(() => {
    // Fail every request — we only assert on the headers of the first call
    // (the auth-nonce GET), so the request never needs to succeed.
    stubFetch = vi.fn().mockResolvedValue(new Response("nope", { status: 500 }))
    vi.stubGlobal("fetch", stubFetch)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it("defaults to sdk-typescript/<VERSION>", async () => {
    const client = new ApiClient({
      baseUrl: "https://api.test.invalid",
      sessionKeyPrivateKey: sessionKey,
      agentAddress,
    })

    await expect(client.signSiwxChallenge("hello")).rejects.toThrow()

    expect(stubFetch).toHaveBeenCalled()
    expect(clientHeaderFromFirstCall(stubFetch)).toBe(`sdk-typescript/${VERSION}`)
  })

  it("uses a caller-supplied clientName (e.g. the ampersend CLI)", async () => {
    const client = new ApiClient({
      baseUrl: "https://api.test.invalid",
      sessionKeyPrivateKey: sessionKey,
      agentAddress,
      clientName: "ampersend-cli",
    })

    await expect(client.signSiwxChallenge("hello")).rejects.toThrow()

    expect(clientHeaderFromFirstCall(stubFetch)).toBe(`ampersend-cli/${VERSION}`)
  })
})
