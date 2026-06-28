# Agent Identity Gate Example

A FastMCP server that verifies agent identity and permissions **before** accepting x402 payments.

## Problem

x402 payments are wallet-based: any agent with funds can pay for a tool call. For sensitive or high-value services,
sellers need to know *who* is paying — not just that payment arrived. Without an authorization layer, a compromised
wallet or rogue agent can access any x402-protected resource.

## How it works

This example adds an identity check that runs before x402 payment settlement:

1. The agent includes an identity proof in MCP request metadata (`_meta["x-agent-proof"]`).
2. Before settling the payment, the server verifies the proof using a pluggable `IdentityVerifier`.
3. If verification fails, the tool call is rejected before any payment is settled.
4. If verification passes, payment settles normally via x402.

> **Honest disclaimer:** The included `StructuralVerifier` checks JSON shape only — it does NOT perform
> cryptographic verification. It validates structure, expiry timestamps, and permission bitmasks from
> public signals, but never verifies an actual proof. Use it for development; plug in a real verifier
> for production.

## Pluggable identity

The `IdentityVerifier<TProof>` interface is intentionally generic:

```typescript
interface IdentityVerifier<TProof = unknown> {
  verify(proof: TProof, requiredPermissions: bigint): Promise<VerificationResult>
}
```

Implement it with any identity system:

- **ZKP credentials** (e.g. [@bolyra/sdk](https://github.com/bolyra/bolyra)): verify a Groth16 proof of agent enrollment
- **SIWE**: verify an EIP-4361 signed message, check the signer against an allowlist
- **OAuth2**: introspect an access token, check scopes against required permissions
- **API keys**: hash and compare against a database of authorized agents
- **ERC-8004**: look up the agent's on-chain identity and reputation score

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

# Custom port and payment address
PORT=3000 PAY_TO_ADDRESS=0xYourAddress pnpm start
```

## Available tools

### `query_dataset`

- **Requires**: `READ_DATA` permission + x402 payment ($0.001 USDC)
- **Parameters**: `query` (string), `limit` (number, optional)

### `execute_transfer`

- **Requires**: `FINANCIAL_SMALL` permission + x402 payment ($0.005 USDC)
- **Parameters**: `recipient` (string), `amount` (string), `memo` (string, optional)

### `ping`

- **Requires**: nothing (free, no identity check)

## Project structure

```
src/
  index.ts      # Public exports
  server.ts     # FastMCP server with identity-gated x402 tools
  identity.ts   # IdentityVerifier interface + StructuralVerifier stub
  cli.ts        # CLI entry point
```

## License

Apache 2.0
