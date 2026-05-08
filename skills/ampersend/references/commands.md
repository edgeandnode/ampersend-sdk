# Ampersend CLI command reference

Full flag and option reference for every `ampersend` command. Read this when the workflows in `SKILL.md` aren't enough —
for example, when the user wants connect-mode setup, manual config, sandbox switching, or non-default fetch behavior.

## Contents

- [setup start](#setup-start)
- [setup finish](#setup-finish)
- [Setup mode: connect to an existing agent](#setup-mode-connect-to-an-existing-agent)
- [Setup mode: manual key + account](#setup-mode-manual-key--account)
- [fetch](#fetch)
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

Make HTTP requests with automatic x402 payment handling.

```bash
ampersend fetch <url>
ampersend fetch -X POST -H "Content-Type: application/json" -d '{"key":"value"}' <url>
```

| Option        | Description                                  |
| ------------- | -------------------------------------------- |
| `-X <method>` | HTTP method (default: GET)                   |
| `-H <header>` | Header as "Key: Value" (repeat for multiple) |
| `-d <data>`   | Request body                                 |
| `--inspect`   | Check payment requirements without paying    |

Use `--inspect` first whenever the cost is unknown:

```bash
ampersend fetch --inspect https://api.example.com/paid-endpoint
# Returns payment requirements including amount, without executing payment
```

Successful results include `data.status`, `data.body`, and `data.payment` (when a payment was made).

## config

Manage local configuration.

```bash
ampersend config set <key:::account>                             # Set active config manually
ampersend config set --api-url https://api.sandbox.ampersend.ai  # Set sandbox API URL
ampersend config set --clear-api-url                             # Revert to production API
ampersend config set <key:::account> --api-url <url>             # Set both at once
ampersend config status                                          # Show current status
```
