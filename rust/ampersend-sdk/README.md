# ampersend-sdk (Rust)

Rust SDK for integrating x402 payment capabilities into agent and LLM applications. Provides MCP (Model Context
Protocol) integration with buyer (client) and seller (server) roles and flexible payment authorization patterns.

## Quick Start

### AmpersendTreasurer (recommended)

The `AmpersendTreasurer` consults the Ampersend API for payment authorization, enforcing spend limits and policies:

```rust
use ampersend_sdk::ampersend::{
    AmpersendTreasurerConfig, SimpleAmpersendTreasurerConfig, create_ampersend_treasurer,
};
use ampersend_sdk::x402::treasurer::X402Treasurer;

let treasurer = create_ampersend_treasurer(AmpersendTreasurerConfig::Simple(
    SimpleAmpersendTreasurerConfig {
        smart_account_address: "0x...".to_string(),
        session_key_private_key: "0x...".to_string(),
        api_url: None,    // defaults to https://api.ampersend.ai
        chain_id: None,   // defaults to Base mainnet (8453)
    },
));

// Use with MCP client, proxy, or HTTP client
```

### MCP Client

Automatic x402 payment handling for MCP tool calls:

```rust
use ampersend_sdk::mcp::client::create_ampersend_mcp_client;
use ampersend_sdk::mcp::client::SimpleClientOptions;
use ampersend_sdk::mcp::types::Implementation;

let mut client = create_ampersend_mcp_client(SimpleClientOptions {
    client_info: Implementation {
        name: "my-app".to_string(),
        version: "1.0.0".to_string(),
    },
    smart_account_address: "0x...".to_string(),
    session_key_private_key: "0x...".to_string(),
    api_url: None,
    chain_id: None,
});

// Connect and call tools — payments handled automatically
// client.connect(url).await?;
// client.call_tool("weather", json!({"city": "SF"})).await?;
```

### MCP Proxy

Add x402 payment support to any MCP server:

```rust
use ampersend_sdk::mcp::proxy::create_ampersend_proxy;
use ampersend_sdk::mcp::proxy::SimpleProxyOptions;

let server = create_ampersend_proxy(SimpleProxyOptions {
    port: 8402,
    smart_account_address: "0x...".to_string(),
    session_key_private_key: "0x...".to_string(),
    api_url: None,
    chain_id: None,
}).await?;

// Proxy running at http://localhost:8402/mcp?target=<TARGET_URL>
```

### FastMCP Server Middleware

Add payment requirements to MCP tool execution:

```rust
use ampersend_sdk::mcp::server::fastmcp::*;

let options = WithX402PaymentOptions {
    on_execute: Box::new(|ctx| Box::pin(async move {
        // Return Some(requirements) to require payment, None for free
        Some(payment_requirements)
    })),
    on_payment: Box::new(|ctx| Box::pin(async move {
        // Verify and settle payment
        Ok(Some(settle_response))
    })),
};
```

### HTTP Client

x402-aware HTTP client for automatic payment handling:

```rust
use ampersend_sdk::http::create_ampersend_http_client;
use ampersend_sdk::http::SimpleHttpClientOptions;

let client = create_ampersend_http_client(SimpleHttpClientOptions {
    smart_account_address: "0x...".to_string(),
    session_key_private_key: "0x...".to_string(),
    api_url: None,
    network: None, // defaults to "base"
})?;

// 402 responses automatically trigger payment + retry
```

### NaiveTreasurer (testing)

Auto-approves all payments — useful for development:

```rust
use ampersend_sdk::x402::treasurers::NaiveTreasurer;
use ampersend_sdk::x402::wallets::AccountWallet;

let wallet = AccountWallet::from_private_key("0x...").unwrap();
let treasurer = NaiveTreasurer::new(Box::new(wallet));
```

## Feature Flags

| Feature | Default | Description |
| --- | --- | --- |
| `mcp` | Yes | MCP proxy server (axum) |
| `http-adapter` | Yes | x402 HTTP client wrapper |
| `cli` | No | `ampersend-proxy` CLI binary |

## CLI

```bash
cargo install ampersend-sdk --features cli

# Run proxy with environment variables
export BUYER_SMART_ACCOUNT_ADDRESS=0x...
export BUYER_SMART_ACCOUNT_KEY_PRIVATE_KEY=0x...
export AMPERSEND_API_URL=https://api.ampersend.ai
ampersend-proxy --port 8402
```

## Development

```bash
# Build
cargo build

# Test (unit tests)
cargo test

# Test (integration, requires .env)
cargo test --test integration_test -- --ignored

# Lint
cargo clippy --all-features -- -D warnings

# Format
cargo fmt --check

# Build CLI
cargo build --features cli
```

## Architecture

```
src/
├── x402/                # Core x402 traits and types
│   ├── treasurer.rs     # X402Treasurer trait
│   ├── wallet.rs        # X402Wallet trait
│   ├── types.rs         # PaymentRequirements, PaymentPayload, etc.
│   ├── treasurers/      # NaiveTreasurer
│   └── wallets/         # AccountWallet, SmartAccountWallet
├── smart_account/       # ERC-3009/ERC-1271 signing
├── ampersend/           # Ampersend API client and treasurer
│   ├── client.rs        # SIWE auth, payment authorization
│   ├── treasurer.rs     # AmpersendTreasurer (API-backed)
│   └── management.rs    # Agent deployment and management
├── mcp/                 # MCP protocol integration
│   ├── client/          # MCP client with payment retry
│   ├── proxy/           # HTTP proxy server
│   └── server/          # FastMCP server middleware
├── http/                # x402 HTTP client adapter
└── bin/                 # ampersend-proxy CLI
```
