# Agent Identity Gate Example

A FastMCP server that verifies agent identity and permissions **before** accepting x402 payments.

## Problem

x402 payments are wallet-based: any agent with funds can pay for a tool call. For sensitive or high-value services,
sellers need to know *who* is paying — not just that payment arrived. Without an authorization layer, a compromised
wallet or rogue agent can access any x402-protected resource.

## How it works

This example adds an identity check to the `onPayment` hook:

1. The agent includes a ZKP credential proof in the payment's `extra` field.
2. Before settling the payment, the server verifies the proof:
   - Agent is enrolled in a credential registry
   - Agent holds the required permission bits for the tool
   - Credential hasn't expired
3. If verification fails, the payment is never settled and the tool call is rejected.
4. If verification passes, payment settles normally via x402.

The identity layer is pluggable. This example uses [@bolyra/sdk](https://github.com/bolyra/bolyra) for ZKP-based agent
credentials, but the `verifyAgentProof()` function can be swapped for any authorization system — SIWE, OAuth2 token
introspection, ERC-8004 registry lookups, API keys, etc.

## Installation

```bash
pnpm install
pnpm build
```

## Usage

```bash
# Start the server
pnpm start

# Development mode with hot reload
pnpm dev

# Custom port
PORT=3000 pnpm start

# Set the seller's payment address
PAY_TO_ADDRESS=0xYourAddress pnpm start
```

## Available Tools

### `query_dataset`

- **Requires**: `READ_DATA` permission + x402 payment ($0.001 USDC)
- **Parameters**: `query` (string), `limit` (number, optional)
- **Returns**: JSON search results

### `execute_transfer`

- **Requires**: `FINANCIAL_SMALL` permission + x402 payment ($0.005 USDC)
- **Parameters**: `recipient` (string), `amount` (string), `memo` (string, optional)
- **Returns**: JSON transfer receipt

### `ping`

- **Requires**: nothing (free, no identity check)
- **Returns**: `"pong"`

## Agent Proof Format

The agent proof is included in the x402 payment `extra` field:

```json
{
  "x-agent-proof": {
    "envelope": {
      "version": "1.0.0",
      "circuit": { "name": "AgentPolicy", "version": "1.0.0" },
      "proofType": "groth16",
      "publicSignals": [
        "12345...",
        "5",
        "1735689600"
      ],
      "proof": {
        "pi_a": ["...", "..."],
        "pi_b": [["...", "..."], ["...", "..."]],
        "pi_c": ["...", "..."]
      }
    }
  }
}
```

Public signals layout:

| Index | Field               | Description                              |
| ----- | ------------------- | ---------------------------------------- |
| 0     | `agentNullifier`    | Pseudonymous agent ID (no PII leaked)    |
| 1     | `permissionBitmask` | Cumulative permission bits the agent has |
| 2     | `expiryTimestamp`    | Unix timestamp when credential expires   |

## Adapting to Other Identity Systems

Replace `src/identity.ts` with your own verification logic. The interface is:

```typescript
async function verifyAgentProof(
  proof: YourProofType,
  requiredPermissions: bigint,
): Promise<{ valid: boolean; reason?: string }>
```

Examples of alternative implementations:

- **SIWE**: Verify an EIP-4361 signed message, check the signer against an allowlist
- **OAuth2**: Introspect an access token, check scopes against required permissions
- **ERC-8004**: Look up the agent's on-chain identity and reputation score
- **API keys**: Hash and compare against a database of authorized agents

## Project Structure

```
src/
  index.ts      # Main exports
  server.ts     # FastMCP server with identity-gated x402 tools
  identity.ts   # Agent credential verification (pluggable)
  cli.ts        # CLI entry point
```

## License

Apache 2.0
