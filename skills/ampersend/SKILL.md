---
name: ampersend
description: CLI tools for x402 payment-enabled applications via Ampersend wallet
metadata:
  {
    "openclaw":
      { "requires": { "bins": ["npx"], "env": ["AMPERSEND_AGENT_KEY"] }, "primaryEnv": "AMPERSEND_AGENT_KEY" },
  }
---

# ampersend CLI

CLI tools for building and interacting with x402 payment-enabled applications using Ampersend smart account wallets.

## Prerequisites

Set wallet credentials using either format:

```bash
# Combined format (recommended)
export AMPERSEND_AGENT_KEY="0xaddress:::0xsession_key"

# Or separate variables
export AMPERSEND_SMART_ACCOUNT_ADDRESS="0x..."
export AMPERSEND_SESSION_KEY="0x..."
```

Optional:

```bash
export AMPERSEND_NETWORK="base"                 # Network (default: base)
export AMPERSEND_API_URL="https://..."          # Custom Ampersend API URL
```

## Supported Networks

- `base` (default)
- `base-sepolia`

---

## fetch

Make HTTP requests to x402 payment-gated APIs. Automatically handles HTTP 402 Payment Required responses by creating and
signing payments using the configured Ampersend smart account wallet.

### When to Use

Use `ampersend fetch` instead of `curl` when:

- The API uses x402 payment protocol
- You see HTTP 402 Payment Required responses
- You need to pay for API access with crypto

### When NOT to Use

- Regular HTTP requests without x402 payments (use `curl` instead)
- APIs using traditional API keys, OAuth, or other auth methods
- Streaming responses (not supported)
- When you need fine-grained control over payment authorization (use the SDK directly)

### Usage

#### Basic GET Request

```bash
npx --yes -p @ampersend_ai/ampersend-sdk@beta ampersend fetch https://api.example.com/paid-endpoint
```

#### POST with JSON Body

```bash
npx --yes -p @ampersend_ai/ampersend-sdk@beta ampersend fetch \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"query": "your data"}' \
  https://api.example.com/paid-endpoint
```

#### Inspect Payment Requirements (Without Paying)

Use `--inspect` to preview what payment is required without executing the payment:

```bash
npx --yes -p @ampersend_ai/ampersend-sdk@beta ampersend fetch --inspect https://api.example.com/paid-endpoint
```

#### Debug Mode

To see detailed JSONL logs of the payment flow (output to stderr):

```bash
npx --yes -p @ampersend_ai/ampersend-sdk@beta ampersend fetch --debug https://api.example.com/paid-endpoint
```

### Options Reference

| Option                  | Description                                         |
| ----------------------- | --------------------------------------------------- |
| `-X, --method <method>` | HTTP method (default: GET)                          |
| `-H, --header <header>` | HTTP header (format: "Key: Value"), can be repeated |
| `-d, --data <data>`     | Request body data                                   |
| `--inspect`             | Preview payment requirements without paying         |
| `--raw`                 | Output raw response body instead of JSON            |
| `--headers`             | Include response headers in JSON output             |
| `--debug`               | Output JSONL logs to stderr for troubleshooting     |

### How It Works

1. Makes HTTP request to the target URL
2. If server responds with HTTP 402 Payment Required:
   - Parses payment requirements from response
   - Creates payment using your smart account
   - Signs payment with session key
   - Retries request with payment header
3. Returns the successful response

### Error Handling

If wallet is not configured, you'll see:

```
Error: Wallet not configured.

Set the following environment variables:
  AMPERSEND_SMART_ACCOUNT_ADDRESS - Your smart account address
  AMPERSEND_SESSION_KEY - Session key private key
```

### Examples

#### Query a Paid AI API

```bash
npx --yes -p @ampersend_ai/ampersend-sdk@beta ampersend fetch \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"prompt": "Hello, world!"}' \
  https://ai-api.example.com/chat
```

#### Fetch Premium Data

```bash
npx --yes -p @ampersend_ai/ampersend-sdk@beta ampersend fetch https://data-api.example.com/premium/market-data
```

#### Check if API Requires Payment

```bash
npx --yes -p @ampersend_ai/ampersend-sdk@beta ampersend fetch --inspect https://api.example.com/endpoint
```

#### Raw Response Body

```bash
npx --yes -p @ampersend_ai/ampersend-sdk@beta ampersend fetch --raw https://api.example.com/paid-endpoint
```

### Output Format

By default, `ampersend fetch` outputs structured JSON with a consistent envelope. Always check `ok` first.

#### Success Response

```json
{
  "ok": true,
  "data": {
    "status": 200,
    "body": "{\"result\": \"data\"}",
    "payment": { ... }
  }
}
```

Use `--headers` to include response headers:

```json
{
  "ok": true,
  "data": {
    "status": 200,
    "headers": { "content-type": "application/json" },
    "body": "..."
  }
}
```

#### Inspect Response

```json
{
  "ok": true,
  "data": {
    "url": "https://api.example.com/endpoint",
    "paymentRequired": true,
    "requirements": {
      "scheme": "exact",
      "network": "base",
      "maxAmountRequired": "1000000",
      "asset": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      "payTo": "0x..."
    }
  }
}
```

Use `--headers` with `--inspect` to include response headers in the output.

#### Error Response

```json
{
  "ok": false,
  "error": "Wallet not configured."
}
```
