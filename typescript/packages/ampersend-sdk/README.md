# @ampersend_ai/ampersend-sdk

TypeScript SDK for integrating [x402](https://github.com/coinbase/x402) payment capabilities into MCP (Model Context Protocol) applications.

## Quick Start

```typescript
import { createAmpersendMcpClient } from "@ampersend_ai/ampersend-sdk"

// Create client (one-liner setup)
const client = await createAmpersendMcpClient({
  smartAccountAddress: "0x...",
  sessionKeyPrivateKey: "0x...",
  serverUrl: "http://localhost:8000/mcp",
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
