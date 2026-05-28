import { existsSync, rmSync } from "node:fs"
import { join } from "node:path"

import {
  executeDetails,
  executeIssue,
  executeList,
  maskCard,
  maskPan,
  toCardView,
  tokenExpiry,
  validateAmount,
} from "@/cli/commands/card.ts"
import { setConfig, storeLasoToken } from "@/cli/config.ts"
import { generatePrivateKey, privateKeyToAddress } from "viem/accounts"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Build a `/get-card-data` card record in Laso's real wire shape: secrets
 * nested under `card_details`, expiry split into `exp_month`/`exp_year`,
 * order time as a Unix-ms `timestamp`, and a transaction history.
 */
function lasoCard(over: {
  card_id?: string
  status?: string
  usd_amount?: number
  available_balance?: number
  ready?: boolean
}): Record<string, unknown> {
  const base: Record<string, unknown> = {
    card_id: over.card_id ?? "c1",
    status: over.status ?? (over.ready ? "ready" : "pending"),
    usd_amount: over.usd_amount ?? 5,
    card_type: "Non-Reloadable U.S.",
    timestamp: 1773258624676, // 2026-03-11T19:50:24.676Z
  }
  if (over.ready) {
    base.card_details = {
      card_number: "4242424242424242",
      exp_month: "08",
      exp_year: "29",
      cvv: "123",
      available_balance: over.available_balance ?? over.usd_amount ?? 5,
    }
    base.transactions = [{ amount: "$5.00", date: "3/11/26, 3:50 PM", description: "wegiftusd - 1", is_credit: true }]
  }
  return base
}

// Reuse the homedir-mocking convention from config.test.ts so the on-disk
// token cache reads/writes land in a throwaway dir.
const TEMP_DIR = join(process.env.TMPDIR ?? "/tmp", "ampersend-card-test")

vi.mock("node:os", () => ({
  homedir: () => join(process.env.TMPDIR ?? "/tmp", "ampersend-card-test"),
  tmpdir: () => join(process.env.TMPDIR ?? "/tmp", "ampersend-card-test"),
}))

class ExitError extends Error {
  constructor(public code: number) {
    super(`process.exit(${code})`)
  }
}

describe("CLI Card Helpers", () => {
  describe("validateAmount", () => {
    it("rejects missing amount", () => {
      const r = validateAmount(undefined)
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.error.code).toBe("INVALID_ARGS")
    })

    it("rejects non-numeric amount", () => {
      const r = validateAmount("abc")
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.error.code).toBe("INVALID_ARGS")
    })

    it("rejects below-minimum amount", () => {
      const r = validateAmount("1")
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.error.code).toBe("CARD_AMOUNT_OUT_OF_RANGE")
    })

    it("rejects above-maximum amount", () => {
      const r = validateAmount("5000")
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.error.code).toBe("CARD_AMOUNT_OUT_OF_RANGE")
    })

    it("accepts an in-range amount and returns it trimmed", () => {
      const r = validateAmount("  25  ")
      expect(r.ok).toBe(true)
      if (r.ok) expect(r.data).toBe("25")
    })

    it("accepts the boundary values", () => {
      expect(validateAmount("5").ok).toBe(true)
      expect(validateAmount("1000").ok).toBe(true)
    })
  })

  describe("maskPan", () => {
    it("shows only the last four digits in groups", () => {
      expect(maskPan("4242424242424242")).toBe("•••• •••• •••• 4242")
    })

    it("tolerates spaces and dashes in the input", () => {
      expect(maskPan("4242 4242-4242 4242")).toBe("•••• •••• •••• 4242")
    })
  })

  describe("maskCard", () => {
    const ready = { card_id: "c1", status: "ready", pan: "4242424242424242", cvv: "123", expiry: "08/29" }

    it("masks PAN and CVV but shows expiry by default", () => {
      const masked = maskCard(ready, false)
      expect(masked.pan).toBe("•••• •••• •••• 4242")
      expect(masked.cvv).toBe("•••")
      expect(masked.expiry).toBe("08/29")
    })

    it("reveals everything with reveal=true", () => {
      const revealed = maskCard(ready, true)
      expect(revealed.pan).toBe("4242424242424242")
      expect(revealed.cvv).toBe("123")
      expect(revealed.expiry).toBe("08/29")
    })

    it("leaves a pending card (no secrets) untouched", () => {
      const pending = { card_id: "c1", status: "pending" }
      const masked = maskCard(pending, false)
      expect(masked).toEqual({ card_id: "c1", status: "pending" })
    })
  })

  describe("toCardView", () => {
    it("flattens card_details, composes expiry, surfaces balance/card_type/ordered_at", () => {
      const view = toCardView({
        card_id: "c1",
        status: "ready",
        usd_amount: 5,
        card_type: "Non-Reloadable U.S.",
        timestamp: 1773258624676,
        card_details: {
          card_number: "4242424242424242",
          exp_month: "09",
          exp_year: "26",
          cvv: "563",
          available_balance: 3.2,
        },
      })
      expect(view).toEqual({
        card_id: "c1",
        status: "ready",
        amount: 5,
        balance: 3.2,
        card_type: "Non-Reloadable U.S.",
        ordered_at: "2026-03-11T19:50:24.676Z",
        pan: "4242424242424242",
        cvv: "563",
        expiry: "09/26",
      })
    })

    it("omits secrets, balance, and transactions when card_details is absent (pending card)", () => {
      const view = toCardView({ card_id: "c1", status: "pending", usd_amount: 5 }, true)
      expect(view).toEqual({ card_id: "c1", status: "pending", amount: 5 })
    })

    it("includes transactions only when asked", () => {
      const card = {
        card_id: "c1",
        status: "ready",
        usd_amount: 5,
        card_details: {
          card_number: "4242424242424242",
          exp_month: "09",
          exp_year: "26",
          cvv: "563",
          available_balance: 5,
        },
        transactions: [{ amount: "$5.00", date: "x", description: "load", is_credit: true }],
      }
      expect(toCardView(card, false).transactions).toBeUndefined()
      expect(toCardView(card, true).transactions).toEqual([
        { amount: "$5.00", date: "x", description: "load", is_credit: true },
      ])
    })
  })

  describe("tokenExpiry", () => {
    it("uses expires_in seconds when present", () => {
      const before = Date.now()
      const expiry = new Date(tokenExpiry(120)).getTime()
      expect(expiry).toBeGreaterThanOrEqual(before + 120_000)
      expect(expiry).toBeLessThanOrEqual(Date.now() + 120_000 + 1000)
    })

    it("falls back to one hour when expires_in is absent", () => {
      const expiry = new Date(tokenExpiry(undefined)).getTime()
      expect(expiry).toBeGreaterThan(Date.now() + 59 * 60_000)
    })
  })
})

describe("CLI Card Behavior", () => {
  const configDir = join(TEMP_DIR, ".ampersend")
  const agentKey = generatePrivateKey()
  const agentAccount = privateKeyToAddress(generatePrivateKey())

  let consoleOutput: Array<string> = []
  let fetchSpy: ReturnType<typeof vi.fn>
  let mockConsoleLog: ReturnType<typeof vi.spyOn>
  let mockConsoleError: ReturnType<typeof vi.spyOn>
  let mockExit: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    if (existsSync(configDir)) rmSync(configDir, { recursive: true })
    // File credentials so requireCredentials/readLasoToken share one identity.
    setConfig(`${agentKey}:::${agentAccount}`)

    consoleOutput = []
    fetchSpy = vi.fn()
    vi.stubGlobal("fetch", fetchSpy)
    mockConsoleLog = vi.spyOn(console, "log").mockImplementation((...args: Array<unknown>) => {
      consoleOutput.push(args.map(String).join(" "))
    })
    mockConsoleError = vi.spyOn(console, "error").mockImplementation(() => {})
    mockExit = vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new ExitError(code as number)
    })
  })

  afterEach(() => {
    if (existsSync(configDir)) rmSync(configDir, { recursive: true })
    vi.unstubAllGlobals()
    mockConsoleLog.mockRestore()
    mockConsoleError.mockRestore()
    mockExit.mockRestore()
  })

  function lastJsonOutput(): Record<string, unknown> {
    const last = consoleOutput[consoleOutput.length - 1]
    if (last === undefined) throw new Error("no console.log output captured")
    return JSON.parse(last) as Record<string, unknown>
  }

  /** Seed a warm, valid token for the active (file) identity. */
  function seedToken(): void {
    storeLasoToken({
      idToken: "warm-token",
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      agentKey,
    })
  }

  describe("details — token gating", () => {
    it("returns TOKEN_REQUIRED on a cold cache without --pay (no spend)", async () => {
      await executeDetails("card_1", { pay: false, reveal: false, raw: false })

      const envelope = lastJsonOutput()
      expect(envelope.ok).toBe(false)
      expect((envelope.error as { code: string }).code).toBe("TOKEN_REQUIRED")
      // Returned before any outbound request.
      expect(fetchSpy).not.toHaveBeenCalled()
    })

    it("reads with a warm token and emits no payment receipt", async () => {
      seedToken()
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify(lasoCard({ card_id: "card_1", ready: true })), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )

      await executeDetails("card_1", { pay: false, reveal: false, raw: false })

      const envelope = lastJsonOutput()
      expect(envelope.ok).toBe(true)
      const data = envelope.data as Record<string, unknown>
      expect(data.pan).toBe("•••• •••• •••• 4242")
      expect(data.cvv).toBe("•••")
      expect(data.expiry).toBe("08/29")
      // Enrichment: balance (== amount here → unused), card_type, ordered_at, transactions.
      expect(data.amount).toBe(5)
      expect(data.balance).toBe(5)
      expect(data.card_type).toBe("Non-Reloadable U.S.")
      expect(data.ordered_at).toBe("2026-03-11T19:50:24.676Z")
      expect(data.transactions).toHaveLength(1)
      expect(data).not.toHaveProperty("payment")
      // The Bearer was sent.
      const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
      expect((init.headers as Record<string, string>).authorization).toBe("Bearer warm-token")
    })

    it("reveals full secrets with --reveal", async () => {
      seedToken()
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify(lasoCard({ card_id: "card_1", ready: true })), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )

      await executeDetails("card_1", { pay: false, reveal: true, raw: false })

      const data = lastJsonOutput().data as Record<string, unknown>
      expect(data.pan).toBe("4242424242424242")
      expect(data.cvv).toBe("123")
      expect(data.expiry).toBe("08/29")
    })

    it("returns ok:true status:pending (not an error) for a still-provisioning card", async () => {
      seedToken()
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify(lasoCard({ card_id: "card_1", ready: false })), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )

      await executeDetails("card_1", { pay: false, reveal: false, raw: false })

      const envelope = lastJsonOutput()
      expect(envelope.ok).toBe(true)
      const data = envelope.data as Record<string, unknown>
      expect(data.status).toBe("pending")
      expect(data).not.toHaveProperty("pan")
    })

    it("maps a 404 to CARD_NOT_FOUND", async () => {
      seedToken()
      fetchSpy.mockResolvedValueOnce(new Response("", { status: 404 }))

      await executeDetails("missing", { pay: false, reveal: false, raw: false })

      const envelope = lastJsonOutput()
      expect(envelope.ok).toBe(false)
      expect((envelope.error as { code: string }).code).toBe("CARD_NOT_FOUND")
    })
  })

  describe("list", () => {
    it("returns TOKEN_REQUIRED on a cold cache without --pay", async () => {
      await executeList({ pay: false, raw: false })

      const envelope = lastJsonOutput()
      expect(envelope.ok).toBe(false)
      expect((envelope.error as { code: string }).code).toBe("TOKEN_REQUIRED")
      expect(fetchSpy).not.toHaveBeenCalled()
    })

    it("lists all cards masked with a warm token", async () => {
      seedToken()
      fetchSpy.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            cards: [lasoCard({ card_id: "c1", ready: true }), lasoCard({ card_id: "c2", ready: false })],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      )

      await executeList({ pay: false, raw: false })

      const data = lastJsonOutput().data as { cards: Array<Record<string, unknown>> }
      expect(data.cards).toHaveLength(2)
      expect(data.cards[0].pan).toBe("•••• •••• •••• 4242")
      expect(data.cards[0].cvv).toBe("•••")
      // list surfaces balance but stays compact — no per-card transactions.
      expect(data.cards[0].balance).toBe(5)
      expect(data.cards[0]).not.toHaveProperty("transactions")
      expect(data.cards[1].status).toBe("pending")
    })

    it("surfaces a reduced balance for a spent card (amount vs balance)", async () => {
      seedToken()
      fetchSpy.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ cards: [lasoCard({ card_id: "c1", ready: true, usd_amount: 5, available_balance: 3.2 })] }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      )

      await executeList({ pay: false, raw: false })

      const card = (lastJsonOutput().data as { cards: Array<Record<string, unknown>> }).cards[0]
      expect(card.amount).toBe(5)
      expect(card.balance).toBe(3.2) // spent = amount - balance = 1.80
    })
  })

  describe("issue — argument validation", () => {
    it("exits 1 with CARD_AMOUNT_OUT_OF_RANGE before any spend", async () => {
      await expect(executeIssue({ amount: "1", raw: false })).rejects.toThrow(ExitError)

      const envelope = lastJsonOutput()
      expect(envelope.ok).toBe(false)
      expect((envelope.error as { code: string }).code).toBe("CARD_AMOUNT_OUT_OF_RANGE")
      expect(fetchSpy).not.toHaveBeenCalled()
    })
  })
})
