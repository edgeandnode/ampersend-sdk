use ampersend_sdk::mcp::proxy::validate_target_url;

#[cfg(test)]
mod url_validation {
    use super::*;

    mod valid_urls {
        use super::*;

        #[test]
        fn accepts_http_urls() {
            let url = validate_target_url("http://localhost:8080/mcp").unwrap();
            assert_eq!(url.as_str(), "http://localhost:8080/mcp");
        }

        #[test]
        fn accepts_https_urls() {
            let url = validate_target_url("https://api.example.com/mcp").unwrap();
            assert_eq!(url.as_str(), "https://api.example.com/mcp");
        }

        #[test]
        fn accepts_private_ips_192() {
            let url = validate_target_url("http://192.168.1.10:8080").unwrap();
            assert!(url.as_str().contains("192.168.1.10"));
        }

        #[test]
        fn accepts_private_ips_10() {
            let url = validate_target_url("http://10.0.0.1:8080").unwrap();
            assert!(url.as_str().contains("10.0.0.1"));
        }

        #[test]
        fn accepts_private_ips_172() {
            let url = validate_target_url("http://172.16.0.1:8080").unwrap();
            assert!(url.as_str().contains("172.16.0.1"));
        }

        #[test]
        fn accepts_localhost() {
            let url = validate_target_url("http://localhost:3000").unwrap();
            assert!(url.as_str().contains("localhost"));
        }

        #[test]
        fn accepts_loopback() {
            let url = validate_target_url("http://127.0.0.1:8080").unwrap();
            assert!(url.as_str().contains("127.0.0.1"));
        }

        #[test]
        fn accepts_public_domains() {
            let url = validate_target_url("https://mcp-server.example.com/api/mcp").unwrap();
            assert_eq!(url.as_str(), "https://mcp-server.example.com/api/mcp");
        }

        #[test]
        fn accepts_urls_with_query_params() {
            let url = validate_target_url("http://localhost:8080/mcp?foo=bar").unwrap();
            assert!(url.as_str().contains("foo=bar"));
        }

        #[test]
        fn accepts_urls_with_ports() {
            let url = validate_target_url("http://example.com:9090/mcp").unwrap();
            assert!(url.as_str().contains("9090"));
        }
    }

    mod invalid_urls {
        use super::*;

        #[test]
        fn rejects_malformed_urls() {
            assert!(validate_target_url("not a url").is_err());
        }

        #[test]
        fn rejects_empty_strings() {
            assert!(validate_target_url("").is_err());
        }

        #[test]
        fn rejects_urls_without_protocol() {
            assert!(validate_target_url("example.com/mcp").is_err());
        }

        #[test]
        fn rejects_file_protocol() {
            let err = validate_target_url("file:///etc/passwd").unwrap_err();
            let msg = err.to_string();
            assert!(
                msg.contains("Protocol")
                    || msg.contains("not supported")
                    || msg.contains("allowed"),
                "unexpected error message: {msg}"
            );
        }

        #[test]
        fn rejects_ftp_protocol() {
            assert!(validate_target_url("ftp://example.com").is_err());
        }

        #[test]
        fn rejects_custom_protocols() {
            assert!(validate_target_url("custom://something").is_err());
        }
    }
}
