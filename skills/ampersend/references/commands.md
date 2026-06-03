# Ampersend CLI command reference

Full flag and option reference for every `ampersend` command. Read this when the workflows in `SKILL.md` aren't enough —
for example, when the user wants connect-mode setup, manual config, sandbox switching, or non-default fetch behavior.

## Contents

- [Selecting a context](#selecting-a-context)
- [setup start](#setup-start)
- [setup finish](#setup-finish)
- [Setup mode: connect to an existing agent](#setup-mode-connect-to-an-existing-agent)
- [Setup mode: manual key + account](#setup-mode-manual-key--account)
- [fetch](#fetch)
- [card](#card)
- [agent](#agent)
- [config](#config)

## Selecting a context

Config holds multiple named **contexts** (identity + API URL); one is active at a time. Every command that talks to the
API (`fetch`, `agent …`, `card …`, `marketplace …`, `setup finish`) accepts a uniform `--context <name>` flag to run
against a non-active context for that one invocation, without switching the active one. Resolution precedence:

1. `--context <name>` flag (per command)
2. `AMPERSEND_CONTEXT` env var (selects the active context for the process)
3. the persisted active context (set by `config use` / `setup`)

Two env vars sit above context selection entirely: `AMPERSEND_AGENT_SECRET` (or `AMPERSEND_AGENT_KEY` +
`AMPERSEND_AGENT_ACCOUNT`) supplies a complete identity with no config file — the CI/deploy path — and
`AMPERSEND_API_URL` is a hard override of the API URL that always wins when set.

## setup start

Step 1 of the approval flow: generate a key and request agent creation.

```bash
ampersend setup start [--context <name>] [--api-url <url>] [--detach] [--mode <create|connect>] [--name <name>] [--agent <address>] [--key-name <name>] [--force] [--daily-limit <amount>] [--monthly-limit <amount>] [--per-transaction-limit <amount>] [--auto-topup]
```

| Option                          | Description                                                                           |
| ------------------------------- | ------------------------------------------------------------------------------------- |
| `--context <name>`              | Name for the context. Omit to auto-name one (`ctx-<key>`, host-prefixed for non-prod) |
| `--api-url <url>`               | API URL this context targets (for non-production environments)                        |
| `--detach`                      | Create the context without making it the active one                                   |
| `--mode <mode>`                 | `create` (new agent, default) or `connect` (key to existing agent)                    |
| `--name <name>`                 | Name for the agent (create mode only)                                                 |
| `--agent <address>`             | Address of existing agent to connect to (connect mode; omit to choose in dashboard)   |
| `--key-name <name>`             | Name for the agent key                                                                |
| `--force`                       | Overwrite an existing context (ready or live pending) with the same name              |
| `--daily-limit <amount>`        | Daily spending limit in atomic units, 1000000 = 1 USDC (create mode only)             |
| `--monthly-limit <amount>`      | Monthly spending limit in atomic units (create mode only)                             |
| `--per-transaction-limit <amt>` | Per-transaction spending limit in atomic units (create mode only)                     |
| `--auto-topup`                  | Allow automatic balance top-up from main account (create mode only)                   |

Each `setup start` creates a new **context** (a named identity: agent key + account + its own API URL) and, unless
`--detach` is passed, makes it active. Returns `token`, `user_approve_url`, `agentKeyAddress`, `verificationCode`, and
the `context` name. The verification code must be shown to the user alongside the approval URL.

## setup finish

Step 2 of the approval flow: poll for approval and promote a pending context to `ready`. With no flags it finishes the
**active** context; `--context <name>` finishes (and activates) a specific pending context instead — useful after a
`--detach`'d `setup start`.

```bash
ampersend setup finish [--context <name>] [--poll-interval <seconds>] [--timeout <seconds>]
```

| Option                      | Description                                              |
| --------------------------- | -------------------------------------------------------- |
| `--context <name>`          | Finish and activate a specific context (default: active) |
| `--poll-interval <seconds>` | Seconds between status checks (default 5)                |
| `--timeout <seconds>`       | Maximum seconds to wait (default 600)                    |

## Setup mode: connect to an existing agent

Use when the user already has an agent account and wants a new key on this machine.

User picks the agent in the dashboard:

```bash
ampersend setup start --mode connect --key-name "my-key"
```

Or target a specific agent by address:

```bash
ampersend setup start --mode connect --agent 0x1234...abcd --key-name "my-key"
```

Then run `ampersend setup finish` as in the standard flow.

## Setup mode: manual key + account

Use only when the user already has both an agent key and the agent account address (e.g., copied from another machine).
Skips the approval flow entirely.

```bash
ampersend config set "0xagentKey:::0xagentAccount"
# {"ok": true, "data": {"agentKeyAddress": "0x...", "agentAccount": "0x...", "context": "ctx-...", "status": "ready"}}
```

## fetch

Make HTTP requests. By default `fetch` never pays — pass `--pay` to authorize spending when the server returns 402.

```bash
ampersend fetch <url>                                                                 # Probe only; 402 → error envelope
ampersend fetch --pay <url>                                                           # Authorize payment if needed
ampersend fetch --pay -X POST -H "Content-Type: application/json" -d '{"key":"value"}' <url>
```

| Option        | Description                                               |
| ------------- | --------------------------------------------------------- |
| `-X <method>` | HTTP method (default: GET)                                |
| `-H <header>` | Header as "Key: Value" (repeat for multiple)              |
| `-d <data>`   | Request body                                              |
| `--pay`       | Authorize payment if the server returns 402               |
| `--inspect`   | Report payment requirements without fetching the resource |
| `--raw`       | Output the raw response body instead of the JSON envelope |
| `--headers`   | Include response headers in the JSON envelope             |

`--pay` and `--inspect` are mutually exclusive.

### Three modes

- **`fetch <url>`** — probe. On 200, returns `{ ok: true, data: { status, body } }`. On 402, returns
  `{ ok: false, error: { code: "PAYMENT_REQUIRED", message, requirements } }` and does not spend.
- **`fetch --pay <url>`** — fetch the resource, pay if the server returns 402. On success, returns
  `{ ok: true, data: { status, body, payment } }` where `data.payment` is
  `{ amount, asset, network, payTo, scheme, txHash, payer? }`. Use this when the agent has already decided it wants to
  pay.
- **`fetch --inspect <url>`** — report the price without fetching the resource. Returns
  `{ ok: true, data: { url, paymentRequired, requirements } }`. Use this when the agent wants to know the price without
  making a real request.

### Reading the receipt

When `--pay` succeeds and the server returned a payment receipt, `data.payment` is populated. `data.payment.amount` is
the atomic-unit amount the client signed for and the server settled — these are necessarily equal, because the server
can only settle the value that was signed. `data.payment.asset` is the token contract address; combine with `network` to
identify the token. `data.payment.txHash` is the on-chain settlement transaction.

### Exit codes

In JSON mode (default), `fetch` exits 0 when the CLI itself ran successfully — read the envelope's `ok` field to see
whether the operation succeeded. A 402 without `--pay`, an unparseable response, or a network failure are all
`ok: false` envelopes with exit 0. Exit 1 is reserved for caller errors: bad arguments (e.g. `--pay` and `--inspect`
together), invalid headers, or a missing config when `--pay` is set. In `--raw` mode, exit 1 is also used for runtime
failures (parse errors, network errors) so shell pipelines can branch on `$?`.

## card

Issue and read prepaid Visa cards. Three subcommands:

```bash
ampersend card issue --amount <usd>            # order a card (the spend)
ampersend card details <id> [--pay] [--reveal] # status + data once ready
ampersend card list [--pay]                    # all issued cards (masked)
```

`card issue`:

| Option           | Description                                 |
| ---------------- | ------------------------------------------- |
| `--amount <usd>` | Card value in USD ($5–$1000). Required.     |
| `--raw`          | Print only the inner data, no JSON envelope |

`card details <id>` / `card list`:

| Option     | Description                                                   |
| ---------- | ------------------------------------------------------------- |
| `--pay`    | Authorize minting a read token (~$0.001) when none is cached  |
| `--reveal` | `details` only — show the full PAN and CVV instead of masking |
| `--raw`    | Print only the inner data, no JSON envelope                   |

### Spending model

`issue` is the only stated-amount spend, so it has **no `--pay` flag** — the amount is in the command. It returns a
`card_id` with `status: "pending"` and a `payment` receipt. It does not poll; poll `card details <id>` yourself until
`status: "ready"`.

Reads (`details`/`list`) need an access token minted by a tiny (~$0.001) paid call. That token is cached, so:

- **After `issue`** — a token is cached as a side effect of ordering, so the first `details`/`list` poll is free, no
  `--pay` needed.
- **Warm cache** — reads are free; no `--pay` needed.
- **Cold cache, no `--pay`** — returns `ok: false` with code `TOKEN_REQUIRED`. Pass `--pay` to authorize the mint.
- **Cold cache, `--pay`** — mints the token, caches it, and includes a `payment` receipt for that spend.

The cache is dropped automatically whenever the active agent identity or API URL changes.

### Card data fields

`details` and `list` return these fields per card (in addition to `card_id`):

| Field          | Where          | Meaning                                                                    |
| -------------- | -------------- | -------------------------------------------------------------------------- |
| `status`       | both           | Lifecycle state — see the enum below                                       |
| `amount`       | both           | Original load in USD                                                       |
| `balance`      | both (ready)   | Spendable USD remaining now                                                |
| `card_type`    | both           | e.g. `Non-Reloadable U.S.`                                                 |
| `ordered_at`   | both           | When the card was ordered (ISO 8601)                                       |
| `pan`          | both (ready)   | Card number — masked to last 4 unless `--reveal`                           |
| `cvv`          | both (ready)   | Security code — `•••` unless `--reveal`                                    |
| `expiry`       | both (ready)   | `MM/YY`, shown in clear (not a secret on its own)                          |
| `transactions` | `details` only | History: `{ amount, date, description, is_credit }` — the load is a credit |

**Has a card been used?** Compare `amount` (the load) with `balance` (what's left): unused when `balance == amount`,
spent so far = `amount - balance`. `transactions` gives the itemized history (`is_credit: true` = the load or a refund;
`false` = a spend).

`balance`, `pan`/`cvv`/`expiry`, and `transactions` appear only once a card is ready.

### Status values

`status` is passed through from Laso verbatim: `pending` (provisioning), `ready` (US card usable), `refund-requested`,
`refunded`, `archived`. (International cards, a fast-follow, add `queued` and `complete`.) Poll on `status` reaching
`ready`; don't assume `ready` is the only terminal state.

### Card data and masking

Card secrets are **never written to disk** and are masked unless `--reveal`: PAN shows the last four digits
(`•••• •••• •••• 4242`) and CVV shows `•••`. Expiry is shown in clear. A still-provisioning card returns `ok: true` with
`status: "pending"` and no card data — that's a normal poll state, not an error. Branch on `data.status`, not `ok`.

### Error codes

`CARD_AMOUNT_OUT_OF_RANGE` (amount outside $5–$1000), `CARD_REGION_BLOCKED` (issuance is US-IP only), `TOKEN_REQUIRED`
(cold read cache without `--pay`), `CARD_NOT_FOUND` (no card with that id). All are `ok: false` envelopes with exit 0;
exit 1 is reserved for caller misuse (e.g. bad `--amount`) and missing config.

## agent

Read the calling agent's own state. Every subcommand is authenticated with the local agent key, scoped to that agent
only, and returns the standard JSON envelope.

```bash
ampersend agent                                # Snapshot: agent record + live balance
ampersend agent spend-config                   # Per-tx, daily, monthly limits, auto-topup
ampersend agent auto-collect-config            # Earnings sweep configuration
ampersend agent authorized-sellers             # Seller allowlist
ampersend agent payments [--preset 1d|30d|all] # Outgoing payments (default: 30d)
ampersend agent activity [--limit N] [--page N] [--preset <preset>]
ampersend agent owner                          # Owner: { user_id, wallet_address }
```

| Option        | Description                                                    |
| ------------- | -------------------------------------------------------------- |
| `--preset`    | Timerange: `1d` (today), `30d` (last 30 days), or `all`        |
| `--limit <n>` | `activity` only — items per page                               |
| `--page <n>`  | `activity` only — page number (1-indexed)                      |
| `--raw`       | Print only the inner data, no JSON envelope (useful in shells) |

These are **reads only** — to change limits or sellers, the user goes to the dashboard. The server scopes every response
to the session's own agent, so sibling agents and cross-agent aggregates are unreachable.

## config

Manage local configuration. Config is organised into named **contexts**, each carrying its own agent key, account, and
API URL — so a sandbox identity and a production identity can coexist. One context is "active" at a time; every
authenticated command uses the active context.

```bash
ampersend config set <key:::account>                                       # Create an auto-named context, make it active
ampersend config set <key:::account> --context sandbox --api-url <url>     # Create a named context with its own URL
ampersend config status                                                    # Show all contexts and which is active
ampersend config use <name>                                                # Switch the active context
ampersend config rm <name>                                                 # Delete a context
```

| Subcommand            | Description                                                                          |
| --------------------- | ------------------------------------------------------------------------------------ |
| `set <key:::account>` | Create a context from an identity and make it active (`--context <name>` to name it) |
| `set --api-url <url>` | Only with a secret — the URL a newly-created context targets (non-production)        |
| `status`              | Show every context (oldest first), its status, and which one is active               |
| `use <name>`          | Make `<name>` the active context without re-running setup                            |
| `rm <name>`           | Delete `<name>`; clears the active selection if it was active                        |

A context's API URL is fixed at creation. There is no in-place URL edit: re-run `setup start` / `config set` with a new
`--api-url` to create another context, or set `AMPERSEND_API_URL` to override the URL for a single process. `config set`
with no `--context` always mints a fresh auto-named context (`ctx-<key>`, host-prefixed for non-prod) and never
overwrites an existing one; pass `--context <name>` to write a specific one.
