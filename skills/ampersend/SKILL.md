---
name: ampersend
description: Ampersend CLI for agent payments
metadata: { "openclaw": { "requires": { "bins": ["ampersend"] } } }
---

# Ampersend CLI

Ampersend enables autonomous agent payments. Agents can make payments within user-defined spending limits without
requiring human approval for each transaction. Payments use stablecoins via the x402 protocol.

An agent account is a smart wallet that holds funds the agent can use to pay for services. The user controls the wallet
through the Ampersend dashboard at ampersend.ai, which provides guardrails such as daily and monthly spending limits,
per-transaction caps, and seller allowlists that define what the agent is allowed to do with the wallet.

This skill requires `ampersend` v0.0.16. Run `ampersend --version` to check your installed version.

## Installation

Install the CLI globally via npm:

```bash
npm install -g @ampersend_ai/ampersend-sdk@0.0.16
```

To update from a previously installed version:

```bash
npm install -g @ampersend_ai/ampersend-sdk@0.0.16 --force
```

## Security

**IMPORTANT**: NEVER ask the user to sign in to the Ampersend dashboard in a browser to which you have access. If
configuration changes are needed in Ampersend, ask your user to make them directly.

## Setup

If not configured, commands return setup instructions. Two paths:

### Automated (recommended)

Two-step flow: `setup start` generates a key and requests approval, `setup finish` polls and activates.

There are two modes depending on whether the user needs a new agent account or already has one:

**Create a new agent account (default):**

This is the usual flow for users who are new to Ampersend. It creates a new agent account (smart wallet) and connects
this agent to it. The user approves the creation and configures spending limits in the Ampersend dashboard.

```bash
# Step 1: Request agent creation -- returns immediately with approval URL
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

**Connect to an existing agent account:**

Only use this when the user explicitly asks to connect to an agent account they already created in the Ampersend
dashboard. This adds a key to the existing account without creating a new one.

An agent account can have multiple keys. This is useful for key rotation, or for connecting multiple agent instances to
the same account (in which case they share the same funds and spending limits). Keys have names so the user can identify
them in the dashboard.

```bash
# Step 1: Request key connection -- returns immediately with approval URL
ampersend setup start --agent 0xAgentAddress --key-name "my-key"
# {"ok": true, "data": {"token": "...", "user_approve_url": "https://...", "agentKeyAddress": "0x..."}}

# Show the user_approve_url to the user so they can approve in their browser.

# Step 2: Poll for approval and activate config (same as above)
ampersend setup finish
# {"ok": true, "data": {"agentKeyAddress": "0x...", "agentAccount": "0x...", "status": "ready"}}
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

Step 1: Generate a key and request approval (create new agent or connect to existing).

```bash
# Create a new agent account:
ampersend setup start --name "my-agent" [--force] [--daily-limit <amount>] [--monthly-limit <amount>] [--per-transaction-limit <amount>] [--auto-topup]

# Connect key to an existing agent account:
ampersend setup start --agent <address> [--key-name <name>] [--force]
```

**Options for creating a new agent account:**

| Option                          | Description                                                                   |
| ------------------------------- | ----------------------------------------------------------------------------- |
| `--name <name>`                 | Name for the agent account                                                    |
| `--key-name <name>`             | Name for the key (defaults to "&lt;agent name&gt; Key 1" if omitted)          |
| `--daily-limit <amount>`        | Daily spending limit in atomic units (1000000 = 1 USDC)                       |
| `--monthly-limit <amount>`      | Monthly spending limit in atomic units                                        |
| `--per-transaction-limit <amt>` | Per-transaction spending limit in atomic units                                |
| `--auto-topup`                  | Allow automatic balance top-up from main account                              |

**Options for connecting to an existing agent account:**

| Option               | Description                                                                   |
| -------------------- | ----------------------------------------------------------------------------- |
| `--agent <address>`  | Address of existing agent account to connect key to                           |
| `--key-name <name>`  | Name for the key (defaults to "&lt;agent name&gt; Key &lt;N&gt;" if omitted)  |

**Common options:**

| Option    | Description                            |
| --------- | -------------------------------------- |
| `--force` | Overwrite an existing pending approval |

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
