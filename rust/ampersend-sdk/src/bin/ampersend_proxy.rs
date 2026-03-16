use std::sync::Arc;

use clap::Parser;

use ampersend_sdk::ampersend::treasurer::{
    create_ampersend_treasurer, AmpersendTreasurerConfig, FullAmpersendTreasurerConfig,
};
use ampersend_sdk::mcp::proxy::env::parse_env_config;
use ampersend_sdk::mcp::proxy::server::initialize_proxy_server;
use ampersend_sdk::smart_account::constants::OWNABLE_VALIDATOR;
use ampersend_sdk::x402::treasurers::NaiveTreasurer;
use ampersend_sdk::x402::wallets::{create_wallet_from_config, SmartAccountConfig, WalletConfig};

/// MCP x402 proxy server CLI.
#[derive(Parser)]
#[command(name = "ampersend-proxy", version, about = "MCP x402 proxy server")]
struct Cli {
    /// Port number (overrides env)
    #[arg(short, long)]
    port: Option<u16>,

    /// Environment variable prefix (empty string for no prefix)
    #[arg(short, long, default_value = "RUST__MCP_PROXY__")]
    env_prefix: String,
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt::init();

    let cli = Cli::parse();

    let env_config = match parse_env_config(&cli.env_prefix) {
        Ok(c) => c,
        Err(e) => {
            eprintln!("[MCP-PROXY] Configuration error: {e}");
            std::process::exit(1);
        }
    };

    let port = cli.port.unwrap_or(env_config.port.unwrap_or(8402));

    // Build wallet config
    let wallet_config = if let Some(ref sa_addr) = env_config.buyer_smart_account_address {
        let validator: alloy_primitives::Address = env_config
            .buyer_smart_account_validator_address
            .as_deref()
            .unwrap_or(OWNABLE_VALIDATOR)
            .parse()
            .expect("Invalid validator address");

        WalletConfig::SmartAccount(SmartAccountConfig {
            smart_account_address: sa_addr.parse().expect("Invalid smart account address"),
            session_key_private_key: env_config
                .buyer_smart_account_key_private_key
                .clone()
                .expect("Missing smart account key"),
            chain_id: env_config.buyer_smart_account_chain_id.unwrap_or(84532),
            validator_address: Some(validator),
        })
    } else if let Some(ref pk) = env_config.buyer_private_key {
        WalletConfig::Eoa {
            private_key: pk.clone(),
        }
    } else {
        eprintln!("[MCP-PROXY] Must provide either EOA or Smart Account configuration");
        std::process::exit(1);
    };

    // Create treasurer based on configuration
    let treasurer: Arc<dyn ampersend_sdk::x402::treasurer::X402Treasurer> =
        if let Some(ref api_url) = env_config.ampersend_api_url {
            let config = AmpersendTreasurerConfig::Full(FullAmpersendTreasurerConfig {
                api_url: api_url.clone(),
                wallet_config,
            });
            Arc::new(create_ampersend_treasurer(config))
        } else {
            let wallet = create_wallet_from_config(wallet_config);
            Arc::new(NaiveTreasurer::new(wallet))
        };

    let treasurer_type = if env_config.ampersend_api_url.is_some() {
        "AmpersendTreasurer"
    } else {
        "NaiveTreasurer"
    };

    tracing::info!("[MCP-PROXY] Starting MCP proxy ({treasurer_type})...");
    tracing::info!("[MCP-PROXY] Port: {port}");

    let mut server = match initialize_proxy_server(port, treasurer).await {
        Ok(s) => s,
        Err(e) => {
            eprintln!("[MCP-PROXY] Failed to start: {e}");
            std::process::exit(1);
        }
    };

    tracing::info!("[MCP-PROXY] Proxy server started successfully");

    // Wait for shutdown signal
    tokio::signal::ctrl_c()
        .await
        .expect("Failed to listen for Ctrl+C");

    tracing::warn!("[MCP-PROXY] Shutting down...");
    server.stop().await;
}
