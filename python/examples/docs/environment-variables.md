# Environment Variables Reference

Complete reference for all environment variables used in Ampersend SDK examples.

## Overview

Examples support two modes:
1. **Smart Account + Ampersend** (recommended) - With spend limits and monitoring
2. **Standalone** - EOA + Naive mode for testing

## Smart Account Mode (Recommended)

### Required Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `EXAMPLES_A2A_BUYER__SMART_ACCOUNT_ADDRESS` | Agent's smart account address | `0x1234...` |
| `EXAMPLES_A2A_BUYER__SMART_ACCOUNT_KEY_PRIVATE_KEY` | Session key (owner of smart account) | `0xabcd...` |

### Optional Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `EXAMPLES_A2A_BUYER__AMPERSEND_API_URL` | Ampersend API endpoint | `https://api.staging.ampersend.ai` |
| `EXAMPLES_A2A_BUYER__USE_NAIVE_AUTHORIZER` | Skip API checks | `false` |

### Setup

1. Visit https://app.staging.ampersend.ai (testnet) or https://app.ampersend.ai (production)
2. Create agent account
3. Get Smart Account address and session key
4. Fund with USDC:
   - **Testnet**: https://faucet.circle.com/ (Base Sepolia, free)
   - **Production**: Transfer USDC to smart account (Base mainnet)

## Standalone Mode

### Required Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `EXAMPLES_A2A_BUYER__PRIVATE_KEY` | EOA wallet private key | `0xabcd...` |
| `EXAMPLES_A2A_BUYER__USE_NAIVE_AUTHORIZER` | Enable naive mode | `true` |

### Setup

1. Generate or use existing wallet private key
2. Fund with USDC:
   - **Testnet**: https://faucet.circle.com/ (Base Sepolia)
   - **Production**: Transfer USDC to wallet (Base mainnet)

**Warning**: Standalone mode has no spend limits or monitoring. Use only for testing.

## Service URLs

All examples default to staging services (testnet, rate-limited).

### A2A Service URLs

| Variable | Staging (Default) | Production |
|----------|-------------------|------------|
| `EXAMPLES_A2A_BUYER__SELLER_AGENT_URL` | `https://subgraph-a2a.x402.staging.thegraph.com` | `https://subgraph-a2a.x402.thegraph.com` |

### Local Orchestrator URLs

| Variable | Staging (Default) | Production |
|----------|-------------------|------------|
| `EXAMPLES_A2A_BUYER__AGENT_URL_1` | `https://subgraph-a2a.x402.staging.thegraph.com` | `https://subgraph-a2a.x402.thegraph.com` |
| `EXAMPLES_A2A_BUYER__AGENT_URL_2` | _(optional)_ | _(optional)_ |

### MCP Service URLs

| Variable | Staging (Default) | Production |
|----------|-------------------|------------|
| `EXAMPLE_BUYER__MCP__PROXY_URL` | `http://localhost:3000/mcp` | `http://localhost:3000/mcp` |
| `EXAMPLE_BUYER__MCP__TARGET_SERVER_URL` | `https://subgraph-mcp.x402.staging.ampersend.ai` | `https://subgraph-mcp.x402.thegraph.com` |

### MCP Proxy Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `BUYER_SMART_ACCOUNT_ADDRESS` | Smart account for proxy | _(required)_ |
| `BUYER_SMART_ACCOUNT_KEY_PRIVATE_KEY` | Session key for proxy | _(required)_ |
| `BUYER_SMART_ACCOUNT_VALIDATOR_ADDRESS` | Validator contract | `0x000000000013FDB5234E4E3162A810F54D9F7E98` |
| `AMPERSEND_API_URL` | Ampersend API for proxy | _(required)_ |
| `BUYER_PRIVATE_KEY` | EOA private key (standalone) | _(alternative)_ |

## Complete Configuration Examples

### Staging (Testnet) - Smart Account

```bash
# Agent configuration
export EXAMPLES_A2A_BUYER__SMART_ACCOUNT_ADDRESS=0x...  # From app.staging.ampersend.ai
export EXAMPLES_A2A_BUYER__SMART_ACCOUNT_KEY_PRIVATE_KEY=0x...
export EXAMPLES_A2A_BUYER__AMPERSEND_API_URL=https://api.staging.ampersend.ai

# Service URLs (defaults, can be omitted)
export EXAMPLES_A2A_BUYER__SELLER_AGENT_URL=https://subgraph-a2a.x402.staging.thegraph.com
export EXAMPLES_A2A_BUYER__AGENT_URL_1=https://subgraph-a2a.x402.staging.thegraph.com
export EXAMPLE_BUYER__MCP__TARGET_SERVER_URL=https://subgraph-mcp.x402.staging.ampersend.ai

# MCP proxy (if using MCP example)
export BUYER_SMART_ACCOUNT_ADDRESS=0x...
export BUYER_SMART_ACCOUNT_KEY_PRIVATE_KEY=0x...
export AMPERSEND_API_URL=https://api.staging.ampersend.ai
```

### Production - Smart Account

```bash
# Agent configuration (use production dashboard)
export EXAMPLES_A2A_BUYER__SMART_ACCOUNT_ADDRESS=0x...  # From app.ampersend.ai
export EXAMPLES_A2A_BUYER__SMART_ACCOUNT_KEY_PRIVATE_KEY=0x...
export EXAMPLES_A2A_BUYER__AMPERSEND_API_URL=https://api.ampersend.ai

# Service URLs
export EXAMPLES_A2A_BUYER__SELLER_AGENT_URL=https://subgraph-a2a.x402.thegraph.com
export EXAMPLES_A2A_BUYER__AGENT_URL_1=https://subgraph-a2a.x402.thegraph.com
export EXAMPLE_BUYER__MCP__TARGET_SERVER_URL=https://subgraph-mcp.x402.thegraph.com

# MCP proxy (if using MCP example)
export BUYER_SMART_ACCOUNT_ADDRESS=0x...
export BUYER_SMART_ACCOUNT_KEY_PRIVATE_KEY=0x...
export AMPERSEND_API_URL=https://api.ampersend.ai
```

### Standalone (Testing)

```bash
# Agent configuration
export EXAMPLES_A2A_BUYER__PRIVATE_KEY=0x...
export EXAMPLES_A2A_BUYER__USE_NAIVE_AUTHORIZER=true

# Service URLs (defaults to staging, can be omitted)
export EXAMPLES_A2A_BUYER__SELLER_AGENT_URL=https://subgraph-a2a.x402.staging.thegraph.com
export EXAMPLES_A2A_BUYER__AGENT_URL_1=https://subgraph-a2a.x402.staging.thegraph.com

# MCP proxy (if using MCP example)
export BUYER_PRIVATE_KEY=0x...
```

## Variable Naming Conventions

- **Buyer examples**: `EXAMPLES_A2A_BUYER__*` or `EXAMPLE_BUYER__MCP__*`
- **Seller examples**: `EXAMPLES_A2A_SELLER__*`
- **MCP proxy**: `BUYER_*` or `AMPERSEND_API_URL`

## Network Configuration

### Testnet (Staging)

- **Network**: Base Sepolia (Chain ID: 84532)
- **Currency**: Testnet USDC
- **Faucet**: https://faucet.circle.com/
- **Block Explorer**: https://sepolia.basescan.org/

### Production

- **Network**: Base (Chain ID: 8453)
- **Currency**: USDC
- **Block Explorer**: https://basescan.org/

## Smart Account Configuration

The validator address for Smart Accounts:
```
0x000000000013FDB5234E4E3162A810F54D9F7E98
```

This is the same across staging and production.

## Troubleshooting

### How do I know which mode I'm in?

Check your environment variables:
- If `EXAMPLES_A2A_BUYER__SMART_ACCOUNT_ADDRESS` is set → **Smart Account mode**
- If only `EXAMPLES_A2A_BUYER__PRIVATE_KEY` is set → **Standalone mode**

### Can I mix variables from different modes?

No. Choose one mode:
- **Smart Account**: Set `SMART_ACCOUNT_ADDRESS` + `SMART_ACCOUNT_KEY_PRIVATE_KEY` + `AMPERSEND_API_URL`
- **Standalone**: Set `PRIVATE_KEY` + `USE_NAIVE_AUTHORIZER=true`

### What happens if I don't set service URLs?

Examples default to staging services:
- A2A: `https://subgraph-a2a.x402.staging.thegraph.com`
- MCP: `https://subgraph-mcp.x402.staging.ampersend.ai`

This is perfect for getting started!

### How do I switch to production?

Update three variables:
1. `AMPERSEND_API_URL=https://api.ampersend.ai`
2. Service URL to production endpoint
3. Ensure using production account from https://app.ampersend.ai

---

## Security Notes

- **Never commit private keys** to version control
- **Use environment files** (`.env`) and keep them gitignored
- **Smart Accounts** provide better security than EOAs
- **Spend limits** in Ampersend prevent unauthorized spending
- **Testnet first** - Always test on staging before production

## Learn More

- [Getting Started Guide](../README.md)
- [Running MCP Proxy](./running-mcp-proxy.md)
- [Ampersend Dashboard](https://app.staging.ampersend.ai) (staging)
- [Ampersend Dashboard](https://app.ampersend.ai) (production)
