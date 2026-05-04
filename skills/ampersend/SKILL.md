---
name: ampersend
description: Ampersend CLI for agent payments
metadata: { "openclaw": { "requires": { "bins": ["ampersend"] } } }
---

# Ampersend CLI

Ampersend enables autonomous agent payments. Agents can make payments within user-defined spending limits without
requiring human approval for each transaction. Payments use stablecoins via the x402 protocol.

This skill requires `ampersend` v0.0.21. Run `ampersend --version` to check your installed version.

## Installation

Install the CLI globally via npm:

```bash
npm install -g @ampersend_ai/ampersend-sdk@0.0.21
```

To update from a previously installed version:

```bash
npm install -g @ampersend_ai/ampersend-sdk@0.0.21 --force
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

### Connecting to an existing agent account

To connect a new key to an existing agent account (user picks the agent in the dashboard):

```bash
ampersend setup start --mode connect --key-name "my-key"
```

To connect to a specific agent account by address:

```bash
ampersend setup start --mode connect --agent 0x1234...abcd --key-name "my-key"
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

### endpoint

Manage hosted endpoints for the authenticated agent. Hosted endpoints let your agent sell access to an upstream API through Ampersend's x402 proxy: Ampersend collects payment, forwards the request, and returns the upstream response.

All `endpoint` commands require an active config (run `ampersend setup` first). Commands return `JsonOk` / `JsonErr` envelopes like the rest of the CLI.

Every endpoint DTO includes an `access_url` field: the fully-qualified public x402 gateway URL buyers hit to invoke the endpoint. Use that exact string when quoting the URL to users or passing it to `ampersend fetch <url>` — do not hand-assemble the URL from pieces. `access_url` is `null` only when the owner's namespace or agent slug has not been claimed yet (run `ampersend setup finish` to claim).

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

| Option                               | Description                                                                    |
| ------------------------------------ | ------------------------------------------------------------------------------ |
| `--name <name>`                      | Display name (required)                                                        |
| `--price-usd <usd>`                  | Per-call price in USD (required, positive number)                              |
| `--proxy-url <url>`                  | Upstream URL Ampersend proxies to (required, http/https)                       |
| `--description <text>`               | Optional description                                                           |
| `--methods <csv>`                    | Allowed HTTP methods, comma-separated (default: `GET`)                         |
| `--rate-limit <n>`                   | Global rate limit per minute                                                   |
| `--timeout <ms>`                     | Proxy timeout in milliseconds (5000–60000, default 30000)                      |
| `--proxy-header "<name>: <value>"`   | Header Ampersend forwards to the upstream. Repeat for multiple.                |
| `--required-header <name>`           | Header name the buyer must include on the incoming request. Repeat for multiple. |

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

`remove-proxy` and `remove-required` take the header name as a positional argument. `add-proxy` and `add-required` use named flags.

#### endpoint rotate-secret

Rotate the per-endpoint shared secret Ampersend uses to sign upstream requests. Previous secret is immediately invalidated.

```bash
ampersend endpoint rotate-secret <id>
```

#### endpoint import

Bulk-create endpoints from an OpenAPI 3.0 / 3.1 JSON spec. One endpoint is created per path+method pair. YAML is not parsed — convert to JSON first.

```bash
ampersend endpoint import <spec.json> [--default-price <usd>] [--base-url <url>] [--timeout <ms>] [--dry-run]
```

| Option                    | Description                                                                                                                          |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `<spec.json>`             | Path to an OpenAPI 3.0 / 3.1 JSON spec file                                                                                          |
| `--default-price <usd>`   | Fallback per-call price when the operation has no `x-ampersend-price`. Defaults to `0.01` — always pass an explicit value for production imports. |
| `--base-url <url>`        | Override the base URL from the spec (wins over `servers[0].url`)                                                                     |
| `--timeout <ms>`          | Proxy timeout applied to every imported endpoint                                                                                     |
| `--dry-run`               | Parse and validate the spec without creating endpoints                                                                               |

Recognised per-operation vendor extensions:

| Extension                   | Type    | Effect                           |
| --------------------------- | ------- | -------------------------------- |
| `x-ampersend-price`         | number  | Per-call price in USD            |
| `x-ampersend-name`          | string  | Endpoint display name override   |
| `x-ampersend-description`   | string  | Description override             |
| `x-ampersend-rate-limit`    | integer | Rate limit per minute            |

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

For `fetch`, success includes `data.status`, `data.body`, and `data.payment` (when payment made).
