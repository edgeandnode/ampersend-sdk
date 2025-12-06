# Running the MCP x402 Proxy

The MCP x402 proxy is a transparent HTTP proxy that adds x402 payment capabilities to any MCP server. It sits between MCP clients and servers, automatically handling payment requirements.

## Overview

```
┌─────────────┐      ┌──────────────┐      ┌─────────────┐
│ MCP Client  │─────▶│  MCP Proxy   │─────▶│ MCP Server  │
│ (Your Agent)│      │ (ampersend)  │      │ (Subgraph)  │
└─────────────┘      └──────────────┘      └─────────────┘
                            │
                            │ Handles x402
                            │ payments
                            ▼
                     ┌──────────────┐
                     │   Treasurer  │
                     │   (Wallet)   │
                     └──────────────┘
```

## Getting Started (Testnet)

### 1. Install the Proxy

```bash
# Option A: Install globally via npm
npm install -g @ampersend_ai/ampersend-sdk

# Option B: Install globally via pnpm
pnpm add -g @ampersend_ai/ampersend-sdk

# Option C: Build from source
cd typescript/packages/ampersend-sdk
pnpm install
pnpm build
```

### 2. Configure Wallet

**Recommended: Smart Account** (from app.staging.ampersend.ai)

```bash
export BUYER_SMART_ACCOUNT_ADDRESS=0x...           # From staging dashboard
export BUYER_SMART_ACCOUNT_KEY_PRIVATE_KEY=0x...  # From staging dashboard
export BUYER_SMART_ACCOUNT_VALIDATOR_ADDRESS=0x000000000013FDB5234E4E3162A810F54D9F7E98
export AMPERSEND_API_URL=https://api.staging.ampersend.ai
```

**Standalone Alternative: EOA**

```bash
export BUYER_PRIVATE_KEY=0x...  # Your wallet private key
```

### 3. Start the Proxy

```bash
# If installed globally
ampersend-proxy

# If built from source
cd typescript/packages/ampersend-sdk
pnpm proxy:start

# Development mode (with watch)
pnpm proxy:dev
```

The proxy starts on **http://localhost:3000** by default.

### 4. Connect Your Client

```bash
# Proxy URL with target parameter
http://localhost:3000/mcp?target=https://subgraph-mcp.x402.staging.ampersend.ai
```

## Environment Variables

### Required (Choose One Mode)

**Smart Account Mode (Recommended)**:
```bash
BUYER_SMART_ACCOUNT_ADDRESS=0x...           # Your agent's smart account
BUYER_SMART_ACCOUNT_KEY_PRIVATE_KEY=0x...  # Session key from dashboard
BUYER_SMART_ACCOUNT_VALIDATOR_ADDRESS=0x000000000013FDB5234E4E3162A810F54D9F7E98
AMPERSEND_API_URL=https://api.staging.ampersend.ai  # Staging (testnet)
```

**EOA Mode (Standalone)**:
```bash
BUYER_PRIVATE_KEY=0x...  # Wallet private key
```

### Optional

```bash
# Custom port (default: 3000)
PORT=8080

# Custom host (default: localhost)
HOST=0.0.0.0
```

## How It Works

1. **Client makes MCP tool call** → Proxy intercepts
2. **Proxy forwards to target server** → Server may return 402 (payment required)
3. **Proxy detects x402 requirement** → Calls treasurer for authorization
4. **Treasurer approves payment** → Proxy signs and submits payment
5. **Proxy retries tool call with payment** → Server verifies and processes
6. **Result returned to client** → Transparent to the client

## Production Setup

### 1. Create Production Account

- Visit https://app.ampersend.ai
- Create agent account
- Fund with USDC on Base mainnet

### 2. Update Environment

```bash
export BUYER_SMART_ACCOUNT_ADDRESS=0x...  # From production dashboard
export BUYER_SMART_ACCOUNT_KEY_PRIVATE_KEY=0x...
export AMPERSEND_API_URL=https://api.ampersend.ai  # Production
```

### 3. Use Production MCP Servers

```bash
# Example: Production subgraph MCP server
http://localhost:3000/mcp?target=https://subgraph-mcp.x402.thegraph.com
```

**Important**: Staging services are rate-limited. For production workloads, use production endpoints.

## Troubleshooting

### Connection Refused

**Issue**: Can't connect to proxy

**Solutions**:
- Check proxy is running: `curl http://localhost:3000/health`
- Check port isn't in use: `lsof -i :3000`
- Try different port: `PORT=8080 ampersend-proxy`

### Payment Failures

**Issue**: Proxy returns payment errors

**Solutions**:
- **Smart Account**: Check balance in dashboard
- **EOA**: Check USDC balance: `cast balance 0x... --rpc-url https://sepolia.base.org`
- Check treasurer logs for authorization errors

### Target Server Unavailable

**Issue**: MCP server not responding

**Solutions**:
- Verify target URL is correct
- Check server is running: `curl <target-url>/mcp`
- Try staging server: `https://subgraph-mcp.x402.staging.ampersend.ai`

## CLI Reference

```bash
# Start proxy
ampersend-proxy [options]

Options:
  --port <number>        Port to run on (default: 3000)
  --host <string>        Host to bind to (default: localhost)
  --env-prefix <string>  Environment variable prefix (default: none)

# View logs
# Proxy logs to stdout - use your preferred logging tool
ampersend-proxy 2>&1 | tee proxy.log
```

## Learn More

- [MCP Proxy API Reference](../../typescript/packages/ampersend-sdk/src/mcp/proxy/README.md)
- [X402 Specification](https://github.com/coinbase/x402)
- [MCP Protocol](https://modelcontextprotocol.io)
- [TypeScript SDK Documentation](../../typescript/packages/ampersend-sdk/README.md)
