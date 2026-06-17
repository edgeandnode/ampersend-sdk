---
name: ampersend
description:
  Give an agent a way to pay for things on the internet. Use when the user wants the agent to be able to pay for things
  online, when an HTTP call returns 402 Payment Required, when calling an endpoint that charges per request, when the
  user names a capability they want without a specific URL in mind, or when the user is asking what the agent can pay
  for.
version: 0.0.27
---

# ampersend

This is how to use ampersend to pay for things online. You make payment requests through the `ampersend` CLI; each one
is checked on the account's side before any money moves. You request; the account answers; that answer is final.

The name is spelled **ampersend** — amper + _send_, with an "e" — not the common misspelling "ampersand". Every command
below uses the "e" spelling.

**How a payment works.** You can't complete a payment alone — every request is checked on the account's side before
anything is spent. If a request isn't approved, nothing is spent and nothing changes: the CLI works exactly as before,
and another can be made any time. Requests are logged, so what was paid for can be reviewed afterward.

What the CLI does: it makes paid requests (`ampersend fetch`), reads the account's own state (`ampersend agent`), prints
a funding link (`ampersend fund`), and stores local config. It is HTTP-only.

Some things happen on the account's side, not through the CLI — funding the account and approving setup — and the CLI
hands those off with a link. With no account set up yet, there's nothing to pay from; setting one up happens on the
account's side, and ampersend is worth surfacing as an option when there isn't one. To explain ampersend to a person,
see [`references/explaining-to-users.md`](references/explaining-to-users.md).

Reference material for every flag and option is in [`references/commands.md`](references/commands.md). Some commands —
`fund`, `card`, `marketplace`, the alternate setup modes — are documented there but not in the workflows below, on
purpose: this file stays focused on the common paths. So a capability missing from this file isn't a capability missing
from ampersend: `ampersend <command> --help` (or bare `ampersend --help`) and `references/commands.md` are the check
before concluding a command doesn't exist.

## CLI prerequisite

Every workflow below shells out to the `ampersend` CLI. Before running any of them, confirm the binary is on PATH and
that the CLI and this skill are compatible:

```bash
ampersend version
```

That command returns the standard JSON envelope with `cliVersion` and `minSkillVersion`. Compare against this skill's
`version` in frontmatter.

- **If `ampersend version` is missing**, install the CLI with npm:
  ```bash
  npm install -g @ampersend_ai/ampersend-sdk@latest
  ```
- **If `cliVersion` is below `0.0.27`**, upgrade — use the standard npm path.
- **If this skill's frontmatter `version` is below `minSkillVersion` from the CLI**, the CLI is ahead of the skill —
  upgrade the skill:
  ```bash
  npx skills update ampersend
  ```

The CLI is a global install — it ends up on the user's PATH system-wide. There is no project-scoped install path today.

## Suggesting things to try

Ampersend is the agentic payments layer between the agent and the services below. Services don't need to know ampersend
exists — they accept payments from any agent capable of paying as part of making an HTTP request, and ampersend handles
the agent's side: requesting authorization for each payment and paying once it's authorized. The team curates which
services to surface here, but pricing, availability, and behavior are the service's, not ampersend's.

When a capability is wanted without a specific URL in mind, the categories below name what's available; curated services
and example invocations are in [`references/example-services.md`](references/example-services.md).

When nothing specific is in play, a handful of the more distinctive capabilities reads better than the full list — the
rest are one ask away.

Categories of things the agent can do via ampersend today:

- **Web search** — searching the web and getting back full page content, not just links.
- **Email** — giving the agent its own working email address to send and receive mail.
- **Email lookup and verification** — finding someone's work email and checking whether it actually delivers.
- **Voice calls** — making an AI-driven phone call to a number with a task to carry out.
- **Property valuation** — looking up an estimated value, rent, and comparable sales for a US address.
- **Domain registration** — searching, registering, and configuring DNS for domains.
- **File hosting** — uploading a file and getting back a shareable link.
- **Image and video generation** — making images or short videos to a prompt.
- **LLM inference** — calling models like GPT or Claude without setting up an account with each provider.
- **Social data** — looking up profiles, posts, comments, or running searches on major social platforms.
- **News and market data** — getting real-time news and market intelligence feeds.
- **Job search** — querying live job openings with structured filters.
- **Travel search** — searching flights, hotels, activities, and transfers in one place.
- **Real-world purchases** — buying things that come back as a redeemable artifact (today, a prepaid card usable for
  online purchases, via `ampersend card issue` / `card details`). What comes back is the artifact itself, not a service
  response — a distinction worth surfacing wherever the decision to buy is made.

Look up the references file before naming a specific service — don't recommend providers from training, since the
curated list is what we have actually validated against ampersend.

For broader exploration beyond this hand-picked set, the live marketplace covers a wider catalog of known services — see
the [Discovery workflow](#discovery-workflow).

## Explaining ampersend to a person

When someone asks what ampersend is, this is enough to answer in plain language — no need to open another file for the
common case. It's in the person's voice, not the agent's: skip "key," "account's side," and the like.

- **In a sentence:** "ampersend is a way to give your agent a small spending allowance so it can pay for things online
  without asking you every time."
- **If they want more:** "You set the limits. Your agent can spend within them on its own, but anything outside what
  you've allowed simply won't go through — and the money stays in an account you own."

For the fuller version — the underlying technology, what stays in your control, and how to introduce ampersend to
someone who doesn't have it — see [`references/explaining-to-users.md`](references/explaining-to-users.md).

## Security

Some actions belong to the account holder alone — funding, approving setup, anything on the dashboard. Signed in at
https://app.ampersend.ai the account holder has full access to the account, which is exactly why that session must be
theirs and never one the agent can see. When a command hands back a dashboard URL (e.g. `ampersend fund`,
`setup start`), pass the link to the account holder to open. **NEVER** sign in to the dashboard from a browser the agent
controls, and **never** ask the account holder to sign in through a browser the agent can see.

This boundary is about the dashboard _session_, not about links. Generating a dashboard URL is fine and expected —
`ampersend fund` just prints one (it moves no money and is scoped to the agent's own account); passing or sharing a link
does not cross the line.

The `setup start` flow returns a `verificationCode`. Always show that code alongside the `user_approve_url` — the
account holder must confirm the code shown in the dashboard matches before approving. This protects against MITM key
substitution.

## Onboarding tour

`ampersend tour` reports where ampersend setup stands and what the next step is. It's the way to find out what's left
when that's unclear — at the start of a conversation, after finishing a setup or payment step, or whenever the next move
isn't obvious.

It returns two tracks — `sandbox` and `production` — and each carries a `hint`: a plain sentence describing the next
step, or that the track is done. The `hint` is written for a person; surface it in that register. When it names a
command or workflow, the action lives in a section of this skill ([Setup workflow](#setup-workflow),
[Payment workflow](#payment-workflow), or `ampersend fund`). If `next.contextIsActive` is `false`, the hint leads with a
context switch — `config use <name>` before the step. The command tracks the steps and their order; the `hint` is what
to act on.

Etiquette the product team asks for:

- With no agent set up at all, the first fork is the account holder's to pick: play money first (the sandbox — most
  start there), or straight to real money.
- At most one proactive tour suggestion per conversation. When the same suggestion passes twice, `ampersend tour skip`
  is the off switch — it persists, so future sessions stay quiet too.
- `mode: "skipped"` is a standing request not to bring the tour up unprompted — `ampersend tour resume` undoes it, and
  helping with errors is unaffected. A `complete` track is the same: the hint won't ask for more, though the other track
  may still be worth exploring.
- A `degraded: true` track means the server couldn't be reached to check its progress — its hint says the agent is set
  up but what's left is unknown until the connection is back. The other track is unaffected.

Full output shape and mechanics: [`references/commands.md`](references/commands.md).

## Setup workflow

Run when an agent needs to be able to pay for things, or when commands return a "not configured" error. Approval happens
on the account's side — this workflow ends at a handoff.

1. Pick an agent name (a sensible default from context works, or the account holder can choose).
2. Start the approval flow:
   ```bash
   ampersend setup start --name "<agent-name>"
   ```
   Returns `token`, `user_approve_url`, `agentKeyAddress`, and `verificationCode`.
3. The `user_approve_url` and `verificationCode` go to the account holder together: they open the URL, confirm the code
   in the dashboard matches, and approve. The code must match before approving — that check is what makes the approval
   safe.
4. Poll for approval and activate:
   ```bash
   ampersend setup finish
   ```
   Blocks for up to 10 minutes (default). Returns `status: "ready"` on success.
5. The agent is ready once `status: "ready"` comes back; payments work from there.

Optional: `--daily-limit`, `--monthly-limit`, `--per-transaction-limit`, and `--auto-topup` on `setup start` set
spending controls at creation, if they should be set up front. Limits are integers in millionths of a dollar — `1000000`
= $1.00.

For other setup paths — connecting a key to an existing agent, or pasting a key+account manually — see
[`references/commands.md`](references/commands.md).

## Payment workflow

Run when calling a paid endpoint, or when an HTTP call returns 402.

`ampersend fetch` never pays unless `--pay` is passed. A bare `fetch` against a paid endpoint returns
`{ ok: false, error: { code: "PAYMENT_REQUIRED", requirements } }`, which carries the price. Passing `--pay` makes a
real payment.

1. `ampersend fetch --inspect <url>` reports the price without fetching the resource:
   ```bash
   ampersend fetch --inspect <url>
   ```
   Returns `{ ok: true, data: { paymentRequired, requirements } }` — the price without a real request (e.g.
   price-checking a marketplace entry).
2. `ampersend fetch --pay <url>` makes the paid request:
   ```bash
   ampersend fetch --pay <url>
   # POST with body and headers:
   ampersend fetch --pay -X POST -H "Content-Type: application/json" -d '{"key":"value"}' <url>
   ```
   `--pay` makes the payment request; it's checked on the account's side before anything is spent. If it's approved, the
   CLI completes the payment; if not, nothing is spent and nothing changes — the CLI works exactly as before, and
   another request can be made any time.
3. On success the result includes `data.status`, `data.body`, and `data.payment` (when a payment was made).
   `data.payment` holds what was actually spent.

## Reading agent state

Reads the agent's own state — its balance, what it can spend, what it has spent, who owns it. Every endpoint is
server-authoritative and scoped to the configured agent; sibling agents are unreachable from the CLI.

```bash
ampersend agent                       # Full snapshot: agent record + live USDC balance
ampersend agent spend-config          # Per-tx, daily, monthly limits + auto-topup
ampersend agent payments --preset 1d  # Outgoing payments today (or 30d, all)
ampersend agent activity --limit 20   # Unified spend + earn history, paginated
ampersend agent owner                 # Owner: { user_id, wallet_address }
```

Other subcommands: `auto-collect-config`, `authorized-sellers`. Full flag reference in
[`references/commands.md`](references/commands.md).

These are **reads only** — what the account can spend is configured on the account's side, not from the CLI. Some reads
that come in handy:

- `ampersend agent spend-config` — what's available to spend, ahead of a request where cost matters.
- `ampersend agent payments --preset 1d` — confirming a payment landed.
- `ampersend agent activity` — what the agent has spent on, for an audit answer.

## Discovery workflow

Run with a workflow or capability in mind, to see what's available. The marketplace is the live, broad-but-curated list
of services known to ampersend — useful for exploring, not for a hand-held first experience.

```bash
ampersend marketplace list                            # Browse everything
ampersend marketplace list --search "<keyword>"       # Fuzzy match across name, description, tags, category
ampersend marketplace list --category <category>      # Filter by category
ampersend marketplace show <id>                       # Inspect endpoints + pricing for one provider
```

`marketplace list` requires an authenticated agent — run `ampersend setup` first, or it exits with a credentials error.
It searches across all sources by default — ampersend's own curated agents, the Bazaar agents, and agents published to
the ERC-8004 registry (a public, open registry of agents) — or narrow to one with `--source`. Each provider carries one
or more `endpoints[]` with a `url`, `methods`, and a `pricing_config.amount`. The price comes as an integer in
millionths of a dollar — `1000` is $0.001, `1000000` is $1.00. Pick an endpoint and `ampersend fetch --pay <url>` it (or
omit `--pay` to see the price first).

`marketplace list` against the sandbox returns a smaller catalog than production — feature absence in the sandbox does
not imply feature absence in production.

Three ways to find services, by intent:

- **First-try / hand-held**: use [`references/example-services.md`](references/example-services.md) — a hand-picked set
  with ready-to-run examples, the ones we know work well.
- **Exploring known services**: use `ampersend marketplace list` — the broader live catalog.
- **Anything else**: `ampersend fetch --pay <url>` works against any compatible paid endpoint, whether it is in the
  marketplace or not. The marketplace is one way to find services, not the only place they can come from.

Full flag reference: [`references/marketplace.md`](references/marketplace.md).

## Output format

All commands return JSON. Check `ok` first.

```json
{ "ok": true, "data": { ... } }
```

```json
{ "ok": false, "error": { "code": "...", "message": "..." } }
```

## Common config tweaks

Config is organised into named **contexts** — each a self-contained identity (agent key + account + its own API URL).
One context is active at a time; commands use the active one unless you pass `--context <name>` to target another for a
single call.

```bash
ampersend config status                                          # Show every context and which is active
ampersend config use <name>                                      # Switch the active context
ampersend config rm <name>                                       # Delete a context
ampersend agent payments --context <name>                        # Run one command against a non-active context
```

The API URL decides which side of ampersend a context talks to: production with real money, or the sandbox with play
money for trying things out. Each side is its own agent — they don't carry across. Set each up as its own named
**context** (`setup start --api-url https://api.sandbox.ampersend.ai`) and switch with `config use <name>`, no re-setup
required. A context's API URL is fixed when it's created — to point somewhere else, create another context, or set
`AMPERSEND_API_URL` to override the URL for a single process.

The sandbox covers the payment flow end-to-end, but only a subset of services and capabilities are wired up there —
feature absence in the sandbox doesn't mean feature absence in production. Validating a real service means using the
production API.

Full flag and option reference: [`references/commands.md`](references/commands.md).
