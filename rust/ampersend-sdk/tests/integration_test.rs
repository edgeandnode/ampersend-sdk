//! Integration tests for the Rust SDK, aligned with areas covered by Python and TypeScript.
//!
//! - **Treasurer**: Ampersend API (SIWE auth, authorize, report events) — requires
//!   AMPERSEND_API_URL, BUYER_SMART_ACCOUNT_*, or EOA BUYER_PRIVATE_KEY.
//! - **Wallet**: Create payment from env config (no live API).
//! - **Management**: list_agents when AMPERSEND_API_KEY is set (optional).
//!
//! These tests require a .env file at `rust/ampersend-sdk/.env`. They are ignored by default:
//!
//!   cargo test --test integration_test -- --ignored --nocapture

use std::collections::HashMap;

use ampersend_sdk::ampersend::treasurer::{
    create_ampersend_treasurer, AmpersendTreasurerConfig, SimpleAmpersendTreasurerConfig,
};
use ampersend_sdk::mcp::proxy::env::parse_env_config;
use ampersend_sdk::smart_account::constants::OWNABLE_VALIDATOR;
use ampersend_sdk::x402::treasurer::{PaymentContext, PaymentStatus, X402Treasurer};
use ampersend_sdk::x402::types::PaymentRequirements;
use ampersend_sdk::x402::wallets::{create_wallet_from_config, SmartAccountConfig, WalletConfig};

/// Load .env and return the parsed config.
fn load_env() -> ampersend_sdk::mcp::proxy::env::ProxyEnvConfig {
    dotenvy::dotenv().ok();
    parse_env_config("").expect("Failed to parse env config")
}

/// Build test PaymentRequirements for Base Sepolia USDC.
fn test_payment_requirements() -> PaymentRequirements {
    let mut extra = HashMap::new();
    extra.insert("name".to_string(), serde_json::json!("USD Coin"));
    extra.insert("version".to_string(), serde_json::json!("2"));

    PaymentRequirements {
        scheme: "exact".to_string(),
        network: "base-sepolia".to_string(),
        max_amount_required: "1000".to_string(),
        resource: "https://example.com/test-resource".to_string(),
        description: "Integration test payment".to_string(),
        mime_type: "application/json".to_string(),
        pay_to: "0x209693Bc6afc0C5328bA36FaF03C514EF312287C".to_string(),
        max_timeout_seconds: 300,
        asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e".to_string(),
        extra: Some(extra),
    }
}

/// Build a WalletConfig from proxy env (same logic as ampersend-proxy binary).
fn wallet_config_from_env(
    env: &ampersend_sdk::mcp::proxy::env::ProxyEnvConfig,
) -> Option<WalletConfig> {
    if let Some(ref sa_addr) = env.buyer_smart_account_address {
        let validator: alloy_primitives::Address = env
            .buyer_smart_account_validator_address
            .as_deref()
            .unwrap_or(OWNABLE_VALIDATOR)
            .parse()
            .ok()?;
        Some(WalletConfig::SmartAccount(SmartAccountConfig {
            smart_account_address: sa_addr.parse().ok()?,
            session_key_private_key: env.buyer_smart_account_key_private_key.clone()?,
            chain_id: env.buyer_smart_account_chain_id.unwrap_or(84532),
            validator_address: Some(validator),
        }))
    } else if let Some(ref pk) = env.buyer_private_key {
        Some(WalletConfig::Eoa {
            private_key: pk.clone(),
        })
    } else {
        None
    }
}

/// Build an AmpersendTreasurer (the full X402Treasurer) from env config.
fn build_x402_treasurer(
    env: &ampersend_sdk::mcp::proxy::env::ProxyEnvConfig,
) -> Box<dyn X402Treasurer> {
    let api_url = env
        .ampersend_api_url
        .clone()
        .expect("AMPERSEND_API_URL required for X402Treasurer tests");
    let sa_addr = env
        .buyer_smart_account_address
        .clone()
        .expect("BUYER_SMART_ACCOUNT_ADDRESS required");
    let session_key = env
        .buyer_smart_account_key_private_key
        .clone()
        .expect("BUYER_SMART_ACCOUNT_KEY_PRIVATE_KEY required");

    Box::new(create_ampersend_treasurer(
        AmpersendTreasurerConfig::Simple(SimpleAmpersendTreasurerConfig {
            smart_account_address: sa_addr,
            session_key_private_key: session_key,
            api_url: Some(api_url),
            chain_id: env.buyer_smart_account_chain_id.or(Some(84532)),
        }),
    ))
}

// ============================================================================
// X402Treasurer: Full payment authorization lifecycle
// ============================================================================

#[tokio::test]
#[ignore]
async fn x402_treasurer_full_lifecycle() {
    let env = load_env();
    let treasurer = build_x402_treasurer(&env);

    println!("\n=== X402Treasurer: Full Payment Authorization Lifecycle ===\n");

    // Simulate an MCP tool call that requires payment
    let requirements = vec![test_payment_requirements()];
    let context = PaymentContext {
        method: "tools/call".to_string(),
        params: serde_json::json!({
            "name": "weather-forecast",
            "arguments": { "city": "San Francisco" }
        }),
        metadata: None,
    };

    // ── Step 1: Server returns 402 with payment requirements ──
    println!("1. Server returned 402 Payment Required");
    println!(
        "   Requirements: {} USDC on base-sepolia",
        requirements[0].max_amount_required
    );
    println!("   Pay to: {}", requirements[0].pay_to);

    // ── Step 2: X402Treasurer consults Ampersend API for authorization ──
    println!("\n2. X402Treasurer.on_payment_required() — consulting Ampersend API...");
    println!("   - Authenticating with SIWE...");
    println!("   - Requesting payment authorization...");

    let authorization = treasurer
        .on_payment_required(&requirements, Some(&context))
        .await;

    match authorization {
        Some(ref auth) => {
            println!("   ✓ Payment AUTHORIZED by Ampersend API");
            println!("     Authorization ID: {}", auth.authorization_id);
            println!("     Payment scheme: {}", auth.payment.scheme);
            println!("     Payment network: {}", auth.payment.network);

            let payload = &auth.payment.payload;
            println!(
                "     Signed by: {}",
                payload["authorization"]["from"].as_str().unwrap_or("?")
            );
            println!(
                "     Signature: {}...{}",
                &payload["signature"].as_str().unwrap_or("?")[..20],
                &payload["signature"].as_str().unwrap_or("?")[payload["signature"]
                    .as_str()
                    .unwrap_or("?")
                    .len()
                    .saturating_sub(8)..]
            );
        }
        None => {
            println!("   Payment declined by API (check agent budget/config)");
            println!("\n=== Test completed (declined path) ===");
            return;
        }
    }

    let auth = authorization.unwrap();

    // ── Step 3: Client sends payment to server ──
    println!("\n3. X402Treasurer.on_status(Sending) — reporting to Ampersend API...");
    treasurer
        .on_status(PaymentStatus::Sending, &auth, Some(&context))
        .await;
    println!("   ✓ Status 'sending' reported");

    // ── Step 4: Server accepts payment ──
    println!("\n4. X402Treasurer.on_status(Accepted) — reporting to Ampersend API...");
    treasurer
        .on_status(PaymentStatus::Accepted, &auth, Some(&context))
        .await;
    println!("   ✓ Status 'accepted' reported");

    println!("\n=== Full X402Treasurer lifecycle completed successfully ===\n");
}

// ============================================================================
// X402Treasurer: Multiple payment requirements (API picks best)
// ============================================================================

#[tokio::test]
#[ignore]
async fn x402_treasurer_handles_multiple_requirements() {
    let env = load_env();
    let treasurer = build_x402_treasurer(&env);

    println!("\n=== X402Treasurer: Multiple Payment Requirements ===\n");

    // Server offers multiple payment options
    let mut cheap = test_payment_requirements();
    cheap.max_amount_required = "500".to_string();
    cheap.description = "Cheap option".to_string();

    let mut expensive = test_payment_requirements();
    expensive.max_amount_required = "5000".to_string();
    expensive.description = "Premium option".to_string();

    let requirements = vec![cheap, expensive];

    println!("Server offers {} payment options:", requirements.len());
    for (i, req) in requirements.iter().enumerate() {
        println!(
            "  [{}] {} — {} units",
            i, req.description, req.max_amount_required
        );
    }

    let context = PaymentContext {
        method: "tools/call".to_string(),
        params: serde_json::json!({"name": "multi-option-tool"}),
        metadata: None,
    };

    println!("\nX402Treasurer.on_payment_required() — API selects best option...");

    let authorization = treasurer
        .on_payment_required(&requirements, Some(&context))
        .await;

    match authorization {
        Some(auth) => {
            let amount = auth.payment.payload["authorization"]["value"]
                .as_str()
                .unwrap_or("?");
            println!("  ✓ API authorized payment for {} units", amount);
            println!("  Authorization ID: {}", auth.authorization_id);
        }
        None => {
            println!("  Payment declined (check agent budget)");
        }
    }

    println!("\n=== Multiple requirements test completed ===\n");
}

// ============================================================================
// X402Treasurer: Payment rejection lifecycle
// ============================================================================

#[tokio::test]
#[ignore]
async fn x402_treasurer_reports_rejection() {
    let env = load_env();
    let treasurer = build_x402_treasurer(&env);

    println!("\n=== X402Treasurer: Payment Rejection Lifecycle ===\n");

    let requirements = vec![test_payment_requirements()];
    let context = PaymentContext {
        method: "tools/call".to_string(),
        params: serde_json::json!({"name": "rejected-tool"}),
        metadata: None,
    };

    let authorization = treasurer
        .on_payment_required(&requirements, Some(&context))
        .await;

    match authorization {
        Some(auth) => {
            println!("1. Payment authorized: {}", auth.authorization_id);

            // Simulate server rejecting the payment
            println!("2. Simulating server rejection...");
            treasurer
                .on_status(PaymentStatus::Sending, &auth, Some(&context))
                .await;
            println!("   ✓ Status 'sending' reported");

            treasurer
                .on_status(PaymentStatus::Rejected, &auth, Some(&context))
                .await;
            println!("   ✓ Status 'rejected' reported");

            println!("\n   Ampersend API now knows this payment was rejected,");
            println!("   enabling spend tracking and anomaly detection.");
        }
        None => {
            println!("Payment declined by API");
        }
    }

    println!("\n=== Rejection lifecycle test completed ===\n");
}

// ============================================================================
// X402Treasurer: Error lifecycle
// ============================================================================

#[tokio::test]
#[ignore]
async fn x402_treasurer_reports_error() {
    let env = load_env();
    let treasurer = build_x402_treasurer(&env);

    println!("\n=== X402Treasurer: Error Lifecycle ===\n");

    let requirements = vec![test_payment_requirements()];
    let context = PaymentContext {
        method: "tools/call".to_string(),
        params: serde_json::json!({"name": "error-tool"}),
        metadata: None,
    };

    let authorization = treasurer
        .on_payment_required(&requirements, Some(&context))
        .await;

    match authorization {
        Some(auth) => {
            println!("1. Payment authorized: {}", auth.authorization_id);

            // Simulate network error during payment
            println!("2. Simulating network error...");
            treasurer
                .on_status(PaymentStatus::Sending, &auth, Some(&context))
                .await;
            println!("   ✓ Status 'sending' reported");

            treasurer
                .on_status(PaymentStatus::Error, &auth, Some(&context))
                .await;
            println!("   ✓ Status 'error' reported");

            println!("\n   Ampersend API can correlate errors with payment attempts.");
        }
        None => {
            println!("Payment declined by API");
        }
    }

    println!("\n=== Error lifecycle test completed ===\n");
}

// ============================================================================
// X402Treasurer: SIWE authentication flow
// ============================================================================

#[tokio::test]
#[ignore]
async fn x402_treasurer_siwe_auth_and_authorize() {
    let env = load_env();

    let api_url = env
        .ampersend_api_url
        .clone()
        .expect("AMPERSEND_API_URL required");
    let agent_address = env
        .buyer_smart_account_address
        .clone()
        .expect("BUYER_SMART_ACCOUNT_ADDRESS required");
    let session_key = env
        .buyer_smart_account_key_private_key
        .clone()
        .expect("BUYER_SMART_ACCOUNT_KEY_PRIVATE_KEY required");

    println!("\n=== X402Treasurer: SIWE Authentication Flow ===\n");

    let client = ampersend_sdk::ampersend::client::ApiClient::new(
        ampersend_sdk::ampersend::types::ApiClientOptions {
            base_url: api_url.clone(),
            session_key_private_key: Some(session_key),
            agent_address: agent_address.clone(),
            timeout_ms: 30000,
        },
    );

    println!("Agent: {agent_address}");
    println!("API:   {api_url}");
    println!();

    assert!(
        !client.is_authenticated().await,
        "Should start unauthenticated"
    );
    println!("1. Client is unauthenticated");

    println!("2. Calling authorize_payment (triggers SIWE auth)...");
    println!("   → GET  /api/v1/agents/auth/nonce");
    println!("   → POST /api/v1/agents/auth/login  (SIWE signed)");
    println!(
        "   → POST /api/v1/agents/{}/payment/authorize",
        &agent_address[..10]
    );

    let result = client
        .authorize_payment(&[test_payment_requirements()], None)
        .await;

    match result {
        Ok(response) => {
            println!("\n3. API Response:");
            println!(
                "   Authorized: {} requirement(s)",
                response.authorized.requirements.len()
            );
            println!("   Rejected:   {} requirement(s)", response.rejected.len());
            if let Some(idx) = response.authorized.recommended {
                let req = &response.authorized.requirements[idx];
                println!("   Recommended: index {idx}");
                println!("     Daily remaining:   {}", req.limits.daily_remaining);
                println!("     Monthly remaining: {}", req.limits.monthly_remaining);
            }
        }
        Err(e) => {
            println!("\n3. API Error: {e}");
        }
    }

    assert!(
        client.is_authenticated().await,
        "Should be authenticated after API call"
    );
    println!("\n4. Client is now authenticated (token cached)");

    println!("\n=== SIWE authentication test completed ===\n");
}

// ============================================================================
// Wallet: Create payment from env config (matches Python/TS wallet coverage)
// ============================================================================

#[tokio::test]
#[ignore]
async fn wallet_creates_payment_from_env() {
    let env = load_env();
    let wallet_config = wallet_config_from_env(&env).expect(
        "Set BUYER_PRIVATE_KEY or BUYER_SMART_ACCOUNT_ADDRESS + BUYER_SMART_ACCOUNT_KEY_PRIVATE_KEY",
    );

    println!("\n=== Wallet: Create payment from env config ===\n");

    let wallet = create_wallet_from_config(wallet_config);
    let requirements = test_payment_requirements();

    let payload = wallet
        .create_payment(&requirements)
        .await
        .expect("create_payment should succeed");

    assert_eq!(payload.scheme, "exact");
    assert_eq!(payload.network, "base-sepolia");
    assert_eq!(payload.x402_version, 1);
    assert!(
        payload.payload.get("signature").and_then(|v| v.as_str()).is_some(),
        "payload should contain signature"
    );
    assert!(
        payload
            .payload
            .get("authorization")
            .and_then(|v| v.get("from"))
            .is_some(),
        "payload should contain authorization.from"
    );

    println!("  ✓ Payment created: scheme={}, network={}", payload.scheme, payload.network);
    println!(
        "  ✓ Signature present: {} bytes",
        payload
            .payload
            .get("signature")
            .and_then(|v| v.as_str())
            .map(|s| s.len())
            .unwrap_or(0)
    );
    println!("\n=== Wallet integration test completed ===\n");
}

// ============================================================================
// Management API: list_agents (optional — run when AMPERSEND_API_KEY is set)
// ============================================================================

#[tokio::test]
#[ignore]
async fn management_list_agents() {
    let api_key = std::env::var("AMPERSEND_API_KEY").ok();
    let api_url = std::env::var("AMPERSEND_API_URL").ok();

    if api_key.is_none() {
        println!("\n=== Management: Skipped (AMPERSEND_API_KEY not set) ===\n");
        return;
    }

    let api_key = api_key.unwrap();
    println!("\n=== Management: list_agents (live API) ===\n");

    let client = ampersend_sdk::ampersend::AmpersendManagementClient::new(
        api_key,
        api_url,
        Some(30000),
    );

    let agents = client
        .list_agents()
        .await
        .expect("list_agents should succeed");

    println!("  ✓ list_agents returned {} agent(s)", agents.len());
    for a in agents.iter().take(3) {
        println!("    - {} ({})", a.name, a.address);
    }
    println!("\n=== Management integration test completed ===\n");
}
