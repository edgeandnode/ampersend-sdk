# Ampersend CLI command reference

Full flag and option reference for every `ampersend` command. Read this when the workflows in `SKILL.md` aren't enough —
for example, when the user wants connect-mode setup, manual config, sandbox switching, or non-default fetch behavior.

## Contents

- [setup start](#setup-start)
- [setup finish](#setup-finish)
- [Setup mode: connect to an existing agent](#setup-mode-connect-to-an-existing-agent)
- [Setup mode: manual key + account](#setup-mode-manual-key--account)
- [fetch](#fetch)
- [agent](#agent)
- [config](#config)

## setup start

Step 1 of the approval flow: generate a key and request agent creation.

```bash
ampersend setup start [--mode <create|connect>] [--name <name>] [--agent <address>] [--key-name <name>] [--force] [--daily-limit <amount>] [--monthly-limit <amount>] [--per-transaction-limit <amount>] [--auto-topup]
```

| Option                          | Description                                                                         |
| ------------------------------- | ----------------------------------------------------------------------------------- |
| `--mode <mode>`                 | `create` (new agent, default) or `connect` (key to existing agent)                  |
| `--name <name>`                 | Name for the agent (create mode only)                                               |
| `--agent <address>`             | Address of existing agent to connect to (connect mode; omit to choose in dashboard) |
| `--key-name <name>`             | Name for the agent key                                                              |
| `--force`                       | Overwrite an existing pending approval                                              |
| `--daily-limit <amount>`        | Daily spending limit in atomic units, 1000000 = 1 USDC (create mode only)           |
| `--monthly-limit <amount>`      | Monthly spending limit in atomic units (create mode only)                           |
| `--per-transaction-limit <amt>` | Per-transaction spending limit in atomic units (create mode only)                   |
| `--auto-topup`                  | Allow automatic balance top-up from main account (create mode only)                 |

Returns `token`, `user_approve_url`, `agentKeyAddress`, and `verificationCode`. The verification code must be shown to
the user alongside the approval URL.

## setup finish

Step 2 of the approval flow: poll for approval and activate the agent config.

```bash
ampersend setup finish [--force] [--poll-interval <seconds>] [--timeout <seconds>]
```

| Option                      | Description                               |
| --------------------------- | ----------------------------------------- |
| `--force`                   | Overwrite existing active config          |
| `--poll-interval <seconds>` | Seconds between status checks (default 5) |
| `--timeout <seconds>`       | Maximum seconds to wait (default 600)     |

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
# {"ok": true, "data": {"agentKeyAddress": "0x...", "agentAccount": "0x...", "status": "ready"}}
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

Manage local configuration.

```bash
ampersend config set <key:::account>                             # Set active config manually
ampersend config set --api-url https://api.sandbox.ampersend.ai  # Set sandbox API URL
ampersend config set --clear-api-url                             # Revert to production API
ampersend config set <key:::account> --api-url <url>             # Set both at once
ampersend config status                                          # Show current status
```
