# Ampersend SDK

Multi-language SDK for building applications with [x402](https://github.com/coinbase/x402) payment capabilities. Supports both buyer (client) and seller (server) roles with flexible payment verification and authorization patterns.

## 📦 Language Support

- **Python** - A2A protocol integration with wallet implementations and payment middleware
  - [Python SDK Documentation](./python/README.md)

- **TypeScript** - MCP protocol integration with client, proxy, and server implementations
  - [TypeScript SDK Documentation](./typescript/README.md)

## 🚀 Quick Start

### Python (A2A Protocol)

```bash
# Install Python 3.13
uv python install 3.13

# Install dependencies
uv sync --frozen --group dev

# Configure environment
cp .env.example .env
# Edit .env with your credentials

# Run example seller
uv --directory=python/examples run -- uvicorn examples.a2a.seller.adk.agent:a2a_app --host localhost --port 8001

# Run example buyer (in another terminal)
echo "your query" | uv --directory=python/examples run -- adk run src/examples/a2a/buyer/adk
```

**→ [Full Python documentation](./python/README.md)**

### TypeScript (MCP Protocol)

```bash
# Install dependencies
cd typescript
pnpm install

# Configure environment
cp .env.example .env
# Edit .env with your credentials

# Run MCP proxy server
pnpm --filter ampersend-sdk proxy:dev

# Or run FastMCP example server
pnpm --filter fastmcp-x402-server dev
```

**→ [Full TypeScript documentation](./typescript/README.md)**

## 📚 Documentation

### Core Concepts

**x402 Protocol** - Transport-agnostic payment protocol for agent and LLM applications that enables pay-per-request patterns. See [x402 specification](https://github.com/coinbase/x402).

**Supported Transports:**

- **A2A** (Agent-to-Agent) - Transport protocol for agent communication with payment capabilities
- **MCP** (Model Context Protocol) - Transport protocol for LLM-tool integration with payment capabilities

**Key Components:**

- **Treasurer** - Authorizes and tracks payments
- **Wallet** - Creates and signs payment proofs (EOA and Smart Account support)
- **Client** - Initiates requests with payment handling
- **Server** - Verifies payments and processes requests

### Repository Structure

```
ampersend-sdk/
├── python/
│   ├── ampersend-sdk/        # Python SDK package
│   └── examples/             # A2A buyer/seller examples
└── typescript/
    ├── packages/
    │   └── ampersend-sdk/    # TypeScript SDK package
    └── examples/             # MCP server examples
```

## 🔧 Prerequisites

### Python

- **uv** - Dependency management ([install](https://astral.sh/uv))
- **Python 3.13+**

### TypeScript

- **Node.js 18+**
- **pnpm** - Package manager

### Development

- **Google API Key** - Required for examples ([get key](https://aistudio.google.com/app/apikey))
- **OpenAI API Key** - Required for examples ([get key](https://platform.openai.com/api-keys))
- **Test USDC** - For payment testing ([Circle faucet](https://faucet.circle.com))
- **Private Key** - Ethereum wallet for signing payments

## 📄 License

Apache 2.0 - See [LICENSE](./LICENSE)
