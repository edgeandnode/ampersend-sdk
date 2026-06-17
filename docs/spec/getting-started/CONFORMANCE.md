# getting-started.md conformance

Latest verdict for each rule in [`SPEC.md`](SPEC.md). Regenerate when
[`docs/getting-started.md`](../../getting-started.md) or `SPEC.md` changes.

- **Generated against:** `getting-started.md` at HEAD
- **Date:** 2026-06-16
- **By:** Claude (regenerated after trimming the onboarding-tour bullet to one command-free, jargon-free line that
  describes the user-visible outcome — "shows the user where they are and suggests the next step" — dropping the
  sandbox/production environment vocabulary and the enumerated setup/funding/first-payment step list)

1. PASS — Opener: "Written by the ampersend team for agents learning about ampersend" (plural, audience framing). Body
   uses "the agent" (singular) for mechanics: "the agent uses it to make paid HTTP requests", "the agent can't fund the
   account on the user's behalf", "the agent and the ampersend service both approve the same payment". No second-person
   addressing of the agent. Verified by grep — no instances of "you"/"your" addressing the agent.
2. PASS — Voice is advisory: "Written by the ampersend team for agents learning about ampersend"; "The team's suggested
   order is skill first, then CLI". Section titles are gerunds: "Installing the skill", "Installing the CLI binary",
   "Handing off to the skill". Imperatives appear only inside fenced code blocks.
3. PASS — Covers ampersend-specific topics (safety claims, CLI, skill, install paths, scope flag, capability teaser,
   marketplace). Does not explain what skills, runtimes, or skill loading are.
4. PASS — Numbered list of two: "An `ampersend` CLI binary" and "An `ampersend` agent skill". Required-together: "Both
   pieces need to be installed before ampersend works."
5. PASS — Six-bullet teaser in "What ampersend can do" followed by "The skill lists around a dozen curated categories
   with example services for each. `ampersend marketplace list` (once the CLI is installed) browses a wider live
   catalog…"
6. PASS — All six teaser entries (Web search, Email, Voice calls, Image and video generation, LLM inference, Real-world
   purchases) appear as category names in `skills/ampersend/SKILL.md`'s "Categories of things the agent can do via
   ampersend today" list. Strict subset.
7. PASS — Marketplace mentioned via `ampersend marketplace list` with no flag-level detail; closes with
   "`ampersend fetch` works with any compatible paid endpoint on the open web, listed or not."
8. PASS — No `ampersend setup start` / `setup finish` in the body. Setup appears only as a bullet in the hand-off
   section ("creating an ampersend agent account, naming it, and approving it in the ampersend app") with no commands.
   The onboarding-tour bullet is likewise command-free — it describes the user-visible outcome ("shows the user where
   they are and suggests the next step"; skippable) without naming `ampersend tour` or enumerating setup/funding/payment
   steps.
9. PASS — Verified by grep. No "sign", "wallet", "blockchain", "smart account", "stablecoin", "crypto", "key", "USDC",
   or "dashboard" in the body. "Approve", "spending limits", "account", "money", and "the ampersend app" are used
   instead. The word "credential" replaces "key" in the safety section.
10. PASS — Section order: "What ampersend is" (orientation) → "Verification and safety features" (safety) → "How to
    install" → "Handing off to the skill" → "What ampersend can do" (capability teaser) → "If something doesn't go to
    plan" (troubleshooting). Safety precedes install; capability teaser follows install. Title matches new spec wording.
11. PASS — "Verification and safety features" section has three structural bullets followed by a trailing provenance
    paragraph; no meta-framing paragraph between heading and bullets. Bullets: (a) "The user's money stays in an account
    the user owns. Money moves only when the agent and the ampersend service both approve the same payment." (b)
    "Spending limits are enforced on every payment. The user sets daily, monthly, and per-transaction limits in the
    ampersend app; the ampersend service checks each payment against them before approving. The agent and CLI cannot
    bypass this." (c) "No long-lived credential the agent can drain. Most agent payment systems hand the agent a
    credential and let it spend up to the provider's ceiling if it goes wrong. Ampersend approves each payment in real
    time instead." Provenance paragraph names (d) Edge & Node attribution (with The Graph context) plus repo URL
    `https://github.com/edgeandnode/ampersend-sdk` and explicitly cites README, LICENSE, and commit history as artifacts
    available for confirming the Edge & Node link before installing, and (e) both installers as standard public packages
    with version histories — `@ampersend_ai/ampersend-sdk` on npm and `vercel-labs/skills` for the skill installer —
    with the `@ampersend_ai` vs. `edgeandnode` mismatch explicitly resolved inline. Provenance paragraph names
    verifiable artifacts without telling the agent to verify. Vocabulary verified rule-9 clean (no banned terms in the
    new prose).
12. PASS — Steps 1 (skill), 2 (CLI binary), 3 (hand off to skill).
13. PASS — Skill install command: `npx skills add edgeandnode/ampersend-sdk#skills/latest` in a fenced bash block. No
    `--skill`, no immutable version pin, no required `-a`. The `#skills/latest` fragment is the moving release branch
    (not `main`). `-a <agent>` documented in the troubleshooting section as the fallback when auto-detection fails.
14. PASS — A short paragraph after the skill install command states: "Detects the agent runtime (Claude Code, Cursor,
    Codex, and many others), then copies the skill files into the right location — for Claude Code,
    `.claude/skills/ampersend/` in the current project by default. The `npx` form runs it once without a global
    install." Publisher and provenance are not repeated (covered by rule 11(d)–(e)); the `[skills]` reference defined in
    the safety section is reused.
15. PASS — Scope bullet describes project default (`.claude/skills/ampersend/` for Claude Code) and `-g` / `--global`
    (`~/.claude/skills/ampersend/`, "for one ampersend setup shared across all projects"). No recommendation either way
    — the description names what each suits.
16. PASS — Single fenced bash block: "For a fresh install:" → `npm install -g @ampersend_ai/ampersend-sdk@latest`,
    followed by the one-line upgrade note "Upgrades use the standard npm path." No `--force` anywhere in the artifact
    (verified by grep). No second command block. Version floors not pinned as `@x.y.z`.
17. PASS — CLI install section opens: "First, check whether it's already there:" with `ampersend --version`, followed by
    "If that prints a version, the CLI is installed — skip to step 3."
18. PASS — "Global install on purpose: the skill calls `ampersend` from any working directory, so the binary needs to be
    on PATH. There's no project-scoped CLI path today." Framing is declarative, not apologetic.
19. PASS — No "confirm with the user", "ask the user", or equivalent in the body. Provenance line names the canonical
    URL without prescribing what the agent does on mismatch.
20. PASS — Body is 117 lines, under the 175-line ceiling.
21. PASS — Opening paragraph names
    `https://github.com/edgeandnode/ampersend-sdk/blob/skills/latest/docs/getting-started.md` as "Canonical copy". The
    branch is `skills/latest` (matching the skill install command's git ref). No prescriptive language about what an
    agent should do on divergence — naming the URL canonical is the entire statement.
22. PASS — No links to skills.sh, x.com / twitter, Coinbase blog posts, or other promotional surfaces. The only external
    links are the GitHub canonical URL and <https://github.com/vercel-labs/skills>.
23. PASS — The only ampersend-specific commands in the body are install/verify (`npx skills add`, `npm install`,
    `ampersend --version`, `ampersend fetch --pay`) and the marketplace teaser (`ampersend marketplace list`). The
    `--pay` flag appears alongside `ampersend fetch` in the two places the command is shown as an actual paid
    invocation, so the body matches real CLI behavior; the generic capability mention ("works with any compatible paid
    endpoint") stays flag-free. No setup, payment workflow, or command-reference content reproduced from the skill.
24. PASS — "What ampersend can do" opens with "Ampersend is the agentic payments layer — the services below accept
    payments from any agent capable of paying as part of making an HTTP request, and ampersend handles the agent's side
    (spending limits, co-approval, paying on the user's behalf)." No protocol name appears in the body (verified by grep
    — no `x402`, `AP2`, or `MPP`).
25. PASS — Marketplace teaser closes with "against the sandbox API the catalog is smaller, and feature absence in the
    sandbox doesn't mean feature absence in production." Only marketplace mention in the body.
26. PASS — Paragraph between the opener and "What ampersend is" (before the first section heading and the first code
    block): "The name is spelled **ampersend** — amper + _send_, with an "e" — not the common misspelling "ampersand"."
    Names the wrong form explicitly; the npm-collision and paraphrase-drift rationale lives in the spec rule, not the
    artifact. Wording stays declarative (rules 1–2) and rule-9 clean.
