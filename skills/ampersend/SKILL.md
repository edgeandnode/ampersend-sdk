---
name: ampersend
description: Ampersend CLI for agent payments
metadata: { "openclaw": { "requires": { "bins": ["ampersend"] } } }
---

# Ampersend CLI

Ampersend enables autonomous agent payments. Agents can make payments within user-defined spending limits without
requiring human approval for each transaction. Payments use stablecoins via the x402 protocol.

This skill requires `ampersend` v0.0.14. Run `ampersend --version` to check your installed version.

## Installation

Install the CLI globally via npm:

```bash
npm install -g @ampersend_ai/ampersend-sdk@0.0.14
```

To update from a previously installed version:

```bash
npm install -g @ampersend_ai/ampersend-sdk@0.0.14 --force
```

## Security

**IMPORTANT**: NEVER ask the user to sign in to the Ampersend dashboard in a browser to which you have access. If
configuration changes are needed in Ampersend, ask your user to make them directly.

## Setup

If not configured, commands return setup instructions. Two paths:

### Automated (recommended)

Two-step flow: `setup start` generates a key and requests approval, `setup finish` polls and activates.

```bash
# Step 1: Request agent creation — returns immediately with approval URL
ampersend setup start --name "my-agent"
# {"ok": true, "data": {"token": "...", "user_approve_url": "https://...", "agentKeyAddress": "0x..."}}

# Show the user_approve_url to the user so they can approve in their browser.

# Step 2: Poll for approval and activate config
ampersend setup finish
# {"ok": true, "data": {"agentKeyAddress": "0x...", "agentAccount": "0x...", "status": "ready"}}
```

Optional spending limits can be set during setup:

```bash
ampersend setup start --name "my-agent" --daily-limit "1000000" --auto-topup
```

### Manual

If you already have an agent key and account address:

```bash
ampersend config set "0xagentKey:::0xagentAccount"
# {"ok": true, "data": {"agentKeyAddress": "0x...", "agentAccount": "0x...", "status": "ready"}}
```

## Commands

### setup

Set up an agent account via the approval flow.

#### setup start

Step 1: Generate a key and request agent creation approval.

```bash
ampersend setup start --name "my-agent" [--force] [--daily-limit <amount>] [--monthly-limit <amount>] [--per-transaction-limit <amount>] [--auto-topup]
```

| Option                          | Description                                             |
| ------------------------------- | ------------------------------------------------------- |
| `--name <name>`                 | Name for the agent                                      |
| `--force`                       | Overwrite an existing pending approval                  |
| `--daily-limit <amount>`        | Daily spending limit in atomic units (1000000 = 1 USDC) |
| `--monthly-limit <amount>`      | Monthly spending limit in atomic units                  |
| `--per-transaction-limit <amt>` | Per-transaction spending limit in atomic units          |
| `--auto-topup`                  | Allow automatic balance top-up from main account        |

Returns `token`, `user_approve_url`, and `agentKeyAddress`. Show the `user_approve_url` to the user.

#### setup finish

Step 2: Poll for approval and activate the agent config.

```bash
ampersend setup finish [--force] [--poll-interval <seconds>] [--timeout <seconds>]
```

| Option                      | Description                               |
| --------------------------- | ----------------------------------------- |
| `--force`                   | Overwrite existing active config          |
| `--poll-interval <seconds>` | Seconds between status checks (default 5) |
| `--timeout <seconds>`       | Maximum seconds to wait (default 600)     |

### fetch

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

Use `--inspect` to verify payment requirements and costs before making a payment:

```bash
ampersend fetch --inspect https://api.example.com/paid-endpoint
# Returns payment requirements including amount, without executing payment
```

### config

Manage local configuration.

```bash
ampersend config set <key:::account>                             # Set active config manually
ampersend config set --api-url https://api.staging.ampersend.ai  # Set staging API URL
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

For `fetch`, success includes `data.status`, `data.body`, and `data.payment` (when payment made).
