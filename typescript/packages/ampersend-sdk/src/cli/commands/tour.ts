import type { Command } from "commander"

import { parseEnvConfig } from "../../ampersend/env.ts"
import { AgentReadClient } from "../../ampersend/index.ts"
import {
  DEFAULT_API_URL,
  isPendingExpired,
  isProductionUrl,
  readConfig,
  setTourMode,
  type Context,
  type ReadyContext,
  type StoredConfigV2,
  type TourMode,
} from "../config.ts"
import { err, ok } from "../envelope.ts"

/**
 * Onboarding tour. Two parallel tracks (sandbox, production) over the same
 * linear step machine:
 *
 *   setup → finish_setup → fund → first_payment → (complete)
 *
 * Each track considers exactly one context — the active one if it belongs to
 * the track's environment, else the newest — and `next` encodes the whole
 * state (the steps are linear, so there is no separate milestones object).
 * A track is complete once its context has ever paid.
 *
 * The command owns the *guidance*, not just the position: every track carries
 * a `hint` — a sentence of plain user-facing prose the agent relays (and may
 * reword) describing what to do next, or that the track is done. This is what
 * lets the skill stay a thin router: it runs `tour` and passes the hint along
 * rather than carrying a key→prose map of its own. Step names are stable keys
 * for tests and tooling; the hint is the human-facing seed.
 *
 * Setup state is local (context status in the config file); only `funded`
 * and `paid` are server facts, hydrated on every call — payments first
 * (a non-empty window proves `paid`, probed cheapest-preset-first), balance
 * only when no payment exists. A track whose hydration fails degrades on its
 * own (`degraded: true`) rather than faulting the whole tour. Nothing
 * tour-related is persisted except the skip preference.
 */

const SANDBOX_API_HOST = "api.sandbox.ampersend.ai"

export type TourEnv = "sandbox" | "production"
export type TourStep = "setup" | "finish_setup" | "fund" | "first_payment"

export interface TourNext {
  step: TourStep
  context: string | null
  contextIsActive: boolean
}

export interface TourTrack {
  complete: boolean
  next: TourNext | null
  /**
   * True when the track's server state couldn't be read (e.g. the network was
   * down). `complete` is `false` and `next` is `null` — the position past setup
   * is genuinely unknown, so the hint says so rather than guessing a step.
   * Setup-stage tracks (no context, or a pending one) never hydrate and so are
   * never degraded.
   */
  degraded?: boolean
  /** Plain user-facing guidance for this track's current state — the agent relays it. */
  hint: string
}

export interface TourData {
  mode: TourMode
  sandbox: TourTrack
  production: TourTrack
}

/** Server facts for one ready context, from the API hydrator or a test double. */
export interface Hydration {
  paid: boolean
  funded: boolean
}

/** Which track a context belongs to; null = outside the tour (custom URLs). */
export function classifyEnv(apiUrl: string | undefined): TourEnv | null {
  if (isProductionUrl(apiUrl)) return "production"
  try {
    return new URL(apiUrl as string).host === SANDBOX_API_HOST ? "sandbox" : null
  } catch {
    return null
  }
}

/**
 * The single context a track considers: the active context when it belongs
 * to this env, else the newest (tie-break alphabetical by name). Expired
 * pendings are invisible — `setup` again is the right next step for those.
 */
export function pickTrackContext(
  config: StoredConfigV2,
  env: TourEnv,
): { name: string; context: Context; isActive: boolean } | null {
  const candidates = Object.entries(config.contexts).filter(
    ([, ctx]) => classifyEnv(ctx.apiUrl) === env && !(ctx.status === "pending" && isPendingExpired(ctx)),
  )
  if (candidates.length === 0) return null

  const active = candidates.find(([name]) => name === config.activeContext)
  if (active) return { name: active[0], context: active[1], isActive: true }

  const [name, context] = candidates.sort(
    ([aName, a], [bName, b]) => b.createdAt.localeCompare(a.createdAt) || aName.localeCompare(bName),
  )[0]
  return { name, context, isActive: false }
}

/** How each environment refers to its money, in plain user words. */
const MONEY: Record<TourEnv, string> = {
  sandbox: "play money for trying things out",
  production: "real money",
}

/**
 * The plain-prose guidance the agent relays. One sentence per state, in the
 * skill's tier-1/tier-2 register — "funds", "spending allowance", "account you
 * own", never "wallet", "crypto", or "blockchain". A non-active context gets a
 * leading "Switch to it first" so the agent knows to run `config use` before
 * the step itself. The bridge sentence (sandbox done → try production) is added
 * later, in `computeTour`, since it depends on the *other* track.
 */
function trackHint(env: TourEnv, track: { complete: boolean; next: TourNext | null; degraded?: boolean }): string {
  const { complete, degraded, next } = track
  if (degraded) {
    return `Couldn't reach the server to check the ${env} environment's progress just now — the agent is set up there, but whether it still needs funds or a first payment is unknown until the connection is back. Try again in a moment.`
  }
  if (complete) {
    return `The ${env} environment is all set up — the agent has paid for something here, so there's nothing left to do on this track.`
  }
  const switchFirst =
    next && next.context && !next.contextIsActive ? `Switch to the "${next.context}" context first, then ` : ""
  const cap = (s: string) => (switchFirst ? s : s.charAt(0).toUpperCase() + s.slice(1))
  switch (next?.step) {
    case "finish_setup":
      return `${switchFirst}${cap("an agent is waiting for approval in the dashboard — run the setup flow's finish step to activate it.")}`
    case "fund":
      return `${switchFirst}${cap(`the agent is set up but has no funds yet — add some ${MONEY[env]} so it can pay for things.`)}`
    case "first_payment":
      return `${switchFirst}${cap("the agent is funded and ready — make a first paid request to try it out.")}`
    default: // "setup" — no context exists yet for this environment
      return `No agent yet for the ${env} environment — run the setup flow to create one when you're ready to use ${MONEY[env]}.`
  }
}

/**
 * One track's state. Hydrates only a ready, possibly-unpaid context. A
 * hydration failure degrades *this* track alone (`degraded: true`, `next:
 * null`) — the tour is an orientation tool, so a flaky server read on one
 * environment must not take down the answer for the other or for the local
 * (setup/finish_setup) part of this one.
 */
export async function computeTrack(
  config: StoredConfigV2,
  env: TourEnv,
  hydrate: (context: ReadyContext) => Promise<Hydration>,
): Promise<TourTrack> {
  const track = await resolveTrack(config, env, hydrate)
  return { ...track, hint: trackHint(env, track) }
}

/** The position (complete + next + degraded) before any hint is attached. */
async function resolveTrack(
  config: StoredConfigV2,
  env: TourEnv,
  hydrate: (context: ReadyContext) => Promise<Hydration>,
): Promise<{ complete: boolean; next: TourNext | null; degraded?: boolean }> {
  const picked = pickTrackContext(config, env)
  if (!picked) {
    return { complete: false, next: { step: "setup", context: null, contextIsActive: false } }
  }
  const base = { context: picked.name, contextIsActive: picked.isActive }
  if (picked.context.status === "pending") {
    return { complete: false, next: { step: "finish_setup", ...base } }
  }
  // Only the server read can fail here; catch it narrowly so a network blip
  // degrades the track instead of faulting the whole command.
  let hydration: Hydration
  try {
    hydration = await hydrate(picked.context)
  } catch {
    return { complete: false, next: null, degraded: true }
  }
  if (hydration.paid) return { complete: true, next: null }
  return { complete: false, next: { step: hydration.funded ? "first_payment" : "fund", ...base } }
}

/**
 * Cheapest preset that still proves "has this agent ever paid?". We only need
 * existence, not the ledger, but the `/payments` endpoint has no `limit` — only
 * a `preset` timerange. So probe narrowest-first: a recent payer is caught by
 * `1d` (a near-empty payload); we widen to `30d`, then `all`, only when the
 * narrower window is empty. The full-history scan happens only for an agent
 * that has never paid or last paid over 30 days ago — the unavoidable floor
 * without a server-side existence flag.
 */
const PAYMENT_PROBE_PRESETS = ["1d", "30d", "all"] as const

/** The read surface the hydrator needs — lets tests drive it with a stub. */
type PaymentProbeClient = Pick<AgentReadClient, "getPayments" | "getSelf">

/**
 * Server facts for one ready context, given a read client. `paid` is proved by
 * the first non-empty payments window (which also implies `funded`); only a
 * genuinely unpaid context falls through to the balance read. Worst case is
 * four reads (three escalating payment probes, then balance), but a context
 * that has paid recently — the common case — resolves in a single small `1d`
 * read and never transfers the full ledger.
 *
 * Split from {@link hydrateFromApi} so the probe order is unit-testable with a
 * stub client, without standing up real auth.
 */
export async function hydrateFromClient(client: PaymentProbeClient): Promise<Hydration> {
  for (const preset of PAYMENT_PROBE_PRESETS) {
    const payments = await client.getPayments({ preset })
    if (payments.length > 0) return { paid: true, funded: true }
  }
  const self = await client.getSelf()
  return { paid: false, funded: self.balance_usdc_micro > 0n }
}

/** Production hydrator: builds the authenticated client for a context, then probes. */
async function hydrateFromApi(context: ReadyContext): Promise<Hydration> {
  return hydrateFromClient(
    new AgentReadClient({
      baseUrl: context.apiUrl ?? DEFAULT_API_URL,
      agentAddress: context.agentAccount,
      sessionKeyPrivateKey: context.agentKey,
    }),
  )
}

/**
 * Full tour state for both tracks. Cross-track guidance lives here, since it
 * needs both: once the sandbox track is complete and production isn't yet
 * started, the sandbox hint offers (never pushes) moving on to real money.
 */
export async function computeTour(
  config: StoredConfigV2 | null,
  hydrate: (context: ReadyContext) => Promise<Hydration> = hydrateFromApi,
): Promise<TourData> {
  const cfg = config ?? { version: 2 as const, contexts: {} }
  // computeTrack resolves (never rejects) per track, so one track's failed
  // server read degrades only itself — the other still returns its real state.
  const [sandbox, production] = await Promise.all([
    computeTrack(cfg, "sandbox", hydrate),
    computeTrack(cfg, "production", hydrate),
  ])
  // Bridge to production only when we actually know production isn't done. A
  // degraded production track has unknown state, so we don't offer a step that
  // might already be complete.
  if (sandbox.complete && !production.complete && !production.degraded) {
    sandbox.hint = `${sandbox.hint} When the user is ready to use real money, offer to set up the production environment — no rush, and the sandbox stays available for trying out other services.`
  }
  return { mode: cfg.tour?.mode ?? "active", sandbox, production }
}

/**
 * Env-supplied *credentials* (CI/deploy paths) bypass the context model the
 * tour reasons about, so the tour reports inert. A bare `AMPERSEND_API_URL`
 * override does not: the identity still comes from a file context the tour can
 * reason about normally (the override just redirects that context's URL for the
 * process), so it is not treated as inert here.
 */
export function hasEnvCredentials(): boolean {
  try {
    parseEnvConfig()
    return true
  } catch {
    return false
  }
}

function print(payload: unknown): void {
  console.log(JSON.stringify(payload, null, 2))
}

export function registerTourCommand(program: Command): void {
  const tour = program
    .command("tour")
    .description("Onboarding tour: where the user is per environment (sandbox, production) and what's next")
    .action(async () => {
      if (hasEnvCredentials()) {
        print(ok({ mode: "inert" }))
        return
      }
      try {
        print(ok(await computeTour(readConfig())))
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        print(err("TOUR_READ_ERROR", message))
        process.exit(1)
      }
    })

  tour
    .command("skip")
    .description("Mark the tour skipped: agents stop proactive nudging (tour still answers when asked)")
    .action(() => {
      setTourMode("skipped")
      print(ok({ mode: "skipped" }))
    })

  tour
    .command("resume")
    .description("Re-enable proactive tour nudging")
    .action(() => {
      setTourMode("active")
      print(ok({ mode: "active" }))
    })
}
