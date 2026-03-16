use ampersend_sdk::mcp::proxy::env::parse_env_config;

#[cfg(test)]
mod proxy_env {
    use super::*;

    #[test]
    fn parses_empty_config() {
        // Use a unique prefix to avoid collisions with actual env
        let config = parse_env_config("__TEST_EMPTY__").unwrap();
        assert!(config.port.is_none());
        assert!(config.buyer_private_key.is_none());
        assert!(config.buyer_smart_account_address.is_none());
    }

    #[test]
    fn rejects_both_eoa_and_smart_account() {
        // Set conflicting env vars
        std::env::set_var("__TEST_BOTH__BUYER_PRIVATE_KEY", "0xabc");
        std::env::set_var(
            "__TEST_BOTH__BUYER_SMART_ACCOUNT_ADDRESS",
            "0x1111111111111111111111111111111111111111",
        );

        let result = parse_env_config("__TEST_BOTH__");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Cannot provide both"));

        // Clean up
        std::env::remove_var("__TEST_BOTH__BUYER_PRIVATE_KEY");
        std::env::remove_var("__TEST_BOTH__BUYER_SMART_ACCOUNT_ADDRESS");
    }

    #[test]
    fn rejects_smart_account_without_key() {
        std::env::set_var(
            "__TEST_NOKEY__BUYER_SMART_ACCOUNT_ADDRESS",
            "0x1111111111111111111111111111111111111111",
        );

        let result = parse_env_config("__TEST_NOKEY__");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("KEY_PRIVATE_KEY is required"));

        // Clean up
        std::env::remove_var("__TEST_NOKEY__BUYER_SMART_ACCOUNT_ADDRESS");
    }

    #[test]
    fn parses_eoa_config() {
        std::env::set_var("__TEST_EOA__BUYER_PRIVATE_KEY", "0xdeadbeef");
        std::env::set_var("__TEST_EOA__PORT", "9999");

        let config = parse_env_config("__TEST_EOA__").unwrap();
        assert_eq!(config.buyer_private_key.as_deref(), Some("0xdeadbeef"));
        assert_eq!(config.port, Some(9999));
        assert!(config.buyer_smart_account_address.is_none());

        // Clean up
        std::env::remove_var("__TEST_EOA__BUYER_PRIVATE_KEY");
        std::env::remove_var("__TEST_EOA__PORT");
    }

    #[test]
    fn parses_smart_account_config() {
        std::env::set_var(
            "__TEST_SA__BUYER_SMART_ACCOUNT_ADDRESS",
            "0x1111111111111111111111111111111111111111",
        );
        std::env::set_var("__TEST_SA__BUYER_SMART_ACCOUNT_KEY_PRIVATE_KEY", "0xabcdef");
        std::env::set_var("__TEST_SA__BUYER_SMART_ACCOUNT_CHAIN_ID", "84532");
        std::env::set_var("__TEST_SA__AMPERSEND_API_URL", "https://api.test.com");

        let config = parse_env_config("__TEST_SA__").unwrap();
        assert_eq!(
            config.buyer_smart_account_address.as_deref(),
            Some("0x1111111111111111111111111111111111111111")
        );
        assert_eq!(
            config.buyer_smart_account_key_private_key.as_deref(),
            Some("0xabcdef")
        );
        assert_eq!(config.buyer_smart_account_chain_id, Some(84532));
        assert_eq!(
            config.ampersend_api_url.as_deref(),
            Some("https://api.test.com")
        );

        // Clean up
        std::env::remove_var("__TEST_SA__BUYER_SMART_ACCOUNT_ADDRESS");
        std::env::remove_var("__TEST_SA__BUYER_SMART_ACCOUNT_KEY_PRIVATE_KEY");
        std::env::remove_var("__TEST_SA__BUYER_SMART_ACCOUNT_CHAIN_ID");
        std::env::remove_var("__TEST_SA__AMPERSEND_API_URL");
    }
}
