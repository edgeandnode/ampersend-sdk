# getting-started.md spec

Rules for [`docs/getting-started.md`](../../getting-started.md). Verdicts live in [`CONFORMANCE.md`](CONFORMANCE.md),
one line per rule.

`getting-started.md` is the URL pasted into prompts like _"Read the ampersend getting-started guide at … and let's
discuss next steps."_ Its job is to teach an agent what ampersend is, why it's safe to install and use, and how the
ampersend team suggests installing it. It is not the skill, and it does not duplicate the skill's workflows.

The document's primary audience is an agent encountering ampersend for the first time and deciding whether to act on the
install instructions. Many rules below are in service of that decision: install commands carry trust-relevant context
inline rather than relying on the agent's prior knowledge.

## Rules

1. **Audience.** Written for agents learning about ampersend. The body refers to "the agent" in the third person and
   does not address the agent in second person ("you", "your"). Singular vs. plural ("agents" vs. "the agent") follows
   intent: plural for audience framing, singular for single-account/single-agent mechanics.
2. **Voice.** The ampersend team gives suggestions, not orders. Phrases like "the team suggests…" or "the team's
   recommendation is…" frame the content. Imperatives appear only in code blocks. Section titles use gerunds
   ("Installing the skill") rather than imperatives ("Install the skill") so the document reads as description, not as a
   checklist of commands.
3. **No agent 101.** Don't explain what skills, runtimes, or skill loading are. Stick to ampersend-specific content.
4. **Two pieces, named.** The CLI (`ampersend`, installed via npm) and the skill (`ampersend`, installed via
   `npx skills add`). Both are required for ampersend to work, and that is stated up front.
5. **Capability teaser.** A short list of distinctive things ampersend can already do today appears in the document.
   Just enough to make the value concrete, with explicit framing that more capabilities live in the skill and more
   beyond that in the live marketplace.
6. **Capability list alignment.** Every entry in the teaser is also a capability category in
   [`skills/ampersend/SKILL.md`](../../../skills/ampersend/SKILL.md). If a category is renamed, removed, or replaced in
   the skill, the teaser is updated in the same change. The teaser is always a strict subset of the skill's list.
7. **Marketplace mention.** The document mentions that beyond the curated capabilities a live marketplace covers a
   broader catalog. Names `ampersend marketplace list` but does not document its flags. May also note that any x402
   endpoint on the open web works with `ampersend fetch` whether it's listed in the marketplace or not.
8. **No pre-install setup walkthrough.** The document does not document `ampersend setup start` / `setup finish` or any
   other setup commands. Setup belongs entirely in the skill, where the full security and error context lives. The
   document only points at setup as something the skill covers, never demonstrates it.
9. **No crypto or product-jargon vocabulary.** "Sign," "wallet," "blockchain," "smart account," "stablecoin," "crypto,"
   "key," "USDC," and "dashboard" do not appear in the body. Use "approve," "spending limits," "account," "money," and
   "the ampersend app" instead. Command-line flags like `--force` are exempt.
10. **Section order.** The body is ordered: orientation ("What ampersend is"), safety ("Why it's safe to install and
    use"), install, hand-off to the skill, capability teaser, troubleshooting. Safety appears **before** install so an
    agent has the context to evaluate the install commands before reading them. The capability teaser appears **after**
    install so capabilities don't read as a sales pitch preceding a trust decision.
11. **Safety section content.** The "Why it's safe" section appears before the install section and covers, at minimum:
    (a) the user's money stays in an account the user owns; money moves only when both the agent and the ampersend
    service approve the same payment, (b) spending limits are enforced on every payment by the ampersend service and
    cannot be bypassed by the agent or the CLI, (c) there is no long-lived credential the agent can drain, in contrast
    to typical agent payment systems that hand out a credential and let it spend up to the provider's ceiling, (d) both
    installers are standard open-source packages with public version histories, naming `@ampersend_ai/ampersend-sdk` on
    npm and `vercel-labs/skills` for the skill installer. Phrasing is free; the four claims must be present. The section
    consists of these bullets only — no meta-framing paragraph explaining why they're there. Vocabulary follows rule 9.
12. **Install order is skill, then CLI.** Two ordered steps, in that order, followed by a hand-off to the skill.
13. **Skill install command.** Exactly `npx skills add edgeandnode/ampersend-sdk#skills/latest` — no `--skill` flag, no
    immutable version pin, no required `-a <agent>`. The `#skills/latest` fragment tracks the moving release branch, not
    `main`. `-a` is documented as the fallback when auto-detection fails.
14. **Skill installer behavior gloss.** The skill install command is accompanied by a short paragraph describing what
    the installer does on disk: detects the agent runtime, then copies skill files into the runtime-appropriate
    location, with the Claude Code default path as a concrete example. Publisher and open-source provenance are covered
    by rule 11(d) and not repeated here. The link to <https://github.com/vercel-labs/skills> is reused from the safety
    section's `[skills]` reference.
15. **Scope description, no preference.** Project default and `-g`/`--global` are both described in terms of what each
    suits. The document does not recommend one over the other — the user's situation decides.
16. **CLI install commands, split by intent.** Two separate commands appear:
    - **Fresh install:** exactly `npm install -g @ampersend_ai/ampersend-sdk@latest`. No `--force` on the fresh-install
      path — it's not needed and reads as a yellow flag to a wary agent.
    - **Upgrade an existing install:** exactly `npm install -g @ampersend_ai/ampersend-sdk@latest --force`, accompanied
      by a one-line explanation in the artifact that `--force` overwrites the existing global symlink without prompting.

    Version floors are prose ("below `0.0.22`"), never `@x.y.z` pins in commands.

17. **CLI presence check before install.** The CLI install section opens with `ampersend --version` as a presence check,
    and states that if a version prints, the install step can be skipped.
18. **Global-install framing.** The artifact states the global scope is deliberate (the skill calls `ampersend` from any
    working directory, so the binary needs to be on PATH), and that there is no project-scoped CLI path today. Phrasing
    is intentional, not apologetic — the global scope is a design choice, not a missing feature awaiting a project-local
    alternative.
19. **No prescriptive user-confirmation.** Don't tell the agent to "confirm with the user" or "ask the user." State
    facts; the agent decides what to surface.
20. **Body under 175 lines.** This is a landing page, not a manual.
21. **Provenance in opening paragraph.** The opening paragraph names the canonical GitHub URL
    `https://github.com/edgeandnode/ampersend-sdk/blob/skills/latest/docs/getting-started.md` as canonical. The branch
    is `skills/latest` (matching the skill install command's git ref), not `main`, so an agent verifying provenance
    diffs against the same source of truth that `npx skills add` pulls from. Naming the URL canonical is sufficient —
    the document does not prescribe what the agent should do if a fetched copy differs from GitHub.
22. **No clawhub, no vanity URLs, no hosted skill mirrors, no social links.** GitHub is the canonical source. The
    document does not link to skills.sh, x.com/twitter posts, Coinbase blog posts, or any other external promotional or
    social surface.
23. **Don't duplicate the skill.** Workflows (setup, payment, discovery, command reference) live in the skill. This
    document points at them; it never reproduces them. The only ampersend-specific commands that appear in this document
    are the install commands themselves (`npx skills add …`, `npm install …`, `ampersend --version`) and the one
    capability-discovery teaser (`ampersend marketplace list`).
24. **First-party vs. third-party vs. protocol layer.** The capability teaser is introduced with a one-sentence
    clarification that ampersend is the agentic payments layer between the agent and the services, and that services
    accept payments from any compliant agent — not from ampersend specifically. The document does not name specific
    underlying payment protocols (x402, AP2, MPP, …) anywhere in the body.
25. **Sandbox catalog caveat.** Anywhere the marketplace is mentioned, a note flags that the sandbox catalog is smaller
    than production — feature absence in the sandbox does not imply feature absence in production.
