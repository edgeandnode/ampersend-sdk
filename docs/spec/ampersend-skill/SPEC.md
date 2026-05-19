# SKILL.md spec

Rules the [`skills/ampersend/SKILL.md`](../../../skills/ampersend/SKILL.md) must follow. Latest verdict per rule lives
in [`CONFORMANCE.md`](CONFORMANCE.md).

When writing the conformance file: one line per rule, formatted `N. PASS|FAIL — short evidence.` No headings, no extra
prose.

## Rules

1. Frontmatter has `name` (kebab-case, ≤ 64 chars) and `description` (≤ 1024 chars), and any other fields conform to the
   [agentskills.io](https://github.com/agentskills/agentskills) spec.
2. The description, in two sentences or fewer, says what the skill does and when to use it, in words a user would
   actually say, with no first-person pronouns.
3. The description is slightly pushy ("Use when…") rather than passive ("can be used for…") — agents tend to
   under-trigger skills.
4. The skill name in frontmatter matches the parent directory name.
5. The body is under 500 lines.
6. The body reads top-to-bottom as orientation → when to use → workflows → pointers to references, with workflows as
   numbered steps rather than prose.
7. `references/` is exactly one level deep, and flag tables, exhaustive option lists, and edge-case detail live there
   rather than in `SKILL.md`.
8. Reference files longer than 100 lines start with a table of contents.
9. Every claim in the body is system-specific — security boundaries, calling conventions, gotchas, judgment calls, or
   how to talk about the product to users — and not something the model already knows from training. Exception: a
   curated showcase of third-party services known to accept ampersend payments may live in `references/`, since the
   value is curation (we vouched for these), not training-derivable facts. Response patterns — services the agent must
   know how to handle when the user provides a matching URL but doesn't suggest proactively — are also allowed there.
   The body of `SKILL.md` itself stays system-specific and may name capability categories but not specific services.
10. Terminology is consistent throughout — the same concept uses the same word every time.
11. There are no hard version pins; install commands use `@latest` and version floors are prose, not `@x.y.z`.
    Skill-installer commands (`npx skills add …`) use the moving `#latest` git-ref fragment to track the most recent
    released skill, not `main` or an immutable `#v0.0.x` tag.
12. Every product-specific term is glossed in one line the first time it appears.
13. Tier-1 and tier-2 user-facing explainers do not use the words "crypto", "wallet", "blockchain", "smart account", or
    "stablecoin"; tier-3 may, only when the user asks about underlying tech.
14. The skill instructs the agent never to log into the ampersend dashboard from a browser it controls, and to always
    show the verification code alongside the approval URL.
15. Directive language ("don't", "never", "must") is reserved for safety boundaries where the agent has no judgment call
    to make. Style, tone, and product-explanation preferences are framed as guidance ("prefer X because Y", "the user
    typically expects Z") so the agent can adapt when context calls for it.
16. Capability categories in `SKILL.md` and entries in `references/example-services.md` stay aligned: every capability
    named in the body has at least one example service in the references file, and every example service either maps
    back to a named capability or sits in a separate "response patterns" section for services the agent doesn't suggest
    proactively but must know how to handle when the user provides a matching URL. A capability with no example is a
    dead end for the agent, so prune it from the body until an example lands.
17. Ampersend is distinguished from (a) the third-party services that accept payment, and (b) the underlying agentic
    payments protocols that carry the payments. The body frames ampersend as the agent-side payment layer enforcing the
    user's policy; services as accepting payments from any compliant agent (not specifically ampersend); and specific
    protocol names (x402, AP2, MPP, …) do not appear in the body of `SKILL.md` as a generic descriptor of what services
    "accept." Protocol names may still appear in `references/` and in code blocks where the literal command or URL
    contains them.
18. Anywhere the sandbox API URL is mentioned, the document states explicitly that the sandbox carries a subset of
    services and capabilities — feature absence in the sandbox does not imply feature absence in production.
19. Frontmatter carries a `version` field matching the released CLI version the skill was published against. The body
    instructs the agent to run `ampersend version` (which prints both `cliVersion` and `minSkillVersion` in the standard
    JSON envelope), compare the skill's frontmatter `version` against `minSkillVersion`, and if the skill is older, run
    `npx skills update ampersend` to upgrade. The CLI-upgrade path (when the binary is missing or below the version
    floor) remains the separate `npm install -g …@latest --force` instruction.
