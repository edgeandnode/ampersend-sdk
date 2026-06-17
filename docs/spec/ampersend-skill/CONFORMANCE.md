# SKILL.md conformance

Latest verdict for each rule in [`SPEC.md`](SPEC.md). Regenerate when
[`skills/ampersend/SKILL.md`](../../../skills/ampersend/SKILL.md) or `SPEC.md` changes.

- **Generated against:** `skills/ampersend/SKILL.md` at HEAD
- **Date:** 2026-06-16
- **By:** Claude (regenerated after the voice rewrite. The body was rewritten into the agent voice defined in
  [`../voice.md`](../voice.md): the "Who does what" four-role list was removed; authorization is now stated as the
  "checked on the account's side" invariant rather than the co-sign/limits mechanism; the tier-3 crypto explainer moved
  entirely out of the body into the new `references/explaining-to-users.md`; and human-presence phrasings ("relay to the
  user", "the user asks") were stripped from the workflows. SPEC gained rules 22 (agent voice) and 23 (user-voice
  explainer file) and amended 9, 13, 17. **Three FAILs recorded** — 9, 13, 23 — all the same drift: the body keeps a
  quick tier-1/tier-2 product explainer in "Explaining ampersend to a person", which those three rules say the body
  carries "not … at all". One PARTIAL — 22 — the body follows voice.md's "account's side" phrasing, not rule 22's
  literal "the ampersend service authorizes it" quote. See those lines for the resolution owed.)

1. PASS — `name: ampersend` (9 chars, kebab-case); description ~430 chars (under 1024); `version: 0.0.27` is the only
   additional frontmatter field, allowed under the agentskills.io spec's open additional-properties stance.
2. PASS — Two sentences; first says what, second says when (five trigger clauses covering URL-in-hand,
   capability-without-URL, and explore mode); plain user words; no first-person pronouns.
3. PASS — Description leads with the imperative "Give an agent…" and triggers on "Use when…"; the discovery clauses name
   concrete recognition cues ("names a capability they want without a specific URL in mind", "is asking what the agent
   can pay for") rather than passive dispositions.
4. PASS — Frontmatter `name: ampersend` matches the parent directory `skills/ampersend/`.
5. PASS — Body is 300 lines, under the 500-line ceiling.
6. PASS — Order is orientation → how-a-payment-works → CLI prerequisite → suggesting things to try → user explainer
   pointer → security → onboarding tour → setup → payment → reading agent state → discovery → output → config; setup,
   payment, reading-state, and discovery workflows are numbered steps or command blocks. The orientation block opens
   with the "you request; the account answers" invariant and a "How a payment works" paragraph, replacing the former
   "Who does what" four-role list. The Onboarding tour section is prose plus an etiquette bullet list (no numbered step
   machine — it routes to existing workflows by anchor link and lets the `tour` command carry the progression).
7. PASS — `references/` contains four files (`commands.md`, `example-services.md`, `marketplace.md`,
   `explaining-to-users.md`); no subdirectories. Flag tables, exhaustive option lists, and the tiered product explainer
   all live there rather than in `SKILL.md`.
8. PASS — `references/commands.md` is 381 lines and starts with "Contents" (lists `card` between `fetch` and `agent`,
   and `tour` between `agent` and `config`). `references/example-services.md` is 336 lines and starts with a Contents
   section listing all 14 capability headings plus the Response patterns section. `references/marketplace.md` is 81
   lines — over the 100-line threshold? No: 81 < 100, so no TOC required. `references/explaining-to-users.md` is 43
   lines — under the threshold, no TOC required.
9. FAIL — The carve-out additions hold (curated services + Pinata response pattern live only in
   `references/example-services.md`; capability list is user-voice categories without "pay-per-…"/x402 framing), but
   the amended last sentence of this rule — "User-voice product explanation (how to describe ampersend to a human) is
   **not** in the body; it lives in `references/explaining-to-users.md` per rule 23" — is violated: SKILL.md lines
   105–108 ("Explaining ampersend to a person") carry the tier-1 and tier-2 user-voice explainer verbatim ("a small
   spending allowance…", "You set the limits…"). The deeper tiers and control/surfacing content did move out, but the
   quick explainer remains in the body. Resolution owed: either amend rules 9/13/23 to permit a deliberately-scoped
   quick version in the body, or move the quick version into `explaining-to-users.md` and have the body only point to
   it.
10. PASS — Terminology is consistent. "account's side" / "account holder" / "the account" are used consistently for the
    authorizing side (no stray "user" in the new agent-voice prose except at genuine handoffs). The config concept is
    named "context" everywhere (SKILL.md and `references/commands.md`). The sandbox/production split is named with
    "track" in the tour section and "environment"/"side" in Common config tweaks, matching `references/commands.md`.
    "service", "capability", and "endpoint" are used consistently. `card issue` / `card details` are named identically
    in the body and `references/example-services.md`.
11. PASS — Floor stated as prose ("below `0.0.27`"); `npm install` uses `@latest`; skill upgrade uses
    `npx skills update ampersend`, which respects the moving `#skills/latest` ref. No `@x.y.z` or `#v0.0.x` strings in
    `SKILL.md` (verified by grep). Examples file does not pin third-party versions.
12. PASS — "ampersend CLI" and "context" are glossed on first mention in the body. "USDC" appears only as
    `wallet_address`-adjacent field context in the `agent` command block and in the Discovery price gloss; it is not
    introduced as a substantive term needing a one-line gloss in the new agent-voice prose. The ERC-8004 registry is
    glossed inline ("a public, open registry of agents") on first mention in the Discovery workflow. "track" is
    introduced by its two named instances ("two tracks — `sandbox` and `production`") and the etiquette bullets meaning
    it in user-voice. No crypto term ("wallet", "blockchain", "smart account", "stablecoin", "co-sign") survives in the
    body to require glossing — all moved to `references/explaining-to-users.md`.
13. FAIL — The first half holds: the tier-1/tier-2/tier-3 progression and the flagged words ("crypto", "wallet",
    "blockchain", "smart account", "stablecoin") now live in `references/explaining-to-users.md`, and a grep of the body
    finds none of those words except the literal `wallet_address` field name in the `agent owner` output (line 220) and
    `ERC-8004` (a marketplace source, not a crypto explainer term). But the rule's final clause — "The body of
    `SKILL.md`, being agent-voice, does not carry these explainers at all" — is violated by the same lines 105–108 that
    fail rule 9: the body carries the tier-1 and tier-2 explainers, just not tier 3. Same resolution as rule 9.
14. PASS — Security section forbids signing in to the dashboard from a browser the agent controls and forbids asking the
    account holder to sign in through a browser the agent can see (both **NEVER** imperatives). The setup workflow shows
    `verificationCode` alongside `user_approve_url` and requires confirming the code matches before approving ("that
    check is what makes the approval safe").
15. PASS — Hard imperatives appear only where they guard real safety boundaries: Security section (controlled-browser
    login **NEVER**, MITM/key-substitution code-match), "don't recommend providers from training" (agent inventing
    services), "Real-world purchases" (irreversible spend, surfaced via `references/example-services.md`). The
    capability-missing guidance ("a capability missing from this file isn't a capability missing from ampersend") and
    the link-sharing note ("passing or sharing a link does not cross the line") are framed as judgment guidance. The
    tour etiquette is introduced as "Etiquette the product team asks for" and uses "the first fork is the account
    holder's to pick" / "is the off switch" / "is a standing request", not hard imperatives. The voice rewrite removed
    the prescriptive "inspect first, then decide" sequencing in favor of capability description.
16. PASS — 14 capabilities in the body, 14 entries under those capabilities in `references/example-services.md`, plus
    one Response-patterns entry. Mapping: Web search → Firecrawl; Email → AgentMail; Email lookup and verification →
    Apollo people-enrich + Hunter email-verifier (via StableEnrich); Voice calls → StablePhone; Property valuation →
    RentCast (via StableEnrich); Domain registration → Bloomfilter; File hosting → StableUpload; Image and video
    generation → StableStudio; LLM inference → BlockRun; Social data → StableSocial; News and market data → Gloria; Job
    search → StableJobs; Travel search → StableTravel; Real-world purchases → Prepaid Visa cards (`ampersend card`).
    Pinata sits in the Response patterns section. No orphan capabilities, no orphan suggestable services. The
    "Real-world purchases" body bullet and the `references/example-services.md` entry both name `card issue` /
    `card details`.
17. PASS — "Suggesting things to try" opens: "Ampersend is the agentic payments layer between the agent and the services
    below. Services don't need to know ampersend exists — they accept payments from any agent capable of paying as part
    of making an HTTP request, and ampersend handles the agent's side: requesting authorization for each payment and
    paying once it's authorized." This matches the amended rule's framing (agent-side layer that requests authorization,
    no mechanism). Services are framed as accepting payments from any compliant agent, not specifically ampersend. No
    protocol name (x402, AP2, MPP) appears in the body as a descriptor of what services "accept" — grep finds x402
    nowhere in the body now that the tier-3 explainer moved out. "ERC-8004" (line 247) names a source of marketplace
    agents, not a payment protocol, so it falls outside this rule.
18. PASS — Sandbox API URL mentions carry the subset caveat everywhere they occur. Discovery workflow: "`marketplace
    list` against the sandbox returns a smaller catalog than production — feature absence in the sandbox does not imply
    feature absence in production." Common config tweaks: "The sandbox covers the payment flow end-to-end, but only a
    subset of services and capabilities are wired up there — feature absence in the sandbox doesn't mean feature absence
    in production." The Onboarding tour section names the sandbox track but not the sandbox API URL; the `tour` section
    in `references/commands.md` names the URL and carries the subset caveat inline.
19. PASS — Frontmatter carries `version: 0.0.27`. The "CLI prerequisite" section instructs the agent to run
    `ampersend version`, compare the skill's frontmatter `version` against `minSkillVersion`, and run
    `npx skills update ampersend` if the skill is behind. CLI install paths match `docs/getting-started.md`: missing CLI
    → fresh install via `npm install -g @ampersend_ai/ampersend-sdk@latest`; `cliVersion` below `0.0.27` → "upgrade —
    use the standard npm path" as a single short line, no second command block. `--force` absent from the body (verified
    by grep).
20. PASS — Spelling guard is the second paragraph of the body, before the first command block: "The name is spelled
    **ampersend** — amper + _send_, with an "e" — not the common misspelling "ampersand". Every command below uses the
    "e" spelling." Names the wrong form explicitly; phrased as fact, not directive, so rule 15 is unaffected.
21. PASS — "Onboarding tour" section sits between Security and the Setup workflow and is a thin router over
    `ampersend tour`. Trigger is intent-based, not an enumerated list: "the way to find out what's left when that's
    unclear — at the start of a conversation, after finishing a setup or payment step, or whenever the next move isn't
    obvious." The body acts on the per-track `hint` ("The `hint` is what to act on"), fulfills any command/workflow it
    names through existing sections by anchor link (Setup workflow, Payment workflow, `ampersend fund`), and switches
    context first when `contextIsActive` is false. The body does not restate the step machine, step order, or per-step
    prose ("The command tracks the steps and their order"). The fork question is the first etiquette bullet (play money
    first vs. straight to real). Quiet rules cover `mode: "skipped"` and a `complete` track ("a standing request not to
    bring the tour up unprompted") with error help carved out ("helping with errors is unaffected") and the other-track
    caveat preserved. `degraded: true` is documented as a transient "server couldn't be reached" state to relay, not a
    setup failure. `mode: "inert"` is **not** documented in the body; it lives in `references/commands.md` only.
    Etiquette framing satisfies rule 15.
22. PARTIAL — The body is in the agent voice per `../voice.md`: a declined payment is framed as "nothing is spent and
    nothing changes; the CLI works exactly as before, and another request can be made any time" (the reassuring
    invariant); capabilities are described, not prescribed (the "inspect first, then decide" sequencing was removed —
    `fetch --inspect` is now "reports the price without fetching the resource"); human-presence phrasings ("relay to the
    user", "the user asks") are gone from the workflows except at the genuine setup/funding handoffs; the co-sign /
    `CoSignerValidator` / limits mechanism was removed. The mismatch: rule 22 quotes the canonical invariant as "a
    payment goes through only when **the ampersend service authorizes it**, and a human is behind that decision," but
    the body (and `../voice.md` itself) phrase it as "checked on **the account's side**" — the body never says "the
    ampersend service authorizes" and never states "a human is behind that decision" (voice.md deliberately abstracts
    who/what is behind it). The body follows voice.md's phrasing, so the divergence is rule 22's literal quote vs. its
    own referenced voice doc. Resolution owed: reconcile rule 22's canonical sentence with voice.md (the "account's
    side" phrasing is what both artifacts use).
23. FAIL — `references/explaining-to-users.md` exists, is in the user voice, opens by naming itself as the user-voice
    file ("This file is in the **user's voice**…"), and holds the tiered "what ampersend is" explainers, the "what stays
    in the person's control" section, and the "surfacing ampersend to someone who doesn't have it" section — all as
    required. But the rule's closing requirement — it "is the only place the skill carries human-facing product prose.
    The body points to it in one line and does not duplicate its content" — is violated: the body's "Explaining
    ampersend to a person" section (SKILL.md lines 100–111) duplicates the tier-1 and tier-2 explainer content rather
    than only pointing to the file. Same drift as rules 9 and 13; same resolution.
