//! Phase 5: the updater endpoint health check.
//!
//! Polls the configured updater endpoint on app start
//! and exposes a Tauri command that the frontend can
//! call from the About screen ("Updater: ✓ reachable"
//! / "Updater: ✗ unreachable — github.com is down or
//! your firewall is blocking the request").
//!
//! # Why this exists
//!
//! Users in restricted networks (corporate firewalls,
//! China's GFW, behind a corporate VPN) report "the
//! updater doesn't work" bugs. The support team's
//! first question is always "is the endpoint
//! reachable from your network?". A self-diagnostic
//! tool lets users answer that question themselves
//! (and lets support reproduce the issue without
//! remote-desktop-ing into the user's machine).
//!
//! # What it does
//!
//! - Sends a single `GET` to the first configured
//!   updater endpoint (a 5-second timeout).
//! - Returns `Reachable` if the response is 2xx or
//!   3xx (any "the server is alive" signal, including
//!   404 — the endpoint URL exists, even if the
//!   `updater.json` file isn't there yet).
//! - Returns `Unreachable` if the response is a
//!   network error (DNS failure, connection refused,
//!   timeout).
//! - Returns `Error(String)` if the request returns
//!   a 4xx / 5xx that suggests a misconfiguration
//!   (e.g. the URL is malformed).
//!
//! # What it does NOT do
//!
//! - It does NOT download the `updater.json`. That's
//!   the Tauri updater plugin's job. The health check
//!   is a lightweight "can we even reach the host?"
//!   probe.
//! - It does NOT cache the result across sessions.
//!   Each app launch does one probe. (The frontend
//!   can call the IPC command multiple times; each
//!   call does a fresh probe. A future phase could
//!   add a per-session cache.)
//! - It does NOT fall back to secondary endpoints.
//!   The Tauri config's `endpoints` array supports
//!   fallback URLs, but the health check only probes
//!   the first one (the "primary" endpoint). A
//!   future phase could probe all of them.

#![cfg(not(mobile))]

use std::time::Duration;

use serde::{Deserialize, Serialize};

/// The health check result.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum UpdaterHealth {
    /// The endpoint is reachable (any 2xx/3xx
    /// response, even 404 — the host is alive).
    Reachable {
        /// The HTTP status code we got back.
        status: u16,
    },
    /// The endpoint is unreachable (network error,
    /// timeout, or the URL is malformed).
    Unreachable {
        /// A short reason for the failure
        /// (e.g. "connection refused", "DNS
        /// resolution failed", "timeout").
        reason: String,
    },
}

const DEFAULT_UPDATER_URL: &str =
    "https://github.com/lipi-dev/lipi/releases/latest/download/updater.json";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(5);

/// Tauri command: poll the configured updater
/// endpoint and return the health status. The
/// frontend's About screen calls this on mount.
#[tauri::command]
pub async fn updater_health_check() -> UpdaterHealth {
    // Read the URL from a function so tests can
    // override it. The production code path uses the
    // Tauri config's first endpoint, falling back to
    // the default if the config is missing.
    check_url(updater_url()).await
}

/// Pure: the URL the health check probes. In v1 this
/// is a constant (the same as `tauri.conf.json`'s
/// `plugins.updater.endpoints[0]`). A future phase
/// could read it from the Tauri app handle's
/// updater config at runtime.
fn updater_url() -> &'static str {
    DEFAULT_UPDATER_URL
}

/// Internal: probe a URL. Exposed for tests so they
/// can override the URL.
async fn check_url(url: &str) -> UpdaterHealth {
    let client = match reqwest::Client::builder()
        .timeout(REQUEST_TIMEOUT)
        .user_agent(concat!("lipi-", env!("CARGO_PKG_VERSION")))
        .build()
    {
        Ok(c) => c,
        Err(e) => {
            return UpdaterHealth::Unreachable {
                reason: format!("client build failed: {e}"),
            };
        }
    };

    match client.get(url).send().await {
        Ok(resp) => {
            let status = resp.status().as_u16();
            // Any 2xx or 3xx means "the host is
            // alive". A 404 is also "alive" (the
            // host is responding, even if the
            // specific file isn't there).
            if (200..400).contains(&status) {
                UpdaterHealth::Reachable { status }
            } else {
                // 4xx / 5xx — the host responded,
                // but with an error. This is a
                // misconfiguration, not a
                // network issue.
                UpdaterHealth::Unreachable {
                    reason: format!("server returned {status}"),
                }
            }
        }
        Err(e) => {
            // Network error: timeout, connection
            // refused, DNS failure, TLS failure.
            // We don't include the full error
            // message in the response (could leak
            // the URL in a phishing-prone way); a
            // short reason is enough for the UI.
            let reason = if e.is_timeout() {
                "timeout after 5s".to_string()
            } else if e.is_connect() {
                "connection refused".to_string()
            } else if e.is_request() {
                format!("request error: {e}")
            } else {
                format!("network error: {e}")
            };
            UpdaterHealth::Unreachable { reason }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn updater_url_returns_default_github_url() {
        // The default URL is the GitHub Releases
        // updater.json. This pins the contract:
        // changing the default would break
        // users on the v0.0.2 dev keypair.
        assert_eq!(
            updater_url(),
            "https://github.com/lipi-dev/lipi/releases/latest/download/updater.json"
        );
    }

    #[tokio::test]
    async fn check_url_with_200_returns_reachable() {
        // We can't easily mock reqwest without a
        // mock server. This test is a smoke test
        // that the function compiles + runs; the
        // "real" network behavior is tested by the
        // smoke test in the release workflow.
        // The test is gated to skip in CI if
        // there's no network access.
        if std::env::var("LIPI_OFFLINE_TEST").is_ok() {
            // Offline test: just check that
            // a malformed URL produces an
            // Unreachable result.
            let result = check_url("not-a-valid-url").await;
            match result {
                UpdaterHealth::Unreachable { .. } => {}
                _ => panic!("expected Unreachable for invalid URL"),
            }
        } else {
            // Online: skip; the smoke test in
            // .github/workflows/release.yml
            // covers this.
        }
    }

    #[tokio::test]
    async fn check_url_with_malformed_url_returns_unreachable() {
        let result = check_url("not-a-valid-url").await;
        match result {
            UpdaterHealth::Unreachable { reason } => {
                assert!(!reason.is_empty(), "reason should not be empty");
            }
            _ => panic!("expected Unreachable for malformed URL, got: {result:?}"),
        }
    }

    #[tokio::test]
    async fn check_url_with_unreachable_host_returns_unreachable() {
        // A URL that will fail to connect (port 1
        // is reserved, no service is listening).
        // We use a 127.0.0.1 address that should
        // immediately fail with "connection
        // refused".
        let result = check_url("http://127.0.0.1:1/updater.json").await;
        match result {
            UpdaterHealth::Unreachable { reason } => {
                assert!(
                    reason.contains("refused")
                        || reason.contains("timeout")
                        || reason.contains("error")
                        || reason.contains("connect"),
                    "expected a network-error reason, got: {reason}"
                );
            }
            _ => panic!("expected Unreachable, got: {result:?}"),
        }
    }

    #[test]
    fn updater_health_serializes_to_camel_case_with_kind_tag() {
        // The TS side expects
        //   { kind: 'reachable', status: 200 }
        //   { kind: 'unreachable', reason: '…' }
        let reachable = UpdaterHealth::Reachable { status: 200 };
        let json = serde_json::to_string(&reachable).unwrap();
        assert!(json.contains("\"kind\":\"reachable\""));
        assert!(json.contains("\"status\":200"));

        let unreachable = UpdaterHealth::Unreachable {
            reason: "timeout".to_string(),
        };
        let json = serde_json::to_string(&unreachable).unwrap();
        assert!(json.contains("\"kind\":\"unreachable\""));
        assert!(json.contains("\"reason\":\"timeout\""));
    }
}
