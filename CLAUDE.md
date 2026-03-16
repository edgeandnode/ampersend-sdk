# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Multi-language SDK for integrating x402 payment capabilities into agent and LLM applications. Includes Python
implementation for A2A (Agent-to-Agent) protocol, TypeScript implementation for MCP (Model Context Protocol), and Rust
implementation for MCP. All support buyer (client) and seller (server) roles with flexible payment authorization
patterns.

## Development Commands

### Python Setup

```bash
# Install Python 3.13
uv python install 3.13

# Install dependencies including dev tools
uv sync --frozen --all-packages --group dev
```

### Rust Setup

```bash
# Build (default features: mcp + http-adapter)
cargo build --manifest-path rust/ampersend-sdk/Cargo.toml

# Build with all features (including CLI)
cargo build --manifest-path rust/ampersend-sdk/Cargo.toml --all-features
```

### TypeScript Setup

```bash
# Install dependencies
pnpm install

# Build SDK
pnpm --filter ampersend-sdk... build
```

### Python Testing

```bash
# Run all tests
uv run -- pytest

# Run specific test file
uv run -- pytest python/ampersend-sdk/tests/unit/x402/treasurers/test_naive.py

# Run only slow tests
uv run -- pytest -m slow
```

### Rust Testing

```bash
# Run unit tests
cargo test --manifest-path rust/ampersend-sdk/Cargo.toml

# Run integration tests (requires .env with credentials)
cargo test --manifest-path rust/ampersend-sdk/Cargo.toml --test integration_test -- --ignored

# Run specific test
cargo test --manifest-path rust/ampersend-sdk/Cargo.toml wallet_creates_signed_payment
```

### TypeScript Testing

```bash
# Run all tests
pnpm --filter ampersend-sdk test

# Run specific test
pnpm --filter ampersend-sdk test middleware.test.ts

# Watch mode
pnpm --filter ampersend-sdk test --watch
```

### Python Linting & Formatting

```bash
# Check linting (uses ruff for imports and unused imports)
uv run -- ruff check --output-format=github python

# Check formatting
uv run -- ruff format --diff python

# Apply formatting
uv run -- ruff format python

# Type checking (strict mode enabled)
uv run -- mypy python
```

### Rust Linting & Formatting

```bash
# Lint (clippy)
cargo clippy --manifest-path rust/ampersend-sdk/Cargo.toml --all-features -- -D warnings

# Format check
cargo fmt --manifest-path rust/ampersend-sdk/Cargo.toml --check

# Format fix
cargo fmt --manifest-path rust/ampersend-sdk/Cargo.toml
```

### TypeScript Linting & Formatting

```bash
# Lint
pnpm --filter ampersend-sdk lint

# Format check
pnpm --filter ampersend-sdk format

# Format fix
pnpm --filter ampersend-sdk format:fix

# Type check
pnpm --filter ampersend-sdk typecheck
```

### Markdown Formatting

```bash
# Check Markdown formatting
pnpm md:format

# Fix Markdown formatting
pnpm md:format:fix
```

### Lockfile

```bash
# Python lockfile
uv lock --check  # Verify
uv lock          # Update

# TypeScript lockfile
pnpm install --frozen-lockfile  # CI mode
pnpm install                     # Update lockfile
```

## Architecture

### Workspace Structure

This is a multi-language monorepo with both workspace at the repository root:

**Python** (uv workspace):

- `python/ampersend-sdk/`: Python SDK with A2A protocol integration
- `python/langchain-ampersend/`: LangChain integration for A2A with x402 payments
- Configured via `pyproject.toml`

**TypeScript** (pnpm workspace):

- `typescript/packages/ampersend-sdk/`: TypeScript SDK with MCP protocol integration
- Configured via `pnpm-workspace.yaml` and `package.json`

**Rust** (Cargo):

- `rust/ampersend-sdk/`: Rust SDK with MCP protocol integration
- Configured via `Cargo.toml`
- Feature flags: `mcp` (proxy server), `http-adapter` (HTTP client), `cli` (proxy binary)

### Core Components (Python)

**X402Treasurer (Abstract Base Class)**

- Handles payment authorization decisions via `onPaymentRequired()`
- Receives payment status updates via `onStatus()`
- Implementation example: `NaiveTreasurer` auto-approves all payments

**X402Wallet (Protocol)**

- Creates payment payloads from requirements
- Two implementations:
  - `AccountWallet`: For EOA (Externally Owned Accounts)
  - `SmartAccountWallet`: For smart contract wallets with ERC-1271 signatures

**Client Side (Buyer)**

- `X402Client`: Extends A2A BaseClient with payment middleware
- `X402RemoteA2aAgent`: Remote agent wrapper with treasurer integration
- `x402_middleware`: Intercepts responses, handles PAYMENT_REQUIRED states, submits payments recursively

**Server Side (Seller)**

- `X402A2aAgentExecutor`: Wraps ADK agents with payment verification using a configurable executor factory
- `X402ServerExecutorFactory`: Protocol defining factory signature for creating `X402ServerExecutor` instances with
  custom config
- `x402_executor_factory`: Required parameter accepting a factory function that receives `delegate` and `config` to
  create the payment verification executor
- `make_x402_before_agent_callback()`: Creates callbacks that check payment requirements before agent execution
- `to_a2a()`: Converts ADK agent to A2A app with x402 support (uses default `FacilitatorX402ServerExecutor` factory)
- Uses layered executor pattern: OuterA2aAgentExecutor → X402ServerExecutor (via factory) → InnerA2aAgentExecutor

### Key Architectural Patterns

**Middleware Pattern**: Client uses `x402_middleware` to recursively handle payment required responses by:

1. Detecting PAYMENT_REQUIRED status in task responses
2. Calling treasurer to authorize payment
3. Submitting payment and recursing with new message

**Executor Composition**: Server uses nested executors to separate concerns:

- Outer layer handles A2A task lifecycle events
- Middle layer (X402ServerExecutor) verifies payments
- Inner layer runs the actual agent

**Protocol-based Wallets**: X402Wallet is a Protocol (structural typing), allowing any object with `create_payment()` to
be used without inheritance.

### Core Components (TypeScript)

**X402Treasurer (Interface)**

- Similar to Python implementation but as TypeScript interface
- `onPaymentRequired()` - Authorizes payments
- `onStatus()` - Receives payment status updates
- Implementation: `NaiveTreasurer` auto-approves all payments

**Wallets**

- `AccountWallet`: For EOA (Externally Owned Accounts)
- `SmartAccountWallet`: For ERC-4337 smart contract wallets with ERC-1271 signatures

**MCP Client**

- `X402McpClient`: MCP client with automatic payment handling
- Middleware intercepts 402 responses and retries with payment
- Payment caching and status tracking

**MCP Proxy**

- HTTP proxy server that adds x402 to any MCP server
- Session management and treasurer integration
- CLI tool: `ampersend-proxy`

**FastMCP Server**

- `withX402Payment()`: Middleware wrapper for FastMCP tools
- `onExecute`: Callback to determine payment requirements
- `onPayment`: Callback to verify payments

### Core Components (Rust)

**X402Treasurer (Trait)**

- Async trait with `on_payment_required()` and `on_status()`
- `NaiveTreasurer`: Auto-approves all payments
- `AmpersendTreasurer`: API-backed authorization with SIWE authentication

**X402Wallet (Trait)**

- Creates payment payloads from requirements
- `AccountWallet`: For EOA (Externally Owned Accounts) with EIP-712 signing
- `SmartAccountWallet`: For smart contract wallets with ERC-3009/ERC-1271 signatures

**MCP Client**

- `McpClient`: MCP client with automatic x402 payment retry
- `X402Middleware`: Transport-level payment interception for the proxy bridge

**MCP Proxy**

- `ProxyServer`: HTTP proxy (axum) that adds x402 to any MCP server
- `X402Bridge`: Bidirectional message forwarding with payment middleware
- CLI tool: `ampersend-proxy` (feature-gated behind `cli`)

**FastMCP Server**

- `execute_with_x402_payment()`: Middleware for server-side payment checking
- `OnExecute` / `OnPayment` callbacks for payment requirements and verification

**HTTP Client**

- `X402HttpClient`: reqwest wrapper with automatic 402 handling
- v1/v2 protocol adapter for CAIP-2 network conversion

**Ampersend API**

- `ApiClient`: SIWE authentication, payment authorization, event reporting
- `AmpersendManagementClient`: Agent deployment and listing via API key

## Important Notes

**Python:**

- Python version: 3.13+ required
- Type checking is strict mode (`mypy --strict`)
- The x402-a2a dependency comes from a git repository with a specific revision
- Tests use async mode with function-scoped fixtures

**TypeScript:**

- Node.js 18+ required
- Uses pnpm for package management
- Type checking is strict mode enabled in tsconfig
- MCP SDK dependency comes from a forked git repository
- FastMCP dependency comes from a forked git repository (peer dependency)

**Rust:**

- Rust edition 2021, minimum rust-version 1.80
- Uses `alloy` crate family (0.8) for Ethereum primitives and EIP-712 signing
- Uses `axum` for the MCP proxy HTTP server
- Uses `reqwest` for HTTP client operations
- Feature flags control optional dependencies (`mcp`, `http-adapter`, `cli`)
- Integration tests require `.env` file with smart account credentials
- CI uses `cargo clippy` for linting, `cargo fmt` for formatting

### Additional Context (TypeScript)

- `.repos/` is a local, gitignored workspace for allowing access to reference codebases

**Effect v4**

- Effect v4 reference examples should exist at `.repos/effect-smol`.
  - If missing, clone it first: `git clone https://github.com/Effect-TS/effect-smol .repos/effect-smol`
  - Make sure to read the `.repos/effect-smol/LLMS.md` to understand "golden" patterns for working with Effect
