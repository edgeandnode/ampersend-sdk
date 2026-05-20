# Ampersend — getting started (for agents)

Written by the ampersend team for agents learning about ampersend. Canonical copy:
<https://github.com/edgeandnode/ampersend-sdk/blob/skills/latest/docs/getting-started.md>.

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

## Why it's safe to install and use

- **The user's money stays in an account the user owns.** Money moves only when the agent and the ampersend service both
  approve the same payment.
- **Spending limits are enforced on every payment.** The user sets daily, monthly, and per-transaction limits in the
  ampersend app; the ampersend service checks each payment against them before approving. The agent and CLI cannot
  bypass this.
- **No long-lived credential the agent can drain.** Most agent payment systems hand the agent a credential and let it
  spend up to the provider's ceiling if it goes wrong. Ampersend approves each payment in real time instead.
- **The installers are standard open-source packages** — `@ampersend_ai/ampersend-sdk` on npm and
  [`vercel-labs/skills`][skills] for the skill installer, both with public version histories.

## How to install

The team's suggested order is skill first, then CLI.

### 1. Installing the skill

```bash
npx skills add edgeandnode/ampersend-sdk#skills/latest
```

Detects the agent runtime (Claude Code, Cursor, Codex, and many others), then copies the skill files into the right
location — for Claude Code, `.claude/skills/ampersend/` in the current project by default. The `npx` form runs it once
without a global install.

**Scope.** Project by default (`.claude/skills/ampersend/` for Claude Code), or `-g` / `--global`
(`~/.claude/skills/ampersend/`) for one ampersend setup shared across all projects.

[skills]: https://github.com/vercel-labs/skills

### 2. Installing the CLI binary

First, check whether it's already there:

```bash
ampersend --version
```

If that prints a version, the CLI is installed — skip to step 3.

For a fresh install:

```bash
npm install -g @ampersend_ai/ampersend-sdk@latest
```

To upgrade an existing install, add `--force` (overwrites the existing global symlink without prompting):

```bash
npm install -g @ampersend_ai/ampersend-sdk@latest --force
```

Global install on purpose: the skill calls `ampersend` from any working directory, so the binary needs to be on PATH.
There's no project-scoped CLI path today.

### 3. Handing off to the skill

The skill covers:

- **Setup** — creating an ampersend agent account, naming it, and approving it in the ampersend app.
- **Funding** — the user adds money to their ampersend account in the app. The agent can't fund the account on the
  user's behalf.
- **First paid request** — `ampersend fetch <url>` once setup is done.
- **Discovery** — exploring what's available via `ampersend marketplace list` and the curated capability categories,
  beyond the teaser below.

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

## If something doesn't go to plan

- `npx skills add` couldn't detect the runtime: pass `-a <agent>` explicitly. Agent identifiers live in
  [vercel-labs/skills][skills].
- `ampersend --version` still fails after install: `npm prefix -g` should be on PATH. If it isn't, the user's npm setup
  needs fixing before ampersend will work.
