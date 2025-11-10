# MCP x402 Proxy

HTTP proxy server that adds x402 payment capabilities to any MCP server.

## Overview

Transparent proxy that sits between MCP clients and servers, automatically handling x402 payment flows.

**→ [Complete Documentation](../../../../README.md)**

## Quick Start

```bash
# Configure environment
export BUYER_PRIVATE_KEY=0x...

# Start proxy
pnpm --filter ampersend-sdk proxy:dev

# Connect clients to:
# http://localhost:3000/mcp?target=http://original-server:8000/mcp
```

## API Reference

### ProxyServer

```typescript
class ProxyServer {
  constructor(treasurer: X402Treasurer)

  async start(port: number): Promise<void>
  async stop(): Promise<void>
}
```

### initializeProxyServer

```typescript
function initializeProxyServer(options: ProxyServerOptions): Promise<{
  server: ProxyServer
}>
```

### ProxyServerOptions

```typescript
interface ProxyServerOptions {
  transport: {
    port?: number
  }
  treasurer: X402Treasurer
}
```

### X402BridgeTransport

```typescript
class X402BridgeTransport {
  constructor(options: { leftTransport: Transport; rightTransport: Transport; treasurer: X402Treasurer })

  async start(): Promise<void>
  async close(): Promise<void>
  async handleRequest(req: Request, res: Response, body: any): Promise<void>
}
```

Bridges client and server transports with payment handling.

## CLI Usage

```bash
# Start with defaults (port 3000)
ampersand-proxy

# Custom port
ampersand-proxy --port 8080

# Development (watch mode)
pnpm --filter ampersend-sdk proxy:dev
```

## Environment Variables

```bash
# EOA Mode
BUYER_PRIVATE_KEY=0x...                      # Required

# Smart Account Mode
BUYER_SMART_ACCOUNT_ADDRESS=0x...
BUYER_SMART_ACCOUNT_KEY_PRIVATE_KEY=0x...
BUYER_SMART_ACCOUNT_VALIDATOR_ADDRESS=0x...
```

## Features

- **Transparent Proxying**: No changes required to MCP clients or servers
- **Session Management**: Maintains state across requests
- **HTTP Transport**: Supports StreamableHTTP, SSE, WebSocket
- **Payment Retry**: Automatic retry with payment on 402 responses

## Learn More

- [TypeScript SDK Guide](../../../../README.md)
- [Proxy Architecture](../../../../README.md#mcp-proxy-architecture)
- [Treasurer Documentation](../../../../README.md#x402treasurer)
