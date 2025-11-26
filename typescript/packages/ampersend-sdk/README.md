# @ampersend_ai/ampersend-sdk

TypeScript SDK for integrating [x402](https://github.com/coinbase/x402) payment capabilities into MCP (Model Context Protocol) applications.

## Quick Start

```typescript
import { X402McpClient } from "@ampersend_ai/ampersend-sdk/mcp/client"
import { AccountWallet, NaiveTreasurer } from "@ampersend_ai/ampersend-sdk/x402"

const wallet = new AccountWallet("0x...")
const treasurer = new NaiveTreasurer(wallet)
const client = new X402McpClient({
  serverUrl: "http://localhost:8000/mcp",
  treasurer,
})

const result = await client.callTool("my_tool", { arg: "value" })
```

## Package Exports

```typescript
import { ... } from "@ampersend_ai/ampersend-sdk"                  // Main
import { ... } from "@ampersend_ai/ampersend-sdk/x402"             // Core x402
import { ... } from "@ampersend_ai/ampersend-sdk/mcp/client"       // MCP client
import { ... } from "@ampersend_ai/ampersend-sdk/mcp/proxy"        // MCP proxy
import { ... } from "@ampersend_ai/ampersend-sdk/smart-account"    // Smart accounts
import { ... } from "@ampersend_ai/ampersend-sdk/mcp/server/fastmcp" // FastMCP
```

## Documentation

**→ [Complete TypeScript SDK Documentation](../../README.md)**

### Module-Specific Docs

- [MCP Client API](./src/mcp/client/README.md)
- [MCP Proxy API](./src/mcp/proxy/README.md)
- [FastMCP Example](../../examples/fastmcp-x402-server/README.md)

## Development

```bash
# Build
pnpm build

# Test
pnpm test

# Lint & format
pnpm lint
pnpm format:fix

# Type check
pnpm typecheck
```

## Learn More

- [TypeScript SDK Guide](../../README.md)
- [x402 Specification](https://github.com/coinbase/x402)
- [MCP Protocol](https://modelcontextprotocol.io)
