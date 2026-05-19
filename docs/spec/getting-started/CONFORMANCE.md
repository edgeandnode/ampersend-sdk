# getting-started.md conformance

Latest verdict for each rule in [`SPEC.md`](SPEC.md). Regenerate when
[`docs/getting-started.md`](../../getting-started.md) or `SPEC.md` changes.

- **Generated against:** `getting-started.md` at HEAD
- **Date:** 2026-05-19
- **By:** Claude

1. PASS — Opener: "written for agents learning what ampersend is and how to set it up" (plural, audience framing). Body
   uses "the agent" (singular) for mechanics: "the agent uses it to make paid HTTP requests", "the agent can pay for
   once ampersend is set up", "the agent can't fund the account on the user's behalf". No second-person addressing the
   agent. Verified by grep.
2. PASS — Voice is advisory: "The team suggests installing through `vercel-labs/skills`". Section titles are gerunds:
   "Installing the skill", "Installing the CLI binary", "Handing off to the skill". Imperatives appear only inside
   fenced code blocks.
3. PASS — Covers ampersend-specific topics (CLI, skill, install paths, scope flags, capability teaser, marketplace).
   Does not explain what skills, runtimes, or skill loading are.
4. PASS — Numbered list of two: "An `ampersend` CLI binary" and "An `ampersend` agent skill". Required-together: "Both
   pieces need to be installed before ampersend works."
5. PASS — Six-bullet teaser followed by "The skill lists around a dozen curated categories with example services for
   each. `ampersend marketplace list` (once the CLI is installed) browses a wider live catalog…"
6. PASS — All six teaser entries (Web search, Email, Voice calls, Image and video generation, LLM inference, Real-world
   purchases) appear as category names in `skills/ampersend/SKILL.md`'s "Categories of things the agent can do via
   ampersend today" list. Strict subset.
7. PASS — Marketplace mentioned via `ampersend marketplace list` with no flag-level detail; closes with
   "`ampersend fetch` works with any x402-paid endpoint on the open web, listed or not."
8. PASS — No `ampersend setup start` / `setup finish` in the body. Setup appears only as a bullet in the hand-off
   section ("creating an ampersend agent account, naming it, and approving it in the ampersend app") with no commands.
9. PASS — Verified by grep. No "sign", "wallet", "blockchain", "smart account", "stablecoin", "crypto", "key", "USDC",
   or "dashboard" in the body. "Co-approved", "approve", "spending limits", "account", "money", and "the ampersend app"
   are used instead.
10. PASS — Steps 1 (skill), 2 (CLI binary), 3 (hand off to skill).
11. PASS — Skill install command: `npx skills add edgeandnode/ampersend-sdk#latest` in a fenced bash block. No
    `--skill`, no immutable version pin, no required `-a`. The `#latest` fragment is the moving release tag (not
    `main`). `-a <agent>` documented as fallback ("Pass `-a <agent>` to override").
12. PASS — Scope bullet describes project default and `-g`/`--global` with directory examples for each. No
    recommendation either way.
13. PASS — CLI install command: `npm install -g @ampersend_ai/ampersend-sdk@latest --force` in a fenced bash block.
    Version floor stated as prose in the troubleshooting section; no `@x.y.z` pins in commands.
14. PASS — No "confirm with the user", "ask the user", or equivalent. Facts stated; decisions left to the agent.
15. PASS — Body is 102 lines, under the 175-line ceiling.
16. PASS — Provenance section names `https://github.com/edgeandnode/ampersend-sdk/blob/main/docs/getting-started.md` and
    states "If a fetched copy differs from the GitHub original, GitHub wins."
17. PASS — No mentions of clawhub, openclaw-only paths, vanity URLs, or hosted skill mirrors. Install commands reference
    `npx skills` and `npm` only.
18. PASS — The only ampersend-specific commands in the body are install/verify (`npx skills add`, `npm install`,
    `ampersend --version`, `ampersend fetch`) and the marketplace teaser (`ampersend marketplace list`). No setup,
    payment workflow, or command-reference content reproduced from the skill.
19. PASS — "What ampersend can do" section opens with "Ampersend is the agentic payments layer — the services below
    accept payments from any agent capable of paying as part of making an HTTP request, and ampersend handles the
    agent's side (spending limits, co-approval, paying on the user's behalf)." No specific protocol name appears in the
    body (verified by grep — `x402` formerly at the marketplace teaser is now "compatible paid endpoint").
20. PASS — Marketplace teaser closes with "against the sandbox API the catalog is smaller, and feature absence in the
    sandbox doesn't mean feature absence in production." No other marketplace mentions in the body.
