---
name: ampersend
description:
  Give an agent a way to pay for things on the internet. Use when the user wants the agent to be able to pay for things
  online, when an HTTP call returns 402 Payment Required, or when calling an endpoint that charges per request.
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

**Scope of this CLI**: HTTP-only. It does three things: initial agent + CLI setup, runs `ampersend fetch <url>` (pays
via [x402](https://x402.org/)), and manage local config. **Not in this CLI**: spending limits, auto-topup, auto-collect,
transaction history, alerts — those live in the dashboard.

Reference material for every flag and option is in [`references/commands.md`](references/commands.md). Read it only when
you need flag-level detail.

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


## Agent hosted endpoints

Manage hosted endpoints for the authenticated agent. Hosted endpoints let your agent sell access to an upstream API
through Ampersend's x402 proxy: Ampersend collects payment, forwards the request, and returns the upstream response.

All `endpoint` commands require an active config (run `ampersend setup` first). Commands return `JsonOk` / `JsonErr`
envelopes like the rest of the CLI.

Every endpoint DTO includes an `access_url` field: the fully-qualified public x402 gateway URL buyers hit to invoke the
endpoint. Use that exact string when quoting the URL to users or passing it to `ampersend fetch <url>` — do not
hand-assemble the URL from pieces. `access_url` is `null` only when the owner's namespace or agent slug has not been
claimed yet (run `ampersend setup finish` to claim).

#### endpoint list

List all hosted endpoints owned by the agent.

```bash
ampersend endpoint list
```

#### endpoint get

Fetch a single hosted endpoint by ID.

```bash
ampersend endpoint get <id>
```

#### endpoint create

Create a new hosted endpoint.

```bash
ampersend endpoint create --name <name> --price-usd <usd> --proxy-url <url> [options]
```

| Option                             | Description                                                                      |
| ---------------------------------- | -------------------------------------------------------------------------------- |
| `--name <name>`                    | Display name (required)                                                          |
| `--price-usd <usd>`                | Per-call price in USD (required, positive number)                                |
| `--proxy-url <url>`                | Upstream URL Ampersend proxies to (required, http/https)                         |
| `--description <text>`             | Optional description                                                             |
| `--methods <csv>`                  | Allowed HTTP methods, comma-separated (default: `GET`)                           |
| `--rate-limit <n>`                 | Global rate limit per minute                                                     |
| `--timeout <ms>`                   | Proxy timeout in milliseconds (5000–60000, default 30000)                        |
| `--proxy-header "<name>: <value>"` | Header Ampersend forwards to the upstream. Repeat for multiple.                  |
| `--required-header <name>`         | Header name the buyer must include on the incoming request. Repeat for multiple. |

To create an endpoint in the disabled state, create it and then call `ampersend endpoint disable <id>`.

#### endpoint update

Update an existing hosted endpoint. Only pass the fields you want to change.

```bash
ampersend endpoint update <id> [--name <name>] [--price-usd <usd>] [--proxy-url <url>] [--description <text>] [--methods <csv>] [--rate-limit <n>] [--timeout <ms>] [--enabled <bool>]
```

`--enabled true` / `--enabled false` toggles activation; `enable` / `disable` are shorthand for the same operation.

#### endpoint delete

Delete a hosted endpoint.

```bash
ampersend endpoint delete <id>
```

#### endpoint enable / endpoint disable

Toggle endpoint activation without deleting.

```bash
ampersend endpoint enable <id>
ampersend endpoint disable <id>
```

#### endpoint test

Send a synthetic request through the proxy to verify the upstream is reachable and returns the expected shape.

```bash
ampersend endpoint test <id>
```

#### endpoint headers

Manage headers attached to proxied requests.

```bash
ampersend endpoint headers add-proxy <id> --name <header> --value <value>     # Header Ampersend adds to upstream request
ampersend endpoint headers remove-proxy <id> <name>
ampersend endpoint headers add-required <id> --name <header>                  # Header the buyer must include
ampersend endpoint headers remove-required <id> <name>
```

`remove-proxy` and `remove-required` take the header name as a positional argument. `add-proxy` and `add-required` use
named flags.

#### endpoint rotate-secret

Rotate the per-endpoint shared secret Ampersend uses to sign upstream requests. Previous secret is immediately
invalidated.

```bash
ampersend endpoint rotate-secret <id>
```

#### endpoint import

Bulk-create endpoints from an OpenAPI 3.0 / 3.1 JSON spec. One endpoint is created per path+method pair. YAML is not
parsed — convert to JSON first.

```bash
ampersend endpoint import <spec.json> [--default-price <usd>] [--base-url <url>] [--timeout <ms>] [--dry-run]
```

| Option                  | Description                                                                                                                                       |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `<spec.json>`           | Path to an OpenAPI 3.0 / 3.1 JSON spec file                                                                                                       |
| `--default-price <usd>` | Fallback per-call price when the operation has no `x-ampersend-price`. Defaults to `0.01` — always pass an explicit value for production imports. |
| `--base-url <url>`      | Override the base URL from the spec (wins over `servers[0].url`)                                                                                  |
| `--timeout <ms>`        | Proxy timeout applied to every imported endpoint                                                                                                  |
| `--dry-run`             | Parse and validate the spec without creating endpoints                                                                                            |

Recognised per-operation vendor extensions:

| Extension                 | Type    | Effect                         |
| ------------------------- | ------- | ------------------------------ |
| `x-ampersend-price`       | number  | Per-call price in USD          |
| `x-ampersend-name`        | string  | Endpoint display name override |
| `x-ampersend-description` | string  | Description override           |
| `x-ampersend-rate-limit`  | integer | Rate limit per minute          |

### config

Manage local configuration.

```bash
ampersend config set <key:::account>                             # Set active config manually
ampersend config set --api-url https://api.sandbox.ampersend.ai  # Set sandbox API URL
ampersend config set --clear-api-url                             # Revert to production API
ampersend config set --network base-sepolia                      # Set network (base, base-sepolia)
ampersend config set --clear-network                             # Revert to default network (base)
ampersend config set <key:::account> --api-url <url>             # Set both at once
ampersend config status                                          # Show current status
```

## Output

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
ampersend config set --api-url https://api.sandbox.ampersend.ai  # Switch to sandbox
ampersend config set --clear-api-url                             # Back to production API
```

Full flag and option reference: [`references/commands.md`](references/commands.md).
