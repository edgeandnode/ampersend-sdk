# TypeScript SDK - Ampersend

TypeScript SDK for integrating [x402](https://github.com/coinbase/x402) payment capabilities into MCP (Model Context Protocol) applications. Supports client, proxy, and server implementations with EOA and Smart Account wallets.

## Installation

```bash
pnpm install

# Build all
pnpm build
```

## Quick Start

### MCP Client

```typescript
import { X402McpClient } from "@ampersend_ai/ampersend-sdk/mcp/client"
import { AccountWallet, NaiveTreasurer } from "@ampersend_ai/ampersend-sdk/x402"

const wallet = new AccountWallet("0x...")
const treasurer = new NaiveTreasurer(wallet)

const client = new X402McpClient({
  serverUrl: "http://localhost:8000/mcp",
  treasurer,
})

await client.connect()
const result = await client.callTool("my_tool", { arg: "value" })
await client.close()
```

### MCP Proxy

```bash
# Configure environment
export BUYER_PRIVATE_KEY=0x...

# Start proxy
pnpm --filter ampersend-sdk proxy:dev

# Connect to: http://localhost:3000/mcp?target=http://original-server:8000/mcp
```

### FastMCP Server

```typescript
import { withX402Payment } from "@ampersend_ai/ampersend-sdk/mcp/server/fastmcp"
import { FastMCP } from "fastmcp"

const mcp = new FastMCP("my-server")

mcp.addTool({
  name: "paid_tool",
  description: "A tool that requires payment",
  schema: z.object({ query: z.string() }),
  execute: withX402Payment({
    onExecute: async ({ args }) => {
      return { scheme: "erc20", amount: "1000000" }
    },
    onPayment: async ({ payment, requirements }) => {
      return { success: true }
    },
  })(async (args, context) => {
    return "result"
  }),
})
```

## Core Concepts

### X402Treasurer

Handles payment authorization decisions and status tracking. The `NaiveTreasurer` implementation auto-approves all payments (useful for testing and demos).

### Wallets

- **AccountWallet** - For EOA (Externally Owned Accounts)
- **SmartAccountWallet** - For ERC-4337 smart accounts with ERC-1271 signatures

### Payment Flow

1. Client makes request → Server returns 402 with payment requirements
2. Treasurer authorizes payment → Payment injected into request metadata
3. Request retried with payment → Server verifies and processes

## Environment Variables

```bash
# EOA Mode
BUYER_PRIVATE_KEY=0x...

# Smart Account Mode
BUYER_SMART_ACCOUNT_ADDRESS=0x...
BUYER_SMART_ACCOUNT_KEY_PRIVATE_KEY=0x...
BUYER_SMART_ACCOUNT_VALIDATOR_ADDRESS=0x...
```

## Package Exports

```typescript
import { ... } from "@ampersend_ai/ampersend-sdk"                  // Main
import { ... } from "@ampersend_ai/ampersend-sdk/x402"             // Core x402
import { ... } from "@ampersend_ai/ampersend-sdk/mcp/client"       // Client
import { ... } from "@ampersend_ai/ampersend-sdk/mcp/proxy"        // Proxy
import { ... } from "@ampersend_ai/ampersend-sdk/smart-account"    // Smart accounts
import { ... } from "@ampersend_ai/ampersend-sdk/mcp/server/fastmcp" // FastMCP
```

## Module Documentation

Detailed implementation guides:

- **[MCP Client](./packages/ampersend-sdk/src/mcp/client/README.md)** - Client implementation and payment retry logic
- **[MCP Proxy](./packages/ampersend-sdk/src/mcp/proxy/README.md)** - HTTP proxy server architecture
- **[SDK Package](./packages/ampersend-sdk/README.md)** - Package overview

## Development

```bash
# Build
pnpm --filter ampersend-sdk build

# Test
pnpm --filter ampersend-sdk test

# Lint & format
pnpm --filter ampersend-sdk lint
pnpm --filter ampersend-sdk format:fix
```

## Learn More

- [x402 Specification](https://github.com/coinbase/x402)
- [MCP Protocol](https://modelcontextprotocol.io)
- [Repository Root](../README.md)
