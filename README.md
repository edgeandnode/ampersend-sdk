# Ampersend SDK

Multi-language SDK for building applications with [x402](https://github.com/coinbase/x402) payment capabilities.
Supports both buyer (client) and seller (server) roles with flexible payment verification and authorization patterns.

> **Looking for examples?** See the [ampersend-examples](https://github.com/edgeandnode/ampersend-examples) repository.

## 📦 Language Support

- **Python** - A2A protocol integration with wallet implementations and payment middleware

  - [Python SDK Documentation](./python/ampersend-sdk/README.md)
  - [LangChain Integration](./python/langchain-ampersend/README.md)

- **TypeScript** - MCP protocol integration with client, proxy, and server implementations
  - [TypeScript SDK Documentation](./typescript/README.md)

## 🤖 Teach Your Agent To Use Ampersend

If you just want your coding agent (Claude Code, Cursor, Codex, etc.) to be able to pay for things online, install the
ampersend skill:

```bash
npx skills add edgeandnode/ampersend-sdk
```

This uses the [`skills` CLI](https://github.com/vercel-labs/skills) to install the skill into your agent's skills
directory. The skill handles setup, payment, and configuration — your agent will know what to do when it sees a 402
response or you ask it to call a paid endpoint.

## 🚀 Quick Start

### Python

```bash
# Install Python 3.13
uv python install 3.13

# Install dependencies
uv sync --frozen --all-packages --group dev
```

**→ [Full Python documentation](./python/README.md)**

### TypeScript

```bash
# Install dependencies
pnpm install
pnpm build

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

**x402 Protocol** - Transport-agnostic payment protocol for agent and LLM applications that enables pay-per-request
patterns. See [x402 specification](https://github.com/coinbase/x402).

**Supported Transports:**

- **A2A** (Agent-to-Agent) - Transport protocol for agent communication with payment capabilities
- **MCP** (Model Context Protocol) - Transport protocol for LLM-tool integration with payment capabilities
- **HTTP** - Standard HTTP client with x402 payment capabilities (TypeScript)

**Key Components:**

- **Treasurer** - Authorizes and tracks payments
- **Wallet** - Creates and signs payment proofs (EOA and Smart Account support)
- **Client** - Initiates requests with payment handling
- **Server** - Verifies payments and processes requests

### Repository Structure

```
ampersend-sdk/
├── python/
│   ├── ampersend-sdk/           # Python SDK package
│   └── langchain-ampersend/     # LangChain integration
└── typescript/
    └── packages/
        └── ampersend-sdk/       # TypeScript SDK package
```

## 🔧 Prerequisites

### Python

- **uv** - Dependency management ([install](https://astral.sh/uv))
- **Python 3.13+**

### TypeScript

- **Node.js 18+**
- **pnpm** - Package manager

### Development

- **Test USDC** - For payment testing ([Circle faucet](https://faucet.circle.com))
- **Private Key** - Ethereum wallet for signing payments

## 📄 License

Apache 2.0 - See [LICENSE](./LICENSE)
