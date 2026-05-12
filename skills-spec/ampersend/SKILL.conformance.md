# SKILL.md conformance

Latest verdict for each rule in [`SKILL.spec.md`](SKILL.spec.md). Regenerate when
[`skills/ampersend/SKILL.md`](../../skills/ampersend/SKILL.md) or `SKILL.spec.md` changes.

- **Generated against:** `skills/ampersend/SKILL.md` at HEAD
- **Date:** 2026-05-06
- **By:** Claude

1. PASS — `name: ampersend` (9 chars, kebab-case); description is 240 chars; no other frontmatter fields.
2. PASS — Two sentences; first says what, second says when; plain user words; no first-person pronouns.
3. PASS — Description leads with the imperative "Give an agent…" and triggers on "Use when…", not passive "can be used
   for…".
4. PASS — Frontmatter `name: ampersend` matches the parent directory `skills/ampersend/`.
5. PASS — Body is 137 lines.
6. PASS — Order is orientation → scope → user explainer → install → security → setup → payment → output → config; setup
   and payment workflows are numbered steps.
7. PASS — `references/` contains one file (`commands.md`); no subdirectories.
8. PASS — `references/commands.md` is 116 lines and starts with a "Contents" section listing every heading.
9. PASS — All sections cover system-specific content (cosign, service/CLI split, dashboard isolation, verification code,
   language tiers); "Output format" is borderline but pins the CLI's specific `ok`/`error.code` shape.
10. PASS — "co-sign" is hyphenated consistently throughout the prose; the unhyphenated `CoSignerValidator` is a code
    identifier and does not count.
11. PASS — Floor stated as prose ("v0.0.21 or newer"); install command uses `@latest`; no `@x.y.z` strings.
12. PASS — "ampersend service", "ampersend CLI", co-sign, smart account, x402, USDC, and Base are each glossed on first
    mention.
13. PASS — Tier 1 and tier 2 use only "spending allowance", "limits", "key", "account you own"; the flagged words appear
    only in tier 3 after the user asks about underlying tech.
14. PASS — Security section forbids dashboard login from a controlled browser; setup workflow requires showing
    `verificationCode` alongside `user_approve_url` and having the user confirm it matches.
15. PASS — Hard imperatives ("NEVER", "never", "Always show", "must confirm") appear only in the Security section, where
    they guard MITM/key-substitution boundaries. Style and product-explanation guidance ("just 'ampersend'", "the
    explanations below are how the product team prefers it described", "the third tier is reserved for users who
    explicitly ask…") is framed as preference with reasoning.
