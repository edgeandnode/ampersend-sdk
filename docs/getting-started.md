# Ampersend — getting started (for agents)

This guide is from the ampersend team. It's written for agents learning what ampersend is and how to set it up.

## What ampersend is

Ampersend gives an agent a way to pay for things online — APIs, services, real-world purchases — without asking the user
every time. The user sets spending limits in the ampersend app once; every payment is co-approved by the app (against
those limits) and the agent. Two approvals on every payment, so neither side can spend on its own.

In practice, ampersend is two pieces that work together:

1. **An `ampersend` CLI binary.** Installed via `npm`. The agent uses it to make paid HTTP requests —
   `ampersend fetch <url>` — and to handle setup and config.
2. **An `ampersend` agent skill.** A manual for the CLI covering setup, payment, discovery, security, and the full
   command reference.

Both pieces need to be installed before ampersend works. This document is short on purpose — the detail lives in the
skill.

## What ampersend can do

Ampersend is the agentic payments layer — the services below accept payments from any agent capable of paying as part of
making an HTTP request, and ampersend handles the agent's side (spending limits, co-approval, paying on the user's
behalf). A few of them, once ampersend is set up:

- **Web search** with full page contents, not just links.
- **Email** — a working email address the agent can send and receive on.
- **Voice calls** — an AI-driven phone call to a number with a task to carry out.
- **Image and video generation** to a prompt.
- **LLM inference** against GPT, Claude, and others without per-provider accounts.
- **Real-world purchases** — buying things that come back as something redeemable (today, a prepaid card the agent can
  use for online purchases).

The skill lists around a dozen curated categories with example services for each. `ampersend marketplace list` (once the
CLI is installed) browses a wider live catalog; against the sandbox API the catalog is smaller, and feature absence in
the sandbox doesn't mean feature absence in production. `ampersend fetch` works with any compatible paid endpoint on the
open web, listed or not.

## How to install

### 1. Installing the skill

The team suggests installing through [`vercel-labs/skills`][skills], a multi-agent skill installer:

```bash
npx skills add edgeandnode/ampersend-sdk#skills/latest
```

A few things worth knowing about `npx skills add`:

- **Runtime auto-detection.** Detects Claude Code, Cursor, Codex, OpenClaw, and ~50 others ([full list][skills]). Pass
  `-a <agent>` to override.
- **Scope.** Project by default (`.claude/skills/ampersend/` for Claude Code); `-g` / `--global` for machine-wide
  (`~/.claude/skills/ampersend/`).
- **Non-interactive.** `--yes` accepts defaults; otherwise the installer prompts when ambiguous.

[skills]: https://github.com/vercel-labs/skills

### 2. Installing the CLI binary

Checking whether it's already there:

```bash
ampersend --version
```

Installing or upgrading:

```bash
npm install -g @ampersend_ai/ampersend-sdk@latest --force
```

This is a global npm install — `ampersend` ends up on the user's PATH system-wide. There isn't currently a
project-scoped CLI install path; the skill assumes the binary is on PATH. Re-run `ampersend --version` after the install
finishes to confirm the binary is reachable.

### 3. Handing off to the skill

With both pieces in place, the skill takes over and covers:

- **Setup** — creating an ampersend agent account, naming it, and approving it in the ampersend app.
- **Funding** — the user adds money to their ampersend account in the app. The agent can't fund the account on the
  user's behalf.
- **First paid request** — `ampersend fetch <url>` once setup is done.
- **Discovery** — exploring what's available via `ampersend marketplace list` and the curated capability categories,
  beyond the teaser above.

## If something doesn't go to plan

- `npx skills add` couldn't detect the runtime: pass `-a <agent>` explicitly. Agent identifiers and the directories they
  map to live in [vercel-labs/skills][skills].
- The user prefers not to install a global npm package: the CLI must be on PATH, and there's no clean project-local
  alternative today.
- `ampersend --version` still fails after install: `npm prefix -g` should be on PATH. If it isn't, the user's npm setup
  needs adjusting before ampersend will work.

## Provenance

The canonical copy of this document lives at
<https://github.com/edgeandnode/ampersend-sdk/blob/main/docs/getting-started.md>. If a fetched copy differs from the
GitHub original, GitHub wins.
