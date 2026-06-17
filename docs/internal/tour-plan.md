# Tour: design (v4 — aggressively simplified, agreed for v1 build)

Onboarding tour for the ampersend CLI + skill. One standalone command, hydrated on every call, two parallel tracks, a
linear four-step machine per track. The skill consults it at natural boundaries and owns all voice and timing.

The simplifying principle: **the tour is for new users, and new users have at most one context per environment.**
Everything in earlier drafts that served multi-context setups (ranking, sibling transparency, the context cap,
per-context caching) served users who are already past onboarding — cut. Users with exotic configs get error-driven help
and `config status`, not the tour.

## Model

Two symmetric tracks — `sandbox` and `production` — over the same fixed, linear step machine:

```
setup → finish_setup → fund → first_payment → (complete)
```

- Track membership by `apiUrl`: production = `isProductionUrl()`; sandbox = host `api.sandbox.ampersend.ai`; anything
  else is invisible to the tour.
- **Each track considers exactly one context**: the active context if it's in that env, else the newest context in that
  env (tie-break alphabetical), else none (→ `setup`).
- Because the steps are linear, `next` encodes the entire state — there is no separate milestones object. `next: "fund"`
  _means_ setup is done and no payment has happened.
- **Track complete = that context has ever paid.** `production.complete` is the tour's exit: the skill goes silent
  forever.
- Track choice (which track to follow) is conversational intent, never stored. The skill asks the fork question or
  infers from what the user is doing.
- Asymmetry between tracks is voice only: sandbox = play money, validate the loop; production = real money, real value.
  The bridge ("sandbox done — go production?") is the voice of `sandbox.complete && !production.complete`, not a step.

### Step derivation (per track's context)

| `next`            | Condition                                                                   | Network  |
| ----------------- | --------------------------------------------------------------------------- | -------- |
| `setup`           | no context in env (incl. expired pending — pruning makes this self-correct) | none     |
| `finish_setup`    | context `status: "pending"`, unexpired                                      | none     |
| `fund`            | context `ready`, no payments, balance = 0                                   | hydrated |
| `first_payment`   | context `ready`, no payments, balance > 0                                   | hydrated |
| `null` (complete) | ≥1 outgoing payment                                                         | hydrated |

Hydration per track: `payments --preset all` (1 call; non-empty ⇒ complete); if empty, `getSelf` for balance (1 call).
**Maximum 4 API calls per invocation, typical 1–2.** Grounded in source: context status is local (`config.ts`),
`getSelf` returns `balance_usdc_micro`, payments history is per-agent so progress from other machines/keys is picked up
automatically.

## Command

```bash
ampersend tour          # both tracks, hydrated
ampersend tour skip     # mode = skipped: skill stops proactive nudging; error help unaffected
ampersend tour resume   # mode = active
```

No other flags or subcommands in v1. `skip` exists as a durable marker for agents starting new sessions (conversation
memory resets; the config bit doesn't) — it governs proactivity only, and `tour` always answers when explicitly asked
regardless of mode.

```jsonc
{
  "ok": true,
  "data": {
    "mode": "active", // active | skipped
    "sandbox": {
      "complete": false,
      "next": { "step": "fund", "context": "api.sandbox.ampersend.ai-ctx-1a2b", "contextIsActive": true },
    },
    "production": { "complete": false, "next": { "step": "setup", "context": null } },
  },
}
```

`contextIsActive: false` tells the skill to suggest `config use <name>` (or `--context`) before walking that track. With
env-var credentials (`AMPERSEND_AGENT_SECRET` / `AMPERSEND_API_URL` set — CI/deploy paths): `{ "mode": "inert" }`, no
tracks, no nudging.

## Stored state

```jsonc
{ "version": 2, "tour": { "mode": "skipped" } } // absent = active (always-on default)
```

One value, top-level in the existing config. Nothing per-context; everything else is recomputed per call, so `config rm`
and multi-machine need no tour awareness.

## Skill changes

- **SKILL.md — "Tour" section.** Small, because the four steps map to workflows the skill already documents (Setup
  workflow, `fund`, Payment workflow + example-services for `first_payment`):
  - Run `ampersend tour` at boundaries: first load with no config, after `setup finish`, after the user reports funding,
    after a first successful `fetch --pay`, or on "where am I / what's next".
  - With no contexts at all, ask the fork question: play money first, or straight to real?
  - Etiquette: at most one proactive nudge per conversation; same nudge ignored twice ⇒ offer `ampersend tour skip`;
    skipped or `production.complete` ⇒ never mention the tour unless asked (error-driven help unaffected).
- **references/commands.md**: `tour` reference.
- **getting-started.md**: one paragraph — the skill offers a short guided tour, skippable any time.
- **Specs**: update both `docs/spec/*/SPEC.md` + `CONFORMANCE.md` pairs alongside (repo rule).

## Rollout

CLI first (new command invisible to old skills), then the skill with its required CLI version bumped. Existing
`minSkillVersion` handshake covers the reverse.

## Accepted tradeoffs

- A second context in the same env is ignored (active-or-newest wins). Worst case: the tour says `fund` while an
  unconsidered sibling holds funds — recoverable at voice level via `config status`; not an onboarding-shaped situation.
- The earlier 6-context cap is superseded by something stricter: the tour touches at most 2 contexts, ever.

## Deferred (v2+)

- `--sandbox` / `--production` / `--context` / `--skill-version` flags.
- Milestones display object (redundant with linear `next`).
- Multi-context awareness: ranking, sibling transparency array, completion OR across siblings.
- Monotonic per-context cache; envelope nudges on other commands + passive observation.
- `--cached` zero-network view.
