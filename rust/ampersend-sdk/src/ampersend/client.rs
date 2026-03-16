use std::time::Duration;

use chrono::Utc;
use reqwest::Client;
use siwe::Message as SiweMessage;
use tokio::sync::Mutex;

use super::types::*;
use crate::error::ApiError;
use crate::x402::types::{PaymentPayload, PaymentRequirements};

/// Ampersend API client with SIWE authentication.
///
/// Provides methods to interact with the payment authorization API,
/// including SIWE authentication and payment lifecycle management.
pub struct ApiClient {
    base_url: String,
    session_key_private_key: Option<String>,
    agent_address: String,
    timeout: Duration,
    http: Client,
    auth: Mutex<AuthenticationState>,
}

impl ApiClient {
    pub fn new(options: ApiClientOptions) -> Self {
        let base_url = options.base_url.trim_end_matches('/').to_string();
        let timeout = Duration::from_millis(options.timeout_ms);
        let http = Client::builder()
            .timeout(timeout)
            .build()
            .expect("Failed to create HTTP client");

        Self {
            base_url,
            session_key_private_key: options.session_key_private_key,
            agent_address: options.agent_address,
            timeout,
            http,
            auth: Mutex::new(AuthenticationState::default()),
        }
    }

    /// Request authorization for a payment.
    pub async fn authorize_payment(
        &self,
        requirements: &[PaymentRequirements],
        context: Option<&AuthRequestContext>,
    ) -> Result<AgentPaymentAuthResponse, ApiError> {
        self.ensure_authenticated().await?;

        let request = AgentPaymentAuthRequest {
            requirements: requirements.to_vec(),
            context: context.cloned(),
        };

        let auth = self.auth.lock().await;
        let token = auth.token.as_deref().unwrap_or_default().to_string();
        drop(auth);

        let url = format!(
            "{}/api/v1/agents/{}/payment/authorize",
            self.base_url, self.agent_address
        );

        let response = self
            .http
            .post(&url)
            .header("Content-Type", "application/json")
            .header("Authorization", format!("Bearer {token}"))
            .json(&request)
            .send()
            .await
            .map_err(|e| {
                if e.is_timeout() {
                    ApiError::Timeout(self.timeout.as_millis() as u64)
                } else {
                    ApiError::Request(e.to_string())
                }
            })?;

        if !response.status().is_success() {
            let status = response.status().as_u16();
            let body = response.text().await.unwrap_or_default();
            return Err(ApiError::Http {
                status,
                message: body,
            });
        }

        response
            .json::<AgentPaymentAuthResponse>()
            .await
            .map_err(|e| ApiError::Validation(e.to_string()))
    }

    /// Report a payment lifecycle event.
    pub async fn report_payment_event(
        &self,
        event_id: &str,
        payment: &PaymentPayload,
        event: PaymentEventType,
    ) -> Result<AgentPaymentEventResponse, ApiError> {
        self.ensure_authenticated().await?;

        let report = AgentPaymentEventReport {
            id: event_id.to_string(),
            payment: payment.clone(),
            event,
        };

        let auth = self.auth.lock().await;
        let token = auth.token.as_deref().unwrap_or_default().to_string();
        drop(auth);

        let url = format!(
            "{}/api/v1/agents/{}/payment/events",
            self.base_url, self.agent_address
        );

        let response = self
            .http
            .post(&url)
            .header("Content-Type", "application/json")
            .header("Authorization", format!("Bearer {token}"))
            .json(&report)
            .send()
            .await
            .map_err(|e| {
                if e.is_timeout() {
                    ApiError::Timeout(self.timeout.as_millis() as u64)
                } else {
                    ApiError::Request(e.to_string())
                }
            })?;

        if !response.status().is_success() {
            let status = response.status().as_u16();
            let body = response.text().await.unwrap_or_default();
            return Err(ApiError::Http {
                status,
                message: body,
            });
        }

        response
            .json::<AgentPaymentEventResponse>()
            .await
            .map_err(|e| ApiError::Validation(e.to_string()))
    }

    /// Clear the current authentication state.
    pub async fn clear_auth(&self) {
        let mut auth = self.auth.lock().await;
        *auth = AuthenticationState::default();
    }

    /// Get the configured agent address.
    pub fn agent_address(&self) -> &str {
        &self.agent_address
    }

    /// Check if currently authenticated and token is valid.
    pub async fn is_authenticated(&self) -> bool {
        let auth = self.auth.lock().await;
        auth.token.is_some() && auth.expires_at.map(|exp| exp > Utc::now()).unwrap_or(false)
    }

    /// Ensure the client is authenticated, performing authentication if needed.
    async fn ensure_authenticated(&self) -> Result<(), ApiError> {
        let mut auth = self.auth.lock().await;
        let needs_auth =
            auth.token.is_none() || auth.expires_at.map(|exp| exp <= Utc::now()).unwrap_or(true);

        if needs_auth {
            self.perform_authentication(&mut auth).await?;
        }
        Ok(())
    }

    /// Perform SIWE authentication.
    async fn perform_authentication(&self, auth: &mut AuthenticationState) -> Result<(), ApiError> {
        let session_key = self
            .session_key_private_key
            .as_deref()
            .ok_or_else(|| ApiError::Auth("Session key private key is required".to_string()))?;

        // Create signer from session key
        let key = session_key.strip_prefix("0x").unwrap_or(session_key);
        let key_bytes: alloy_primitives::FixedBytes<32> = key
            .parse()
            .map_err(|e| ApiError::Auth(format!("Invalid session key: {e}")))?;
        let signer = alloy_signer_local::PrivateKeySigner::from_bytes(&key_bytes)
            .map_err(|e| ApiError::Auth(format!("Invalid session key: {e}")))?;
        let session_key_address = signer.address();

        // Step 1: Get nonce
        let nonce_url = format!("{}/api/v1/agents/auth/nonce", self.base_url);
        let nonce_resp = self
            .http
            .get(&nonce_url)
            .send()
            .await
            .map_err(|e| ApiError::Request(e.to_string()))?;

        if !nonce_resp.status().is_success() {
            return Err(ApiError::Auth("Failed to get nonce".to_string()));
        }

        let nonce_data: SiweNonceResponse = nonce_resp
            .json()
            .await
            .map_err(|e| ApiError::Validation(e.to_string()))?;

        // Step 2: Create SIWE message
        let domain = url::Url::parse(&self.base_url)
            .ok()
            .and_then(|u| u.host_str().map(|h| h.to_string()))
            .unwrap_or_else(|| "localhost".to_string());

        let now = Utc::now();
        let siwe_message = format!(
            "{domain} wants you to sign in with your Ethereum account:\n\
            {session_key_address}\n\n\
            Sign in to API\n\n\
            URI: {base_url}\n\
            Version: 1\n\
            Chain ID: 1\n\
            Nonce: {nonce}\n\
            Issued At: {issued_at}",
            domain = domain,
            session_key_address = session_key_address,
            base_url = self.base_url,
            nonce = nonce_data.nonce,
            issued_at = now.to_rfc3339(),
        );

        // Parse to validate
        let _parsed: SiweMessage = siwe_message
            .parse()
            .map_err(|e| ApiError::Auth(format!("Failed to create SIWE message: {e}")))?;

        // Step 3: Sign the message
        use alloy_signer::Signer;
        let signature = signer
            .sign_message(siwe_message.as_bytes())
            .await
            .map_err(|e| ApiError::Auth(format!("Failed to sign SIWE message: {e}")))?;
        let sig_hex = format!("0x{}", hex::encode(signature.as_bytes()));

        // Step 4: Login with signature
        let login_request = SiweLoginRequest {
            message: siwe_message,
            signature: sig_hex,
            session_id: nonce_data.session_id,
            agent_address: self.agent_address.clone(),
        };

        let login_url = format!("{}/api/v1/agents/auth/login", self.base_url);
        let login_resp = self
            .http
            .post(&login_url)
            .header("Content-Type", "application/json")
            .json(&login_request)
            .send()
            .await
            .map_err(|e| ApiError::Request(e.to_string()))?;

        if !login_resp.status().is_success() {
            let body = login_resp.text().await.unwrap_or_default();
            return Err(ApiError::Auth(format!("Login failed: {body}")));
        }

        let login_data: SiweLoginResponse = login_resp
            .json()
            .await
            .map_err(|e| ApiError::Validation(e.to_string()))?;

        // Verify returned agentAddress matches
        if login_data.agent_address.to_lowercase() != self.agent_address.to_lowercase() {
            return Err(ApiError::Auth(format!(
                "Agent address mismatch: requested {}, got {}",
                self.agent_address, login_data.agent_address
            )));
        }

        // Store authentication state
        let expires_at = chrono::DateTime::parse_from_rfc3339(&login_data.expires_at)
            .map(|dt| dt.with_timezone(&Utc))
            .ok();

        auth.token = Some(login_data.token);
        auth.expires_at = expires_at;

        Ok(())
    }
}
