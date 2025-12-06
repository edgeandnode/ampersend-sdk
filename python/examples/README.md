# Ampersend SDK - Python Examples

Comprehensive examples demonstrating x402 payment integration with A2A (Agent-to-Agent) and MCP (Model Context Protocol) protocols.

## Prerequisites

- **Python 3.13+**
- **UV package manager**
- **Node.js 18+** (for MCP proxy)

## Getting Started (Testnet)

Get started in minutes with free testnet:

### 1. Create Agent Account

1. Visit **https://app.staging.ampersend.ai**
2. Create an agent account
3. Get your **Smart Account address** and **session key**
4. Fund with testnet USDC: **https://faucet.circle.com/** (select Base Sepolia)

### 2. Clone and Setup

```bash
git clone https://github.com/edgeandnode/ampersend-sdk
cd ampersend-sdk
uv sync
```

### 3. Configure Environment

```bash
# Smart Account (recommended - with spend limits)
export EXAMPLES_A2A_BUYER__SMART_ACCOUNT_ADDRESS=0x...  # From staging dashboard
export EXAMPLES_A2A_BUYER__SMART_ACCOUNT_KEY_PRIVATE_KEY=0x...  # From staging dashboard
export EXAMPLES_A2A_BUYER__AMPERSEND_API_URL=https://api.staging.ampersend.ai
```

### 4. Run an Example

```bash
# Try the A2A buyer example (connects to staging service)
uv --directory=python/examples run -- adk run src/examples/a2a/buyer/adk
```

You just made your first x402 payment on testnet! The agent automatically handled the payment flow.

### Ready for Production?

1. Create account at **https://app.ampersend.ai**
2. Update environment:
   ```bash
   export EXAMPLES_A2A_BUYER__AMPERSEND_API_URL=https://api.ampersend.ai
   ```
3. Use production endpoints (see examples below)

**Note**: Production uses Base mainnet with real USDC. Staging services are rate-limited and for testing only.

---

## Examples Overview

### 1. A2A Direct Connection

**Path**: `src/examples/a2a/buyer/adk/`
**Demonstrates**: Direct connection to remote A2A agent with x402 payments

Connect directly to a remote agent and let the SDK handle payments automatically.

**Run**:
```bash
# Testnet (staging)
export EXAMPLES_A2A_BUYER__SMART_ACCOUNT_ADDRESS=0x...
export EXAMPLES_A2A_BUYER__SMART_ACCOUNT_KEY_PRIVATE_KEY=0x...
export EXAMPLES_A2A_BUYER__AMPERSEND_API_URL=https://api.staging.ampersend.ai

uv --directory=python/examples run -- adk run src/examples/a2a/buyer/adk
```

**Features**:
- Smart Account + EOA auto-detection
- AmpersendTreasurer with spend limits
- Defaults to staging subgraph service

### 2. A2A Local Orchestrator

**Path**: `src/examples/a2a/buyer/local_agent/`
**Demonstrates**: Local agent orchestrating multiple remote agents

Build a local agent that can discover and delegate to multiple specialized remote agents.

**Run**:
```bash
# Testnet (staging)
export EXAMPLES_A2A_BUYER__SMART_ACCOUNT_ADDRESS=0x...
export EXAMPLES_A2A_BUYER__SMART_ACCOUNT_KEY_PRIVATE_KEY=0x...
export EXAMPLES_A2A_BUYER__AMPERSEND_API_URL=https://api.staging.ampersend.ai

# Optional: Add more remote agents
# export EXAMPLES_A2A_BUYER__AGENT_URL_2=https://another-agent.example.com

uv --directory=python/examples run -- adk run src/examples/a2a/buyer/local_agent
```

**Features**:
- Uses `X402RemoteAgentToolset` for remote agent tools
- Automatic agent discovery
- Per-agent conversation context management
- Multi-agent orchestration

**How it works**:
1. Orchestrator lists available remote agents
2. Delegates user request to appropriate agent
3. Remote agent processes with automatic payment
4. Orchestrator returns result to user

### 3. MCP via Proxy

**Path**: `src/examples/mcp/buyer/adk/`
**Demonstrates**: MCP protocol with transparent payment proxy

Use MCP tools through a proxy that handles x402 payments transparently.

**Prerequisites**: Start the MCP proxy first (see [Running MCP Proxy](./docs/running-mcp-proxy.md))

**Run**:
```bash
# 1. Start MCP proxy (separate terminal)
export BUYER_SMART_ACCOUNT_ADDRESS=0x...
export BUYER_SMART_ACCOUNT_KEY_PRIVATE_KEY=0x...
export AMPERSEND_API_URL=https://api.staging.ampersend.ai
ampersend-proxy  # Runs on http://localhost:3000

# 2. Run MCP buyer
export EXAMPLE_BUYER__MCP__PROXY_URL=http://localhost:3000/mcp
export EXAMPLE_BUYER__MCP__TARGET_SERVER_URL=https://subgraph-mcp.x402.staging.ampersend.ai

uv --directory=python/examples run -- adk run src/examples/mcp/buyer/adk
```

**Features**:
- Transparent payment handling via proxy
- No payment code in client agent
- Works with any MCP server

### 4. A2A Seller

**Path**: `src/examples/a2a/seller/adk/`
**Demonstrates**: Creating x402-enabled A2A services

Create your own A2A service that requires payment.

**Run**:
```bash
export EXAMPLES_A2A_SELLER__PAY_TO_ADDRESS=0x...
export GOOGLE_API_KEY=...

uv --directory=python/examples run -- \
  uvicorn examples.a2a.seller.adk.agent:a2a_app --host localhost --port 8001
```

---

## Standalone Alternative

For testing without Ampersend account (local wallet only):

```bash
# Configure with EOA
export EXAMPLES_A2A_BUYER__PRIVATE_KEY=0x...  # Your wallet
export EXAMPLES_A2A_BUYER__USE_NAIVE_AUTHORIZER=true  # Skip API checks

# Run any buyer example (uses staging services)
uv --directory=python/examples run -- adk run src/examples/a2a/buyer/adk
# or
uv --directory=python/examples run -- adk run src/examples/a2a/buyer/local_agent
```

**Note**: Standalone mode has no spend limits or monitoring. Recommended for testing only.

---

## Environment Variables

See [Environment Variables Reference](./docs/environment-variables.md) for complete details.

### Quick Reference

**Smart Account Mode (Recommended)**:
```bash
EXAMPLES_A2A_BUYER__SMART_ACCOUNT_ADDRESS=0x...
EXAMPLES_A2A_BUYER__SMART_ACCOUNT_KEY_PRIVATE_KEY=0x...
EXAMPLES_A2A_BUYER__AMPERSEND_API_URL=https://api.staging.ampersend.ai
```

**Standalone Mode**:
```bash
EXAMPLES_A2A_BUYER__PRIVATE_KEY=0x...
EXAMPLES_A2A_BUYER__USE_NAIVE_AUTHORIZER=true
```

**Service URLs** (optional, defaults to staging):
```bash
EXAMPLES_A2A_BUYER__SELLER_AGENT_URL=https://subgraph-a2a.x402.staging.thegraph.com
EXAMPLES_A2A_BUYER__AGENT_URL_1=https://subgraph-a2a.x402.staging.thegraph.com
EXAMPLE_BUYER__MCP__TARGET_SERVER_URL=https://subgraph-mcp.x402.staging.ampersend.ai
```

---

## Architecture

### A2A Direct Connection

```
┌──────────────┐                    ┌──────────────┐
│ Your Agent   │────────────────────▶│ Remote Agent │
│              │  X402RemoteA2aAgent │              │
└──────────────┘                    └──────────────┘
       │                                     │
       │ Treasurer                          │ Payment
       │ (Spend Limits)                     │ Verification
       ▼                                     ▼
┌──────────────┐                    ┌──────────────┐
│   Wallet     │                    │   Receiver   │
│ (Smart Acct) │                    │   Address    │
└──────────────┘                    └──────────────┘
```

### A2A Local Orchestrator

```
┌────────────────────────────────────┐
│   Local Orchestrator Agent         │
│                                    │
│  Uses X402RemoteAgentToolset       │
│  Tools:                            │
│  - x402_a2a_list_agents           │
│  - x402_a2a_send_to_agent         │
└─────────┬──────────────┬───────────┘
          │              │
          ▼              ▼
    ┌──────────┐   ┌──────────┐
    │ Agent A  │   │ Agent B  │
    │ (Facts)  │   │ (Query)  │
    └──────────┘   └──────────┘
```

### MCP via Proxy

```
┌──────────────┐      ┌──────────────┐      ┌─────────────┐
│ Your Agent   │─────▶│  MCP Proxy   │─────▶│ MCP Server  │
│ (McpToolset) │      │ (ampersend)  │      │ (Subgraph)  │
└──────────────┘      └──────────────┘      └─────────────┘
                             │
                             │ x402 Payment
                             │ Handling
                             ▼
                      ┌──────────────┐
                      │  Treasurer   │
                      │  (Wallet)    │
                      └──────────────┘
```

---

## Troubleshooting

### "No module named 'ampersend_sdk'"

**Solution**: Install dependencies
```bash
uv sync
```

### "EXAMPLES_A2A_BUYER__SMART_ACCOUNT_ADDRESS" not found

**Solutions**:
- **Smart Account mode**: Set all required smart account variables
- **Standalone mode**: Use `EXAMPLES_A2A_BUYER__PRIVATE_KEY` instead

### "Insufficient funds" or "Payment rejected"

**Solutions**:
- **Testnet**: Get USDC from https://faucet.circle.com/ (Base Sepolia)
- **Production**: Check balance in https://app.ampersend.ai
- **Standalone**: Check your wallet USDC balance

### "Agent not found" (local_agent example)

**Solution**: Check `EXAMPLES_A2A_BUYER__AGENT_URL_1` is set and accessible:
```bash
curl https://subgraph-a2a.x402.staging.thegraph.com/.well-known/agent-card.json
```

### MCP Proxy Connection Refused

**Solutions**:
1. Check proxy is running: `curl http://localhost:3000/health`
2. See [Running MCP Proxy Guide](./docs/running-mcp-proxy.md)
3. Start proxy: `ampersend-proxy`

---

## Learn More

- [Environment Variables Reference](./docs/environment-variables.md)
- [Running MCP Proxy](./docs/running-mcp-proxy.md)
- [Python SDK Documentation](../README.md)
- [x402 Specification](https://github.com/coinbase/x402)
- [A2A Protocol](https://github.com/anthropics/adk)
- [MCP Protocol](https://modelcontextprotocol.io)
