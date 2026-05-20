---
name: ampersend
description:
  Give an agent a way to pay for things on the internet. Use when the user wants the agent to be able to pay for things
  online, when an HTTP call returns 402 Payment Required, when calling an endpoint that charges per request, when the
  user names a capability they want without a specific URL in mind, or when the user is asking what the agent can pay
  for.
version: 0.0.22
---

# ampersend CLI

ampersend gives an agent a way to pay for things online. The user creates an ampersend agent account once, sets spending
limits in the [ampersend dashboard](https://app.ampersend.ai/), and the agent can then pay within those limits without
prompting per request.

**Two things share the name "ampersend."**

- **The ampersend service** — holds one of two keys needed to spend from the agent's account, and co-signs each payment
  only if it satisfies the user's policy (spending limits, auto-topup rules, alerts). The user manages that policy
  through the [ampersend dashboard](https://app.ampersend.ai/).
- **The `ampersend` CLI** — a thin local binary the agent runs. Holds the other key. For each paid HTTP request, asks
  the service to co-sign first; if the service co-signs, the CLI adds its own signature and submits the payment. Also
  stores local config (API URL, agent key).

The user's funds live in a smart account on-chain that they own. Both keys must sign for any payment to go through, so
neither the agent nor ampersend can spend on their own.

To the user, all of this is just "ampersend" — the service/CLI split, keys, and smart accounts are internal plumbing
they don't need unless they ask.

**Scope of this CLI**: HTTP-only. It does three things: initial agent + CLI setup, runs `ampersend fetch <url>` (pays as
part of the request), and manage local config. **Not in this CLI**: spending limits, auto-topup, auto-collect,
transaction history, alerts — those live in the dashboard.

Reference material for every flag and option is in [`references/commands.md`](references/commands.md). Read it only when
you need flag-level detail.

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
- **If `cliVersion` is below `0.0.22`**, upgrade the existing install — the `--force` flag overwrites the existing
  global symlink without prompting:
  ```bash
  npm install -g @ampersend_ai/ampersend-sdk@latest --force
  ```
- **If this skill's frontmatter `version` is below `minSkillVersion` from the CLI**, the CLI is ahead of the skill —
  upgrade the skill:
  ```bash
  npx skills update ampersend
  ```

The CLI is a global install — it ends up on the user's PATH system-wide. There is no project-scoped install path today.

## Suggesting things to try

Ampersend is the agentic payments layer between the agent and the services below. Services don't need to know ampersend
exists — they accept payments from any agent capable of paying as part of making an HTTP request, and ampersend handles
the agent's side: enforcing the user's spending limits, co-approving each payment, and paying on the user's behalf. The
team curates which services to surface here, but pricing, availability, and behavior are the service's, not ampersend's.

When the user names something they want to do but doesn't have a specific URL in mind, or is asking what the agent can
pay for, surface the categories below and then look up curated services and example invocations in
[`references/example-services.md`](references/example-services.md).

In explore mode (the user has nothing specific in mind), don't dump the full list — pick a handful of the more
distinctive capabilities that tend to get a reaction, and offer to show the rest if the user wants more.

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
- **Real-world purchases** — buying things that come back as a redeemable artifact (today, a prepaid card the agent can
  then use for online purchases). The agent gets back the artifact, not a service response — flag this to the user
  before suggesting.

Look up the references file before naming a specific service — don't recommend providers from training, since the
curated list is what we have actually validated against ampersend.

For broader exploration beyond this hand-picked set, the live marketplace covers a wider catalog of known services — see
the [Discovery workflow](#discovery-workflow) above.

## Explaining ampersend to the user

If the user asks what ampersend is or how it works, the explanations below are how the product team prefers it
described. They're written in plain, non-technical language so they work for any user, regardless of crypto background.

**One sentence**: "ampersend is a way to give your agent a small spending allowance so it can pay for things online
without asking you every time."

**If they want more**: "You set the limits — daily, monthly, per-transaction — in the ampersend dashboard. Your agent
has one key, ampersend has another, and both have to agree before any payment goes through. The money stays in an
account you own."

**Only if they ask about the underlying tech**: "Today it uses a payment standard called x402 with USDC, a stablecoin
worth one US dollar, on a network called Base. More payment methods are coming."

The third tier is reserved for users who explicitly ask about the underlying tech — words like "crypto," "wallet,"
"blockchain," "smart account," and "stablecoin" tend to confuse rather than help users who just want to use their agent,
so the first two tiers stay free of them by default.

## Security

**NEVER** sign in to the ampersend dashboard from a browser the agent controls, and **never** ask the user to sign in
through a browser you can see. If configuration needs to change in the dashboard, the user does it themselves.

The `setup start` flow returns a `verificationCode`. Always show that code to the user alongside the `user_approve_url`
— the user must confirm the code shown in the dashboard matches before approving. This protects against MITM key
substitution.

## Setup workflow

Run when the user wants their agent to be able to pay for things, or when commands return a "not configured" error.

1. Ask the user for an agent name (or pick a sensible default from context).
2. Start the approval flow:
   ```bash
   ampersend setup start --name "<agent-name>"
   ```
   Returns `token`, `user_approve_url`, `agentKeyAddress`, and `verificationCode`.
3. Show the user **both** the `user_approve_url` and the `verificationCode`. Tell them to open the URL, confirm the code
   in the dashboard matches, and approve.
4. Poll for approval and activate:
   ```bash
   ampersend setup finish
   ```
   Blocks for up to 10 minutes (default). Returns `status: "ready"` on success.
5. Confirm the agent is ready before attempting any payments.

Optional: pass `--daily-limit`, `--monthly-limit`, `--per-transaction-limit`, or `--auto-topup` to `setup start` to
configure spending controls during creation. Limits are integers in millionths of a dollar — `1000000` = $1.00.

For other setup paths — connecting a key to an existing agent, or pasting a key+account manually — see
[`references/commands.md`](references/commands.md).

## Payment workflow

Run when the user asks to call a paid endpoint, or when an HTTP call returns 402.

1. Inspect the cost first when the price is unknown:
   ```bash
   ampersend fetch --inspect <url>
   ```
   Returns the payment requirements without paying.
2. Make the paid request:
   ```bash
   ampersend fetch <url>
   # POST with body and headers:
   ampersend fetch -X POST -H "Content-Type: application/json" -d '{"key":"value"}' <url>
   ```
   Spending limits set during setup or in the dashboard are enforced by the ampersend service when it co-signs the
   payment, and on-chain by the agent's `CoSignerValidator` module. A payment that would exceed a limit fails with a
   co-sign rejection — the agent and the CLI cannot bypass this.
3. On success, the result includes `data.status`, `data.body`, and `data.payment` (when a payment was made). Report what
   was actually spent from `data.payment`.

## Discovery workflow

Run when the user (or you) has a workflow or capability in mind and wants to see what is available. The marketplace is
the live, broad-but-curated list of services known to ampersend — useful for exploring, not for a hand-held first
experience.

```bash
ampersend marketplace list                            # Browse everything
ampersend marketplace list --search "<keyword>"       # Fuzzy match across name, description, tags, category
ampersend marketplace list --category <category>      # Filter by category
ampersend marketplace show <id>                       # Inspect endpoints + pricing for one provider
```

No setup needed to look around. Each provider carries one or more `endpoints[]` with a `url`, `methods`, and a
`pricing_config.amount`. The price comes as an integer in millionths of a dollar — `1000` is $0.001, `1000000` is $1.00.
Pick an endpoint and `ampersend fetch <url>` it as usual.

`marketplace list` against the sandbox returns a smaller catalog than production — feature absence in the sandbox does
not imply feature absence in production.

Three ways to find services, by intent:

- **First-try / hand-held**: use [`references/example-services.md`](references/example-services.md) — a hand-picked set
  with ready-to-run examples, the ones we know work well.
- **Exploring known services**: use `ampersend marketplace list` — the broader live catalog.
- **Anything else**: `ampersend fetch` works against any compatible paid endpoint, whether it is in the marketplace or
  not. The marketplace is one way to find services, not the only place they can come from.

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

```bash
ampersend config status                                          # Show current state
ampersend config set --api-url https://api.sandbox.ampersend.ai  # Use the sandbox (no real money)
ampersend config set --clear-api-url                             # Back to the real one
```

The API URL decides which side of ampersend your agent talks to: the real one with real money, or the sandbox with play
money for trying things out. Switching the URL after setup does **not** carry your existing agent across — each side is
its own agent, set up separately. Most people start with the sandbox, then set up a fresh agent on the real side when
they are ready to spend.

The sandbox covers the payment flow end-to-end, but only a subset of services and capabilities are wired up there —
feature absence in the sandbox doesn't mean feature absence in production. When the user wants to validate a real
service, point them at the production API.

Full flag and option reference: [`references/commands.md`](references/commands.md).
