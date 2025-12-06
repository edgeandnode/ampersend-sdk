# Python SDK - Ampersend

Python SDK for integrating [x402](https://github.com/coinbase/x402) payment capabilities into A2A (Agent-to-Agent)
protocol applications. Supports both buyer (client) and seller (server) roles with flexible payment authorization
patterns.

## Installation

```bash
# Install Python 3.13
uv python install 3.13

# Install dependencies
uv sync --frozen --group dev
```

## Getting Started

Create your first x402-enabled agent in minutes using Ampersend's staging environment (free testnet).

### 1. Create Agent Account

1. Visit https://app.staging.ampersend.ai
2. Create an agent account
3. Get your Smart Account address and session key
4. Fund with testnet USDC: https://faucet.circle.com/ (select Base Sepolia)

### 2. Install SDK

```bash
uv python install 3.13
uv sync --frozen --group dev
```

### 3. Create Your Agent

```python
from ampersend_sdk.a2a.client import X402RemoteA2aAgent
from ampersend_sdk.ampersend import AmpersendTreasurer, ApiClient, ApiClientOptions
from ampersend_sdk.x402.wallets.smart_account import SmartAccountWallet
from ampersend_sdk.smart_account import SmartAccountConfig

# Configure smart account wallet
wallet = SmartAccountWallet(
    config=SmartAccountConfig(
        session_key="0x...",  # From staging dashboard
        smart_account_address="0x...",  # From staging dashboard
        validator_address="0x000000000013FDB5234E4E3162A810F54D9F7E98"
    )
)

# Create Ampersend treasurer (with spend limits & monitoring)
treasurer = AmpersendTreasurer(
    api_client=ApiClient(
        options=ApiClientOptions(
            base_url="https://api.staging.ampersend.ai",
            session_key_private_key="0x..."
        )
    ),
    wallet=wallet
)

# Create agent pointing to staging service (testnet, rate-limited)
agent = X402RemoteA2aAgent(
    treasurer=treasurer,
    name="my_agent",
    agent_card="https://subgraph-a2a.x402.staging.thegraph.com/.well-known/agent-card.json"
)

# Use the agent (payments handled automatically with spend limits)
result = await agent.run("Query Uniswap V3 pools on Base Sepolia")
```

### Standalone Alternative

For testing without Ampersend account:

```python
from ampersend_sdk.a2a.client import X402RemoteA2aAgent
from ampersend_sdk.x402.treasurers.naive import NaiveTreasurer
from ampersend_sdk.x402.wallets.account import AccountWallet

wallet = AccountWallet(private_key="0x...")
treasurer = NaiveTreasurer(wallet=wallet)  # Auto-approves, no limits

agent = X402RemoteA2aAgent(
    treasurer=treasurer,
    name="test_agent",
    agent_card="https://subgraph-a2a.x402.staging.thegraph.com/.well-known/agent-card.json"
)
```

**Note**: Standalone mode has no spend limits or monitoring. Recommended for testing only.

### Server (Seller)

```python
from google.adk.agents import Agent
from ampersend_sdk.a2a.server import to_a2a, make_x402_before_agent_callback

# Create your ADK agent with payment requirements
agent = Agent(
    name="MyAgent",
    before_agent_callback=make_x402_before_agent_callback(
        price="$0.001",
        network="base-sepolia",
        pay_to_address="0x...",
    ),
)

@agent.tool()
async def my_tool(query: str) -> str:
    return "result"

# Convert to A2A app (x402 support configured via before_agent_callback)
a2a_app = to_a2a(agent, host="localhost", port=8001)

# Serve with uvicorn
# uvicorn module:a2a_app --host 0.0.0.0 --port 8001
```

## Core Concepts

### X402Treasurer

Handles payment authorization and status tracking. The `NaiveTreasurer` implementation auto-approves all payments
(useful for testing and demos).

### Wallets

- **AccountWallet** - For EOA (Externally Owned Accounts)
- **SmartAccountWallet** - For ERC-4337 smart accounts with ERC-1271 signatures

### Payment Flow

1. Client sends request → Server responds with `PAYMENT_REQUIRED` (402)
2. Treasurer authorizes payment → Payment injected into request
3. Request retried with payment → Server verifies and processes

## Examples

Complete examples demonstrating x402 integration with A2A and MCP protocols.

### A2A Buyer (Direct Connection)

**Location**: `examples/src/examples/a2a/buyer/adk/`

Connects directly to remote A2A agents with automatic payment handling.

```bash
# Getting Started (Testnet)
export EXAMPLES_A2A_BUYER__SMART_ACCOUNT_ADDRESS=0x...  # From app.staging.ampersend.ai
export EXAMPLES_A2A_BUYER__SMART_ACCOUNT_KEY_PRIVATE_KEY=0x...
export EXAMPLES_A2A_BUYER__AMPERSEND_API_URL=https://api.staging.ampersend.ai

# Run (connects to staging service by default)
uv --directory=examples run -- adk run src/examples/a2a/buyer/adk
```

**Standalone Alternative**:
```bash
export EXAMPLES_A2A_BUYER__PRIVATE_KEY=0x...
export EXAMPLES_A2A_BUYER__USE_NAIVE_AUTHORIZER=true
uv --directory=examples run -- adk run src/examples/a2a/buyer/adk
```

See example code for Smart Account + EOA auto-detection and AmpersendTreasurer integration.

### MCP Buyer (via Proxy)

**Location**: `examples/src/examples/mcp/buyer/adk/`

Uses MCP protocol with transparent payment proxy.

**Prerequisites**: Start the MCP proxy (see [Running MCP Proxy Guide](./examples/docs/running-mcp-proxy.md))

```bash
# 1. Start proxy (separate terminal)
export BUYER_SMART_ACCOUNT_ADDRESS=0x...
export BUYER_SMART_ACCOUNT_KEY_PRIVATE_KEY=0x...
export AMPERSEND_API_URL=https://api.staging.ampersend.ai
ampersend-proxy  # Runs on http://localhost:3000

# 2. Run buyer (connects to staging MCP service)
export EXAMPLE_BUYER__MCP__PROXY_URL=http://localhost:3000/mcp
export EXAMPLE_BUYER__MCP__TARGET_SERVER_URL=https://subgraph-mcp.x402.staging.ampersend.ai
uv --directory=examples run -- adk run src/examples/mcp/buyer/adk
```

**How it works**: MCP proxy intercepts tool calls, detects x402 payment requirements (HTTP 402), automatically authorizes and submits payments, then retries the tool call.

### A2A Seller

**Location**: `examples/src/examples/a2a/seller/adk/`

Create x402-enabled A2A services.

```bash
# Set configuration
export EXAMPLES_A2A_SELLER__PAY_TO_ADDRESS=0x...
export GOOGLE_API_KEY=...

# Start seller
uv --directory=examples run -- \
  uvicorn examples.a2a.seller.adk.agent:a2a_app --host localhost --port 8001
```

### Production

Ready to use production endpoints? Update your environment:

```bash
# Ampersend
export AMPERSEND_API_URL=https://api.ampersend.ai

# A2A Service
export EXAMPLES_A2A_BUYER__SELLER_AGENT_URL=https://subgraph-a2a.x402.thegraph.com

# MCP Service
export EXAMPLE_BUYER__MCP__TARGET_SERVER_URL=https://subgraph-mcp.x402.thegraph.com
```

**Note**: Production uses Base mainnet with real USDC. Staging services are rate-limited and for testing only.

## Development

```bash
# Test
uv run -- pytest

# Lint & format
uv run -- ruff check python
uv run -- ruff format python

# Type check (strict mode)
uv run -- mypy python
```

## Learn More

- [x402 Specification](https://github.com/coinbase/x402)
- [A2A Protocol](https://github.com/anthropics/adk)
- [SDK Package Documentation](./ampersend-sdk/README.md)
- [Repository Root](../README.md)
