# SKILL.md spec

Rules the `SKILL.md` in this directory must follow. Latest verdict per rule lives in
[`SKILL.conformance.md`](SKILL.conformance.md).

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
   how to talk about the product to users — and not something the model already knows from training.
10. Terminology is consistent throughout — the same concept uses the same word every time.
11. There are no hard version pins; install commands use `@latest` and version floors are prose, not `@x.y.z`.
12. Every product-specific term is glossed in one line the first time it appears.
13. Tier-1 and tier-2 user-facing explainers do not use the words "crypto", "wallet", "blockchain", "smart account", or
    "stablecoin"; tier-3 may, only when the user asks about underlying tech.
14. The skill instructs the agent never to log into the ampersend dashboard from a browser it controls, and to always
    show the verification code alongside the approval URL.
