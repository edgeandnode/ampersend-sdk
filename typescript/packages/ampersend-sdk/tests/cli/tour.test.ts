import { existsSync, rmSync } from "node:fs"
import { join } from "node:path"

import {
  classifyEnv,
  computeTour,
  computeTrack,
  hasEnvCredentials,
  hydrateFromClient,
  pickTrackContext,
  type Hydration,
} from "@/cli/commands/tour.ts"
import {
  computeApprovalExpiry,
  readConfig,
  setTourMode,
  useContext,
  writeConfig,
  type Context,
  type StoredConfigV2,
} from "@/cli/config.ts"
import { generatePrivateKey } from "viem/accounts"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// Use a unique temp dir to avoid conflicts with other test files
const TEMP_DIR = join(process.env.TMPDIR ?? "/tmp", "ampersend-tour-test")

vi.mock("node:os", () => ({
  homedir: () => join(process.env.TMPDIR ?? "/tmp", "ampersend-tour-test"),
  tmpdir: () => join(process.env.TMPDIR ?? "/tmp", "ampersend-tour-test"),
}))

const SANDBOX_URL = "https://api.sandbox.ampersend.ai"

/** Build a ready context shorthand. */
function readyContext(overrides: Partial<Extract<Context, { status: "ready" }>> = {}): Context {
  return {
    status: "ready",
    agentKey: generatePrivateKey(),
    agentAccount: "0x1111111111111111111111111111111111111111",
    createdAt: "2026-06-01T00:00:00.000Z",
    ...overrides,
  }
}

/** Build a pending context shorthand. */
function pendingContext(overrides: Partial<Extract<Context, { status: "pending" }>> = {}): Context {
  return {
    status: "pending",
    agentKey: generatePrivateKey(),
    token: "t",
    expiresAt: computeApprovalExpiry(),
    createdAt: "2026-06-01T00:00:00.000Z",
    ...overrides,
  }
}

function config(contexts: Record<string, Context>, activeContext?: string): StoredConfigV2 {
  return { version: 2, ...(activeContext ? { activeContext } : {}), contexts }
}

/** Hydrator double that records which contexts were hydrated. */
function fakeHydrate(result: Hydration): {
  calls: Array<string>
  hydrate: (ctx: { agentAccount: string }) => Promise<Hydration>
} {
  const calls: Array<string> = []
  return {
    calls,
    hydrate: (ctx) => {
      calls.push(ctx.agentAccount)
      return Promise.resolve(result)
    },
  }
}

describe("classifyEnv", () => {
  it("treats no URL and the default URL as production", () => {
    expect(classifyEnv(undefined)).toBe("production")
    expect(classifyEnv("https://api.ampersend.ai")).toBe("production")
  })

  it("recognizes the sandbox host", () => {
    expect(classifyEnv(SANDBOX_URL)).toBe("sandbox")
  })

  it("excludes custom and malformed URLs from the tour", () => {
    expect(classifyEnv("https://api.staging.example.com")).toBeNull()
    expect(classifyEnv("not a url")).toBeNull()
  })
})

describe("pickTrackContext", () => {
  it("returns null for an env with no contexts", () => {
    expect(pickTrackContext(config({}), "sandbox")).toBeNull()
    expect(pickTrackContext(config({ prod: readyContext() }), "sandbox")).toBeNull()
  })

  it("prefers the active context even over a newer sibling", () => {
    const cfg = config(
      {
        older: readyContext({ createdAt: "2026-01-01T00:00:00.000Z" }),
        newer: readyContext({ createdAt: "2026-06-01T00:00:00.000Z" }),
      },
      "older",
    )
    const picked = pickTrackContext(cfg, "production")
    expect(picked?.name).toBe("older")
    expect(picked?.isActive).toBe(true)
  })

  it("picks the newest when the active context is in another env", () => {
    const cfg = config(
      {
        sand: readyContext({ apiUrl: SANDBOX_URL }),
        older: readyContext({ createdAt: "2026-01-01T00:00:00.000Z" }),
        newer: readyContext({ createdAt: "2026-06-01T00:00:00.000Z" }),
      },
      "sand",
    )
    const picked = pickTrackContext(cfg, "production")
    expect(picked?.name).toBe("newer")
    expect(picked?.isActive).toBe(false)
  })

  it("breaks createdAt ties alphabetically", () => {
    const cfg = config({
      bravo: readyContext({ createdAt: "2026-06-01T00:00:00.000Z" }),
      alpha: readyContext({ createdAt: "2026-06-01T00:00:00.000Z" }),
    })
    expect(pickTrackContext(cfg, "production")?.name).toBe("alpha")
  })

  it("treats expired pendings as invisible", () => {
    const cfg = config({
      expired: pendingContext({ expiresAt: "2020-01-01T00:00:00.000Z" }),
    })
    expect(pickTrackContext(cfg, "production")).toBeNull()
  })

  it("excludes custom-URL contexts from both tracks", () => {
    const cfg = config({ custom: readyContext({ apiUrl: "https://api.staging.example.com" }) }, "custom")
    expect(pickTrackContext(cfg, "production")).toBeNull()
    expect(pickTrackContext(cfg, "sandbox")).toBeNull()
  })
})

describe("computeTrack", () => {
  it("says setup when the env has no context, without hydrating", async () => {
    const { calls, hydrate } = fakeHydrate({ paid: false, funded: false })
    const track = await computeTrack(config({}), "sandbox", hydrate)
    expect(track.complete).toBe(false)
    expect(track.next).toEqual({ step: "setup", context: null, contextIsActive: false })
    expect(calls).toHaveLength(0)
  })

  it("says finish_setup for an unexpired pending context, without hydrating", async () => {
    const { calls, hydrate } = fakeHydrate({ paid: false, funded: false })
    const track = await computeTrack(config({ p: pendingContext() }, "p"), "production", hydrate)
    expect(track.next?.step).toBe("finish_setup")
    expect(track.next?.context).toBe("p")
    expect(track.next?.contextIsActive).toBe(true)
    expect(calls).toHaveLength(0)
  })

  it("says fund for a ready, unfunded context", async () => {
    const track = await computeTrack(
      config({ r: readyContext() }, "r"),
      "production",
      fakeHydrate({ paid: false, funded: false }).hydrate,
    )
    expect(track.complete).toBe(false)
    expect(track.next).toEqual({ step: "fund", context: "r", contextIsActive: true })
  })

  it("says first_payment for a funded, unpaid context", async () => {
    const track = await computeTrack(
      config({ r: readyContext() }, "r"),
      "production",
      fakeHydrate({ paid: false, funded: true }).hydrate,
    )
    expect(track.next?.step).toBe("first_payment")
  })

  it("marks the track complete once the context has paid", async () => {
    const track = await computeTrack(
      config({ r: readyContext() }, "r"),
      "production",
      fakeHydrate({ paid: true, funded: true }).hydrate,
    )
    expect(track.complete).toBe(true)
    expect(track.next).toBeNull()
  })

  it("flags a non-active working context so the skill can suggest switching", async () => {
    const cfg = config({ sand: readyContext({ apiUrl: SANDBOX_URL }), prod: readyContext() }, "sand")
    const track = await computeTrack(cfg, "production", fakeHydrate({ paid: false, funded: false }).hydrate)
    expect(track.next?.context).toBe("prod")
    expect(track.next?.contextIsActive).toBe(false)
  })
})

describe("computeTour", () => {
  it("handles a missing config: both tracks at setup, mode active", async () => {
    const tour = await computeTour(null, fakeHydrate({ paid: false, funded: false }).hydrate)
    expect(tour.mode).toBe("active")
    expect(tour.sandbox.next?.step).toBe("setup")
    expect(tour.production.next?.step).toBe("setup")
  })

  it("computes both tracks independently and reports the stored mode", async () => {
    const cfg: StoredConfigV2 = {
      ...config({ sand: readyContext({ apiUrl: SANDBOX_URL }) }, "sand"),
      tour: { mode: "skipped" },
    }
    const tour = await computeTour(cfg, fakeHydrate({ paid: true, funded: true }).hydrate)
    expect(tour.mode).toBe("skipped")
    expect(tour.sandbox.complete).toBe(true)
    expect(tour.sandbox.next).toBeNull()
    expect(tour.production.next?.step).toBe("setup")
  })
})

describe("degraded tracks", () => {
  // A hydration failure (e.g. the network is down) must degrade only the track
  // that needs the server — the tour is an orientation tool, so it stays useful
  // for the local part and the other environment rather than faulting whole.
  const failing = () => Promise.reject(new Error("network down"))

  it("degrades a ready track whose server read fails, without throwing", async () => {
    const track = await computeTrack(config({ r: readyContext() }, "r"), "production", failing)
    expect(track.degraded).toBe(true)
    expect(track.complete).toBe(false)
    expect(track.next).toBeNull()
    expect(track.hint.length).toBeGreaterThan(0)
  })

  it("does not hydrate (so cannot degrade) a setup-stage track", async () => {
    const setup = await computeTrack(config({}), "production", failing)
    const finish = await computeTrack(config({ p: pendingContext() }, "p"), "production", failing)
    expect(setup.degraded).toBeUndefined()
    expect(setup.next?.step).toBe("setup")
    expect(finish.degraded).toBeUndefined()
    expect(finish.next?.step).toBe("finish_setup")
  })

  it("degrades only the failing track, leaving the other intact", async () => {
    // sandbox is local-only (setup, no server read); production would hydrate
    // and fail. The whole-tour answer must survive.
    const cfg = config({ prod: readyContext() }, "prod")
    const tour = await computeTour(cfg, failing)
    expect(tour.production.degraded).toBe(true)
    expect(tour.sandbox.degraded).toBeUndefined()
    expect(tour.sandbox.next?.step).toBe("setup")
  })

  it("computeTour resolves rather than rejecting when a track's read fails", async () => {
    const cfg = config({ r: readyContext() }, "r")
    await expect(computeTour(cfg, failing)).resolves.toMatchObject({ mode: "active" })
  })

  it("suppresses the production bridge when production's state is unknown (degraded)", async () => {
    // sandbox complete, production a ready context whose read fails → degraded.
    // We must not offer to "set up production" — it might already be complete.
    const cfg = config({ sand: readyContext({ apiUrl: SANDBOX_URL }), prod: readyContext() }, "sand")
    const tour = await computeTour(cfg, (ctx) =>
      // sandbox context (the active one) succeeds and is paid; production fails.
      ctx.apiUrl === SANDBOX_URL ? Promise.resolve({ paid: true, funded: true }) : Promise.reject(new Error("down")),
    )
    expect(tour.sandbox.complete).toBe(true)
    expect(tour.production.degraded).toBe(true)
    expect(tour.sandbox.hint.toLowerCase()).not.toContain("no rush")
  })
})

describe("hint", () => {
  // Hints are user-facing prose the agent relays. Tests assert on intent and
  // structure, not exact wording, so copy edits don't break them. The register
  // is the skill's tier-1/tier-2 voice — these forbidden words must never leak.
  const FORBIDDEN = /\b(wallet|crypto|blockchain|stablecoin|USDC)\b/i

  it("attaches a non-empty hint to every track state", async () => {
    const setup = await computeTrack(config({}), "sandbox", fakeHydrate({ paid: false, funded: false }).hydrate)
    const fund = await computeTrack(
      config({ r: readyContext() }, "r"),
      "production",
      fakeHydrate({ paid: false, funded: false }).hydrate,
    )
    const done = await computeTrack(
      config({ r: readyContext() }, "r"),
      "production",
      fakeHydrate({ paid: true, funded: true }).hydrate,
    )
    const degraded = await computeTrack(config({ r: readyContext() }, "r"), "production", () =>
      Promise.reject(new Error("down")),
    )
    for (const track of [setup, fund, done, degraded]) {
      expect(track.hint.length).toBeGreaterThan(0)
      expect(track.hint).not.toMatch(FORBIDDEN)
    }
  })

  it("tells the agent to switch context first when the working context is not active", async () => {
    const cfg = config({ sand: readyContext({ apiUrl: SANDBOX_URL }), prod: readyContext() }, "sand")
    const track = await computeTrack(cfg, "production", fakeHydrate({ paid: false, funded: false }).hydrate)
    expect(track.next?.contextIsActive).toBe(false)
    expect(track.hint).toContain("prod") // names the context to switch to
    expect(track.hint.toLowerCase()).toContain("switch")
  })

  it("does not prepend a switch cue when the working context is already active", async () => {
    const track = await computeTrack(
      config({ r: readyContext() }, "r"),
      "production",
      fakeHydrate({ paid: false, funded: false }).hydrate,
    )
    expect(track.next?.contextIsActive).toBe(true)
    expect(track.hint.toLowerCase()).not.toContain("switch")
  })

  it("offers production (without pushing) once sandbox is complete and production is not", async () => {
    // Only the sandbox context exists, and it has paid → sandbox complete;
    // production has no context → setup. The bridge sentence should appear.
    const cfg = config({ sand: readyContext({ apiUrl: SANDBOX_URL }) }, "sand")
    const tour = await computeTour(cfg, fakeHydrate({ paid: true, funded: true }).hydrate)
    expect(tour.sandbox.complete).toBe(true)
    expect(tour.production.complete).toBe(false)
    expect(tour.sandbox.hint.toLowerCase()).toContain("production")
    expect(tour.sandbox.hint.toLowerCase()).toContain("no rush") // offered, not pushed
  })

  it("does not add the production bridge when production is already complete", async () => {
    const cfg = config({ sand: readyContext({ apiUrl: SANDBOX_URL }), prod: readyContext() }, "sand")
    const tour = await computeTour(cfg, fakeHydrate({ paid: true, funded: true }).hydrate)
    expect(tour.sandbox.complete).toBe(true)
    expect(tour.production.complete).toBe(true)
    expect(tour.sandbox.hint.toLowerCase()).not.toContain("no rush")
  })
})

describe("hydrateFromClient (payment-existence probe)", () => {
  // The probe answers "has this agent ever paid?" without pulling the full
  // ledger: it widens the payments window (1d → 30d → all) only while empty,
  // and reads the balance only when no payment exists at all. These tests pin
  // that escalation so the cheap-common-case path can't silently regress to a
  // full-history scan on every call.
  type Probe = { presets: Array<string>; selfReads: number }

  /** Stub read client: returns a payment for windows in `paidPresets`, else empty. */
  function stubClient(paidPresets: Array<string>, balanceMicro = 0n) {
    const probe: Probe = { presets: [], selfReads: 0 }
    const client = {
      getPayments: ({ preset }: { preset?: string } = {}) => {
        probe.presets.push(preset ?? "default")
        return Promise.resolve(paidPresets.includes(preset ?? "default") ? [{} as never] : [])
      },
      getSelf: () => {
        probe.selfReads += 1
        return Promise.resolve({ balance_usdc_micro: balanceMicro } as never)
      },
    }
    return { client, probe }
  }

  it("stops at the first non-empty window and never reads the balance", async () => {
    const { client, probe } = stubClient(["1d"])
    const result = await hydrateFromClient(client)
    expect(result).toEqual({ paid: true, funded: true })
    expect(probe.presets).toEqual(["1d"]) // did not widen past the first hit
    expect(probe.selfReads).toBe(0) // paid implies funded — no balance read
  })

  it("widens to 30d, then all, while narrower windows are empty", async () => {
    const { client, probe } = stubClient(["all"])
    const result = await hydrateFromClient(client)
    expect(result).toEqual({ paid: true, funded: true })
    expect(probe.presets).toEqual(["1d", "30d", "all"])
    expect(probe.selfReads).toBe(0)
  })

  it("falls back to the balance read only when no window has a payment", async () => {
    const { client, probe } = stubClient([], 1n)
    const result = await hydrateFromClient(client)
    expect(result).toEqual({ paid: false, funded: true })
    expect(probe.presets).toEqual(["1d", "30d", "all"]) // all three, all empty
    expect(probe.selfReads).toBe(1)
  })

  it("reports unfunded when there are no payments and a zero balance", async () => {
    const { client } = stubClient([], 0n)
    expect(await hydrateFromClient(client)).toEqual({ paid: false, funded: false })
  })
})

describe("hasEnvCredentials", () => {
  // Drives the inert gate: only env-supplied credentials make the tour inert.
  // A bare AMPERSEND_API_URL override must not, since the identity still comes
  // from a file context the tour can reason about.
  const CRED_VARS = ["AMPERSEND_AGENT_SECRET", "AMPERSEND_AGENT_KEY", "AMPERSEND_AGENT_ACCOUNT", "AMPERSEND_API_URL"]

  // Start each case from a known-clean slate so ambient shell credentials
  // can't leak in. stubEnv(key, undefined) deletes the var.
  beforeEach(() => {
    for (const key of CRED_VARS) vi.stubEnv(key, undefined)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("is false with no env credentials", () => {
    expect(hasEnvCredentials()).toBe(false)
  })

  it("is true when AMPERSEND_AGENT_SECRET is set", () => {
    vi.stubEnv("AMPERSEND_AGENT_SECRET", `${generatePrivateKey()}:::0x1111111111111111111111111111111111111111`)
    expect(hasEnvCredentials()).toBe(true)
  })

  it("is true when AMPERSEND_AGENT_KEY + AMPERSEND_AGENT_ACCOUNT are set", () => {
    vi.stubEnv("AMPERSEND_AGENT_KEY", generatePrivateKey())
    vi.stubEnv("AMPERSEND_AGENT_ACCOUNT", "0x1111111111111111111111111111111111111111")
    expect(hasEnvCredentials()).toBe(true)
  })

  it("is false for a bare AMPERSEND_API_URL override (not inert)", () => {
    vi.stubEnv("AMPERSEND_API_URL", SANDBOX_URL)
    expect(hasEnvCredentials()).toBe(false)
  })
})

describe("tour mode persistence", () => {
  const configDir = join(TEMP_DIR, ".ampersend")

  // Read the persisted mode back from disk the way computeTour does, so these
  // tests exercise the real read-modify-write round-trip rather than trusting
  // setTourMode's return value.
  const storedMode = () => readConfig()?.tour?.mode ?? "active"

  beforeEach(() => {
    if (existsSync(configDir)) rmSync(configDir, { recursive: true })
  })

  afterEach(() => {
    if (existsSync(configDir)) rmSync(configDir, { recursive: true })
  })

  it("defaults to active with no config file", () => {
    expect(storedMode()).toBe("active")
  })

  it("round-trips skip and resume", () => {
    setTourMode("skipped")
    expect(storedMode()).toBe("skipped")
    setTourMode("active")
    expect(storedMode()).toBe("active")
  })

  it("creates a config file from scratch without clobbering later contexts", () => {
    setTourMode("skipped")
    writeConfig({ tour: { mode: "skipped" }, contexts: { r: readyContext() } })
    expect(storedMode()).toBe("skipped")
  })

  it("survives unrelated config writes (prune preserves the preference)", () => {
    writeConfig({ activeContext: "r", tour: { mode: "skipped" }, contexts: { r: readyContext() } })
    // useContext triggers a full read-modify-write cycle through writeConfig.
    const result = useContext("r")
    expect(result.ok).toBe(true)
    expect(storedMode()).toBe("skipped")
  })
})
