---
name: ampersend
description:
  Give an agent a way to pay for things on the internet. Use when the user wants the agent to be able to pay for things
  online, when an HTTP call returns 402 Payment Required, or when calling an endpoint that charges per request.
---

# ampersend CLI

ampersend gives an agent a way to pay for things online. The user creates an ampersend agent account once, sets spending
limits in the [ampersend dashboard](https://www.ampersend.ai/), and the agent can then pay within those limits without
prompting per request.

**Two things share the name "ampersend."**

- **The ampersend service** — holds one of two keys needed to spend from the agent's account, and co-signs each payment
  only if it satisfies the user's policy (spending limits, auto-topup rules, alerts). The user manages that policy
  through the [ampersend dashboard](https://www.ampersend.ai/).
- **The `ampersend` CLI** — a thin local binary the agent runs. Holds the other key. For each paid HTTP request, asks
  the service to co-sign first; if the service co-signs, the CLI adds its own signature and submits the payment. Also
  stores local config (API URL, agent key).

The user's funds live in a smart account on-chain that they own. Both keys must sign for any payment to go through, so
neither the agent nor ampersend can spend on their own.

To the user, all of this is just "ampersend" — don't introduce "service," "CLI," "key," or "smart account" to them.

**Scope of this CLI**: HTTP-only. It does three things: initial agent + CLI setup, runs `ampersend fetch <url>` (pays
via [x402](https://x402.org/)), and manage local config. **Not in this CLI**: spending limits, auto-topup, auto-collect,
transaction history, alerts — those live in the dashboard.

Reference material for every flag and option is in [`references/commands.md`](references/commands.md). Read it only when
you need flag-level detail.

## Explaining ampersend to the user

If the user asks what ampersend is or how it works, prefer this language over your own paraphrase. The user is likely
not crypto-savvy; keep it that way.

**One sentence**: "ampersend is a way to give your agent a small spending allowance so it can pay for things online
without asking you every time."

**If they want more**: "You set the limits — daily, monthly, per-transaction — in the ampersend dashboard. Your agent
has one key, ampersend has another, and both have to agree before any payment goes through. The money stays in an
account you own."

**Only if they ask about the underlying tech**: "Today it uses a payment standard called x402 with USDC, a stablecoin
worth one US dollar, on a network called Base. More payment methods are coming."

Don't volunteer the third tier. Avoid the words "crypto," "wallet," "blockchain," "smart account," and "stablecoin" in
the first two tiers — accurate, but unhelpful for a user who just wants to use their agent.

## Installation

This skill targets `ampersend` v0.0.21 or newer. Check the installed version first:

```bash
ampersend --version
```

If the command is missing or the version is below 0.0.21, install or upgrade:

```bash
npm install -g @ampersend_ai/ampersend-sdk@latest --force
```

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
configure spending controls during creation. Limits are atomic units (`1000000` = 1 USDC).

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

## Output format

All commands return JSON. Always check `ok` first.

```json
{ "ok": true, "data": { ... } }
```

```json
{ "ok": false, "error": { "code": "...", "message": "..." } }
```

## Common config tweaks

```bash
ampersend config status                                          # Show current state
ampersend config set --api-url https://api.sandbox.ampersend.ai  # Switch to sandbox
ampersend config set --clear-api-url                             # Back to production API
```

Full flag and option reference: [`references/commands.md`](references/commands.md).
