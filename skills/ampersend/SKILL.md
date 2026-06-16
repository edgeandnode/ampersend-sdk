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

This is the agent-facing manual for ampersend — how and when to drive the `ampersend` CLI on the user's behalf.
ampersend gives an agent a way to pay for things online: the user creates an ampersend agent account once, sets spending
limits in the [ampersend dashboard](https://app.ampersend.ai/), and the agent can then pay within those limits without
prompting per request.

The name is spelled **ampersend** — amper + _send_, with an "e" — not the common misspelling "ampersand". Every command
below uses the "e" spelling.

**Who does what.** To the user this is all just "ampersend," but four roles sit behind it — keep them straight:

- **The user** owns the account and the money, and is the only one who sets spending limits, funds the account, and
  approves setup. All of that happens in the [ampersend dashboard](https://app.ampersend.ai/), in their own browser.
- **You, the agent,** decide when a payment is worth making and relay what happened to the user. You spend within the
  limits the user already set; you never set limits or move money yourself.
- **The `ampersend` CLI** is the local binary you run to do all of the above. HTTP-only: it makes paid requests
  (`ampersend fetch`), reads the agent's own state (`ampersend agent`), prints a dashboard funding link
  (`ampersend fund` — a link only; it moves no money), and stores local config. It can read spending limits but not
  change them.
- **The ampersend service** holds one of the two keys and co-signs a payment only if it satisfies the user's policy
  (limits, auto-topup, alerts).

The user's funds stay in an account they own. Every payment needs both the CLI's key and the service's co-signature, so
neither you nor ampersend can spend alone.

Reference material for every flag and option is in [`references/commands.md`](references/commands.md). Some commands —
`fund`, `card`, `marketplace`, the alternate setup modes — are documented there but not in the workflows below, on
purpose: this file stays focused on the common paths. So before telling the user that ampersend can't do something, or
that a command doesn't exist, check first: run `ampersend <command> --help` (or bare `ampersend --help`), or skim
`references/commands.md`. Don't assert a capability is missing from memory of this file alone.

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
  then use for online purchases, via `ampersend card issue` / `card details`). The agent gets back the artifact, not a
  service response — flag this to the user before suggesting.

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

Anything that touches the dashboard — funding, changing limits, approving setup — the user does **in their own
browser**. That's the intended path, not a fallback: signed in at app.ampersend.ai they have full access to their
account, which is exactly why it must be their session and not one the agent can see. So when a command hands back a
dashboard URL (e.g. `ampersend fund`, `setup start`), give the user the link and let them open it themselves. **NEVER**
sign in to the dashboard from a browser the agent controls, and **never** ask the user to sign in through a browser you
can see.

This boundary is about the dashboard _session_, not about links. Generating a dashboard URL is fine and expected —
`ampersend fund` just prints one (it moves no money and is scoped to the agent's own account); don't treat printing or
sharing a link as if it crossed the line.

The `setup start` flow returns a `verificationCode`. Always show that code to the user alongside the `user_approve_url`
— the user must confirm the code shown in the dashboard matches before approving. This protects against MITM key
substitution.

## Onboarding tour

`ampersend tour` is how you find out where the user is in getting ampersend working and what to help with next. Run it
whenever the user needs a sense of what to do next — they ask "where am I / what's next", you've just finished a setup
or payment step and want the next one, or a fresh conversation starts and you're not sure how far along they are.

The command does the thinking. It returns two tracks — `sandbox` and `production` — and each carries a `hint`: a plain
sentence describing what to do next (or that the track is done). **Read the `hint` and relay it in your own words**,
matching how you'd explain anything else to this user. The hint will name a command or workflow when there's an action
to take — fulfill it through the matching section of this skill ([Setup workflow](#setup-workflow),
[Payment workflow](#payment-workflow), or `ampersend fund`). If `next.contextIsActive` is `false`, the hint says to
switch context first; do that with `config use <name>` before the step. You act on the hint; the command tracks the
steps and their order.

Etiquette the product team asks for:

- With no agent set up at all, ask the user which to start with: play money first (the sandbox — most people start
  there), or straight to real money.
- At most one proactive tour suggestion per conversation. If the user lets the same suggestion pass twice, offer
  `ampersend tour skip` — it persists, so future sessions stay quiet too.
- Treat `mode: "skipped"` as a standing request not to bring the tour up unprompted — `ampersend tour resume` undoes it,
  and helping with errors is always fine. A `complete` track is the same: don't nudge it further (the hint won't ask you
  to), though the user may still want to explore the other track.
- A track marked `degraded: true` just means the server couldn't be reached to check its progress — relay its hint as-is
  (the agent is set up; what's left is unknown until the connection is back) and let the user retry; don't treat it as a
  setup failure. The other track is unaffected.

Full output shape and mechanics: [`references/commands.md`](references/commands.md).

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

`ampersend fetch` never pays unless `--pay` is passed. A bare `fetch` against a paid endpoint returns
`{ ok: false, error: { code: "PAYMENT_REQUIRED", requirements } }` so the agent can see the price before deciding to
spend. Pass `--pay` to authorize spending for that request.

1. Inspect the cost first when the price is unknown:
   ```bash
   ampersend fetch --inspect <url>
   ```
   Returns `{ ok: true, data: { paymentRequired, requirements } }` without fetching the resource. Use this when the
   agent wants to know the price without making a real request (e.g. price-checking a marketplace entry).
2. Make the paid request with `--pay`:
   ```bash
   ampersend fetch --pay <url>
   # POST with body and headers:
   ampersend fetch --pay -X POST -H "Content-Type: application/json" -d '{"key":"value"}' <url>
   ```
   Spending limits set during setup or in the dashboard are enforced by the ampersend service when it co-signs the
   payment, and on-chain by the agent's `CoSignerValidator` module. A payment that would exceed a limit fails with a
   co-sign rejection — the agent and the CLI cannot bypass this.
3. On success, the result includes `data.status`, `data.body`, and `data.payment` (when a payment was made). Report what
   was actually spent from `data.payment`.

## Reading agent state

Run when the user asks how their agent is doing, what its limits are, what it has spent, or who owns it — i.e. anything
the dashboard would show, without needing the dashboard. Every endpoint is server-authoritative and scoped to the
configured agent; sibling agents are unreachable from the CLI.

```bash
ampersend agent                       # Full snapshot: agent record + live USDC balance
ampersend agent spend-config          # Per-tx, daily, monthly limits + auto-topup
ampersend agent payments --preset 1d  # Outgoing payments today (or 30d, all)
ampersend agent activity --limit 20   # Unified spend + earn history, paginated
ampersend agent owner                 # Owner: { user_id, wallet_address }
```

Other subcommands: `auto-collect-config`, `authorized-sellers`. Full flag reference in
[`references/commands.md`](references/commands.md).

These are **reads only**. To change a limit or seller allowlist, the user goes to the dashboard. Useful checks before
acting:

- Before a paid request whose cost matters: `ampersend agent spend-config` to confirm there is daily room.
- After a payment to confirm it landed: `ampersend agent payments --preset 1d`.
- For an audit answer ("what did the agent spend on?"): `ampersend agent activity`.

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

The API URL decides which side of ampersend your agent talks to: the real one with real money, or the sandbox with play
money for trying things out. Each side is its own agent — they don't carry across — but you no longer have to choose:
set each up as its own named **context** (`setup start --api-url https://api.sandbox.ampersend.ai`) and flip between
them with `config use <name>`, no re-setup required. A context's API URL is fixed when it's created — to point somewhere
else, create another context, or set `AMPERSEND_API_URL` to override the URL for a single process. Most people start
with the sandbox, then add a production context when they are ready to spend.

The sandbox covers the payment flow end-to-end, but only a subset of services and capabilities are wired up there —
feature absence in the sandbox doesn't mean feature absence in production. When the user wants to validate a real
service, point them at the production API.

Full flag and option reference: [`references/commands.md`](references/commands.md).
