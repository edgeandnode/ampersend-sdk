# getting-started.md spec

Rules for [`docs/getting-started.md`](../../getting-started.md). Verdicts live in [`CONFORMANCE.md`](CONFORMANCE.md),
one line per rule.

`getting-started.md` is the URL pasted into prompts like _"Read the ampersend getting-started guide at … and let's
discuss next steps."_ Its job is to teach an agent what ampersend is, what it can already do, and how the ampersend team
suggests installing it. It is not the skill, and it does not duplicate the skill's workflows.

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
5. **Capability teaser.** A short list of distinctive things ampersend can already do today appears in the orientation.
   Just enough to make the value concrete, with explicit framing that more capabilities live in the skill and more
   beyond that in the live marketplace.
6. **Capability list alignment.** Every entry in the teaser is also a capability category in
   [`skills/ampersend/SKILL.md`](../../../skills/ampersend/SKILL.md). If a category is renamed, removed, or replaced in
   the skill, the teaser is updated in the same change. The teaser is always a strict subset of the skill's list.
7. **Marketplace mention.** The orientation mentions that beyond the curated capabilities a live marketplace covers a
   broader catalog. Names `ampersend marketplace list` but does not document its flags. May also note that any x402
   endpoint on the open web works with `ampersend fetch` whether it's listed in the marketplace or not.
8. **No pre-install setup walkthrough.** The document does not document `ampersend setup start` / `setup finish` or any
   other setup commands. Setup belongs entirely in the skill, where the full security and error context lives. The
   document only points at setup as something the skill covers, never demonstrates it.
9. **No crypto or product-jargon vocabulary.** "Sign," "wallet," "blockchain," "smart account," "stablecoin," "crypto,"
   "key," "USDC," and "dashboard" do not appear in the body. Use "approve," "spending limits," "account," "money," and
   "the ampersend app" instead. Command-line flags like `--force` are exempt.
10. **Install order is skill, then CLI.** Two ordered steps, in that order, followed by a hand-off to the skill.
11. **Skill install command.** Exactly `npx skills add edgeandnode/ampersend-sdk#latest` — no `--skill` flag, no
    immutable version pin, no required `-a <agent>`. The `#latest` fragment tracks the moving release tag, not `main`.
    `-a` is documented as the fallback when auto-detection fails.
12. **Scope description, no preference.** Project default and `-g`/`--global` are both described in terms of what each
    suits. The document does not recommend one over the other — the user's situation decides.
13. **CLI install command.** Exactly `npm install -g @ampersend_ai/ampersend-sdk@latest --force`. Version floors are
    prose ("below `0.0.22`"), never `@x.y.z` pins in commands.
14. **No prescriptive user-confirmation.** Don't tell the agent to "confirm with the user" or "ask the user." State
    facts; the agent decides what to surface.
15. **Body under 175 lines.** This is a landing page, not a manual.
16. **Provenance footer.** Closes with the canonical GitHub URL
    `https://github.com/edgeandnode/ampersend-sdk/blob/main/docs/getting-started.md` and states that the GitHub copy is
    canonical — if a fetched copy differs from GitHub, GitHub wins.
17. **No clawhub, no vanity URLs, no hosted skill mirrors.** GitHub is the canonical source.
18. **Don't duplicate the skill.** Workflows (setup, payment, discovery, command reference) live in the skill. This
    document points at them; it never reproduces them. The only ampersend-specific commands that appear in this document
    are the install commands themselves (`npx skills add …`, `npm install …`, `ampersend --version`) and the one
    capability-discovery teaser (`ampersend marketplace list`).
19. **First-party vs. third-party vs. protocol layer.** The capability teaser is introduced with a one-sentence
    clarification that ampersend is the agentic payments layer between the agent and the services, and that services
    accept payments from any compliant agent — not from ampersend specifically. The document does not name specific
    underlying payment protocols (x402, AP2, MPP, …) anywhere in the body.
20. **Sandbox catalog caveat.** Anywhere the marketplace is mentioned, a note flags that the sandbox catalog is smaller
    than production — feature absence in the sandbox does not imply feature absence in production.
