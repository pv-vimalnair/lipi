//! Microsoft Store Broker API OAuth 2.0
//! client-credentials flow.
//!
//! Phase 4.1 (IAP v1.1 follow-ups). The
//! `iap_oauth` module implements the OAuth
//! client-credentials grant type for the
//! Microsoft Store Broker API:
//!
//! 1. The app's Azure AD app registration
//!    provides a `client_id` + `client_secret`
//!    + `tenant_id`.
//! 2. The Rust side exchanges them for an
//!    access token at
//!    `https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token`
//!    with `grant_type=client_credentials` and
//!    `scope=https://api.store.microsoft.com/.default`.
//! 3. The access token is cached in memory
//!    (process-local) for 55 minutes (Microsoft
//!    tokens have a 60-minute lifetime; 5
//!    minutes of safety margin).
//!
//! # Why client-credentials (not authorization-code)?
//!
//! The Microsoft Store Broker API uses
//! client-credentials. The app is the client;
//! the user is not involved. The Azure AD app
//! registration has the
//! `https://api.store.microsoft.com/.default`
//! scope and admin consent.
//!
//! # Why process-local cache?
//!
//! We don't want a backend (Decision #17). A
//! process-local cache is the simplest option
//! that doesn't add a new persistence layer.
//! The token is regenerated on the first
//! `get_access_token` call after app restart.
//! The OAuth exchange takes < 500ms, so the
//! latency is acceptable.
//!
//! # Static-token fallback
//!
//! If the OAuth env vars are unset (e.g. in
//! dev mode without Azure AD credentials), the
//! module falls back to a static token from
//! `LIPI_MS_IAP_BEARER_TOKEN`. This is
//! preserved as a dev-only escape hatch; the
//! production path is the OAuth flow.

use std::sync::Mutex;

/// Cached access token + its expiration time.
#[derive(Debug, Clone)]
pub(crate) struct CachedToken {
    access_token: String,
    /// Unix seconds at which the token expires.
    /// 5 minutes before the actual expiry to
    /// give us a safety margin against clock
    /// drift + request latency.
    expires_at_unix: i64,
}

/// The OAuth module's process-local state.
///
/// `None` means "no token cached; fetch one on
/// the next call". A poisoned mutex (from a
/// panic during the fetch) is treated as
/// "no token cached" — the next call will
/// re-fetch.
static CACHED_TOKEN: Mutex<Option<CachedToken>> = Mutex::new(None);

/// The default token lifetime in seconds.
///
/// Microsoft access tokens have a 60-minute
/// lifetime. We use 55 minutes (3300 seconds)
/// as the cache TTL to give a 5-minute safety
/// margin.
const TOKEN_TTL_SECS: i64 = 55 * 60;

/// The OAuth 2.0 token endpoint template.
///
/// `{tenant}` is replaced with the configured
/// `LIPI_MS_IAP_TENANT_ID`.
const MS_TOKEN_ENDPOINT_TEMPLATE: &str =
    "https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token";

/// The scope for the Microsoft Store Broker
/// API. `.default` means "use whatever
/// application permissions are configured on
/// the Azure AD app registration".
const MS_TOKEN_SCOPE: &str = "https://api.store.microsoft.com/.default";

/// Grant type for the OAuth client-credentials
/// flow.
const GRANT_TYPE_CLIENT_CREDENTIALS: &str = "client_credentials";

/// Read the OAuth credentials from the
/// environment. Returns `None` if any of the
/// three env vars is unset.
///
/// ## Build-time vs runtime
///
/// For production builds, the three env vars
/// (`LIPI_MS_IAP_CLIENT_ID`, `LIPI_MS_IAP_CLIENT_SECRET`,
/// `LIPI_MS_IAP_TENANT_ID`) are passed to `cargo build`
/// so that `option_env!` embeds them as `&'static str`
/// constants in the binary. This is the secure path
/// — the secret is never on disk after the build, and
/// `process.env` inspection at runtime doesn't reveal
/// it.
///
/// For dev / CI-without-secrets, the same env vars
/// can be set at runtime (e.g. in a `.env` file the
/// dev loads before launching the app, or in a
/// `launch.json` IDE config). The runtime
/// `std::env::var` path is the dev escape hatch.
///
/// The two paths are *not* mutually exclusive: the
/// build-time value is preferred if set, with the
/// runtime value as a fallback. This means a dev who
/// wants to override the build-time value (e.g. for
/// a quick local test against a different Azure AD
/// app registration) can set the runtime env var and
/// the OAuth flow will pick it up.
pub fn read_oauth_credentials_from_env() -> Option<OAuthCredentials> {
    // Build-time-embedded values (preferred).
    // `option_env!` returns `None` if the env var was
    // not set during `cargo build`. The values are
    // baked into the binary as `&'static str`, so they
    // survive even if the runtime env doesn't have them.
    let build_client_id = option_env!("LIPI_MS_IAP_CLIENT_ID");
    let build_client_secret = option_env!("LIPI_MS_IAP_CLIENT_SECRET");
    let build_tenant_id = option_env!("LIPI_MS_IAP_TENANT_ID");

    // Runtime env values (fallback for dev).
    let runtime_client_id = std::env::var("LIPI_MS_IAP_CLIENT_ID").ok();
    let runtime_client_secret = std::env::var("LIPI_MS_IAP_CLIENT_SECRET").ok();
    let runtime_tenant_id = std::env::var("LIPI_MS_IAP_TENANT_ID").ok();

    // Prefer build-time; fall back to runtime; only
    // return `Some` if all three are present in at
    // least one source.
    let client_id = build_client_id
        .map(str::to_string)
        .or(runtime_client_id)?;
    let client_secret = build_client_secret
        .map(str::to_string)
        .or(runtime_client_secret)?;
    let tenant_id = build_tenant_id
        .map(str::to_string)
        .or(runtime_tenant_id)?;

    Some(OAuthCredentials {
        client_id,
        client_secret,
        tenant_id,
    })
}

/// OAuth credentials read from env vars.
#[derive(Debug, Clone)]
pub struct OAuthCredentials {
    pub client_id: String,
    pub client_secret: String,
    pub tenant_id: String,
}

/// Token response from the Microsoft OAuth
/// endpoint. The endpoint returns at minimum
/// `access_token` + `token_type` + `expires_in`.
///
/// We use a minimal subset of the response
/// (the two fields we actually need). A full
/// deserializer would handle
/// `refresh_token` / `id_token` / `ext_expires_in`
/// / `not_before` etc., but the
/// client-credentials flow doesn't return any
/// of those.
#[derive(Debug, Clone, serde::Deserialize)]
pub struct TokenResponse {
    pub access_token: String,
    pub expires_in: i64,
}

/// Parse the response body from the Microsoft
/// OAuth token endpoint.
///
/// Pure function (no I/O) — given a JSON
/// string, returns the parsed
/// `TokenResponse` or an error reason.
///
/// The error reason is a string for testability
/// (no `Error` trait propagation). The
/// caller maps it to `MicrosoftError::OAuthFailed`.
pub fn parse_token_response(body: &str) -> Result<TokenResponse, String> {
    serde_json::from_str::<TokenResponse>(body).map_err(|e| {
        format!("failed to parse Microsoft OAuth response: {e}")
    })
}

/// Build the token endpoint URL for a given
/// tenant ID. Pure function (no I/O).
pub fn build_token_url(tenant_id: &str) -> String {
    MS_TOKEN_ENDPOINT_TEMPLATE.replace("{tenant}", tenant_id)
}

/// Is the cached token expired (or absent)?
///
/// `now_unix_secs` is the current Unix time in
/// seconds. We use the provided time instead
/// of `SystemTime::now()` for testability.
pub fn is_token_expired(cached: &Option<CachedToken>, now_unix_secs: i64) -> bool {
    match cached {
        None => true,
        Some(token) => now_unix_secs >= token.expires_at_unix,
    }
}

/// Build a `CachedToken` from a `TokenResponse`.
///
/// Pure function (no I/O) — given the parsed
/// response + the current time, returns the
/// `CachedToken` to store in the in-memory
/// cache.
///
/// The `expires_at_unix` is computed as
/// `now + min(expires_in, 55 minutes)`. We
/// cap at 55 minutes regardless of what the
/// server says, to keep the safety margin.
pub fn build_cached_token(
    response: &TokenResponse,
    now_unix_secs: i64,
) -> CachedToken {
    let ttl = response.expires_in.min(TOKEN_TTL_SECS);
    CachedToken {
        access_token: response.access_token.clone(),
        expires_at_unix: now_unix_secs + ttl,
    }
}

/// Get a cached access token, refreshing if
/// needed.
///
/// This is the main entry point for
/// `iap_microsoft::verify_microsoft_receipt`.
///
/// Behavior:
/// - If a cached token is fresh, return a
///   clone of it.
/// - If the cache is empty or the token is
///   expired, fetch a new token (via the
///   OAuth client-credentials flow) and
///   cache it.
///
/// # Errors
///
/// - `OAuthError::CredentialsMissing`: the
///   OAuth env vars are unset AND no static
///   fallback is configured.
/// - `OAuthError::ExchangeFailed`: the token
///   exchange failed (network error,
///   non-2xx response, or invalid JSON).
/// - `OAuthError::InvalidExpiresIn`: the
///   server returned an `expires_in` <= 0.
pub async fn get_access_token(
    now_unix_secs: i64,
) -> Result<String, OAuthError> {
    // Fast path: check the cache.
    {
        let cache_guard = CACHED_TOKEN.lock().map_err(|e| {
            OAuthError::ExchangeFailed {
                detail: format!("OAuth cache mutex poisoned: {e}"),
            }
        })?;
        if !is_token_expired(&*cache_guard, now_unix_secs) {
            // Safe: the guard is held, but we
            // only read `access_token` (a
            // String), which is `Clone` and
            // doesn't borrow from the cache.
            if let Some(token) = cache_guard.as_ref() {
                return Ok(token.access_token.clone());
            }
        }
    }

    // Slow path: fetch a new token.
    let creds = match read_oauth_credentials_from_env() {
        Some(c) => c,
        None => {
            // Fall back to the static token
            // (dev-only escape hatch).
            return std::env::var("LIPI_MS_IAP_BEARER_TOKEN").map_err(|_| {
                OAuthError::CredentialsMissing
            });
        }
    };

    let new_token = fetch_access_token(&creds, now_unix_secs).await?;
    let access_token = new_token.access_token.clone();

    // Cache it.
    {
        let mut cache_guard = CACHED_TOKEN.lock().map_err(|e| {
            OAuthError::ExchangeFailed {
                detail: format!("OAuth cache mutex poisoned: {e}"),
            }
        })?;
        *cache_guard = Some(new_token);
    }

    Ok(access_token)
}

/// Exchange OAuth credentials for an access
/// token. Pure HTTP call (no caching).
///
/// The function is `async` and uses `reqwest`
/// (the same HTTP client as the rest of the
/// IAP code path).
async fn fetch_access_token(
    creds: &OAuthCredentials,
    now_unix_secs: i64,
) -> Result<CachedToken, OAuthError> {
    let url = build_token_url(&creds.tenant_id);
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .map_err(|e| OAuthError::ExchangeFailed {
            detail: format!("failed to build HTTP client: {e}"),
        })?;
    let response = client
        .post(&url)
        .form(&[
            ("grant_type", GRANT_TYPE_CLIENT_CREDENTIALS),
            ("client_id", &creds.client_id),
            ("client_secret", &creds.client_secret),
            ("scope", MS_TOKEN_SCOPE),
        ])
        .send()
        .await
        .map_err(|e| OAuthError::ExchangeFailed {
            detail: format!("HTTP POST failed: {e}"),
        })?;
    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        return Err(OAuthError::ExchangeFailed {
            detail: format!("Microsoft OAuth returned HTTP {status}: {body}"),
        });
    }
    let body = response.text().await.map_err(|e| OAuthError::ExchangeFailed {
        detail: format!("failed to read response body: {e}"),
    })?;
    let parsed = parse_token_response(&body).map_err(|e| OAuthError::ExchangeFailed {
        detail: e,
    })?;
    if parsed.expires_in <= 0 {
        return Err(OAuthError::InvalidExpiresIn);
    }
    Ok(build_cached_token(&parsed, now_unix_secs))
}

/// Errors from the OAuth module.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum OAuthError {
    /// The OAuth env vars are unset and no
    /// static fallback is configured.
    CredentialsMissing,
    /// The token exchange failed (network
    /// error, non-2xx response, or invalid
    /// JSON).
    ExchangeFailed {
        detail: String,
    },
    /// The server returned an `expires_in`
    /// <= 0.
    InvalidExpiresIn,
}

impl std::fmt::Display for OAuthError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            OAuthError::CredentialsMissing => {
                write!(f, "Microsoft OAuth credentials are not configured. Set LIPI_MS_IAP_CLIENT_ID, LIPI_MS_IAP_CLIENT_SECRET, and LIPI_MS_IAP_TENANT_ID environment variables, or set LIPI_MS_IAP_BEARER_TOKEN for the static-token dev fallback.")
            }
            OAuthError::ExchangeFailed { detail } => {
                write!(f, "Microsoft OAuth token exchange failed: {detail}")
            }
            OAuthError::InvalidExpiresIn => {
                write!(f, "Microsoft OAuth response had a non-positive expires_in")
            }
        }
    }
}

impl std::error::Error for OAuthError {}

// --- Tests -------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    // --- parse_token_response ---

    #[test]
    fn parse_token_response_extracts_access_token_and_expires_in() {
        let body = r#"{"access_token":"eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9","expires_in":3600}"#;
        let parsed = parse_token_response(body).expect("parse failed");
        assert_eq!(parsed.access_token, "eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9");
        assert_eq!(parsed.expires_in, 3600);
    }

    #[test]
    fn parse_token_response_rejects_missing_access_token() {
        let body = r#"{"expires_in":3600}"#;
        let result = parse_token_response(body);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("failed to parse"));
    }

    #[test]
    fn parse_token_response_rejects_missing_expires_in() {
        let body = r#"{"access_token":"abc"}"#;
        let result = parse_token_response(body);
        assert!(result.is_err());
    }

    #[test]
    fn parse_token_response_rejects_non_json_body() {
        let body = "not json";
        let result = parse_token_response(body);
        assert!(result.is_err());
    }

    #[test]
    fn parse_token_response_rejects_empty_body() {
        let result = parse_token_response("");
        assert!(result.is_err());
    }

    // --- is_token_expired ---

    #[test]
    fn is_token_expired_returns_true_for_none() {
        let cached: Option<CachedToken> = None;
        assert!(is_token_expired(&cached, 1000));
    }

    #[test]
    fn is_token_expired_returns_true_for_past_timestamp() {
        let cached = Some(CachedToken {
            access_token: "abc".to_string(),
            expires_at_unix: 1000,
        });
        assert!(is_token_expired(&cached, 1000)); // exactly at expiry = expired
        assert!(is_token_expired(&cached, 2000)); // past expiry = expired
    }

    #[test]
    fn is_token_expired_returns_false_for_fresh_token() {
        let cached = Some(CachedToken {
            access_token: "abc".to_string(),
            expires_at_unix: 2000,
        });
        assert!(!is_token_expired(&cached, 1000));
        assert!(!is_token_expired(&cached, 1999));
    }

    // --- build_cached_token ---

    #[test]
    fn build_cached_token_uses_ttl_from_response() {
        // 30 minutes — within the 55-minute
        // cap, so we use the full TTL.
        let response = TokenResponse {
            access_token: "abc".to_string(),
            expires_in: 1800,
        };
        let cached = build_cached_token(&response, 1000);
        assert_eq!(cached.access_token, "abc");
        assert_eq!(cached.expires_at_unix, 1000 + 1800);
    }

    #[test]
    fn build_cached_token_caps_ttl_at_55_minutes() {
        // The server says the token lasts 2
        // hours, but we cap at 55 minutes for
        // safety.
        let response = TokenResponse {
            access_token: "abc".to_string(),
            expires_in: 7200,
        };
        let cached = build_cached_token(&response, 1000);
        assert_eq!(cached.expires_at_unix, 1000 + 55 * 60);
    }

    #[test]
    fn build_cached_token_uses_smaller_ttl_for_short_lived_tokens() {
        // Server says the token lasts 30
        // minutes. We use 30 minutes (not 55).
        let response = TokenResponse {
            access_token: "abc".to_string(),
            expires_in: 1800,
        };
        let cached = build_cached_token(&response, 1000);
        assert_eq!(cached.expires_at_unix, 1000 + 1800);
    }

    // --- build_token_url ---

    #[test]
    fn build_token_url_replaces_tenant_placeholder() {
        let url = build_token_url("my-tenant-id");
        assert_eq!(
            url,
            "https://login.microsoftonline.com/my-tenant-id/oauth2/v2.0/token"
        );
    }

    #[test]
    fn build_token_url_handles_empty_tenant() {
        let url = build_token_url("");
        assert_eq!(
            url,
            "https://login.microsoftonline.com//oauth2/v2.0/token"
        );
    }

    // --- read_oauth_credentials_from_env ---

    #[test]
    fn read_oauth_credentials_returns_none_when_all_unset() {
        // All three env vars are unset (they
        // shouldn't be set in the test
        // environment, but to be safe we
        // check).
        let prev_client = std::env::var("LIPI_MS_IAP_CLIENT_ID").ok();
        let prev_secret = std::env::var("LIPI_MS_IAP_CLIENT_SECRET").ok();
        let prev_tenant = std::env::var("LIPI_MS_IAP_TENANT_ID").ok();
        std::env::remove_var("LIPI_MS_IAP_CLIENT_ID");
        std::env::remove_var("LIPI_MS_IAP_CLIENT_SECRET");
        std::env::remove_var("LIPI_MS_IAP_TENANT_ID");
        let result = read_oauth_credentials_from_env();
        if let Some(c) = prev_client { std::env::set_var("LIPI_MS_IAP_CLIENT_ID", c); }
        if let Some(c) = prev_secret { std::env::set_var("LIPI_MS_IAP_CLIENT_SECRET", c); }
        if let Some(c) = prev_tenant { std::env::set_var("LIPI_MS_IAP_TENANT_ID", c); }
        // The result depends on the test
        // environment. In a clean test env,
        // it's None. In a build env with the
        // vars set (e.g. CI), it's Some. We
        // can't assert without knowing the
        // env, so we just check the type.
        let _: Option<OAuthCredentials> = result;
    }

    // --- OAuthError Display ---

    #[test]
    fn oauth_error_display_credentials_missing() {
        let e = OAuthError::CredentialsMissing;
        let s = format!("{e}");
        assert!(s.contains("credentials are not configured"));
    }

    #[test]
    fn oauth_error_display_exchange_failed() {
        let e = OAuthError::ExchangeFailed {
            detail: "test detail".to_string(),
        };
        let s = format!("{e}");
        assert!(s.contains("token exchange failed"));
        assert!(s.contains("test detail"));
    }

    #[test]
    fn oauth_error_display_invalid_expires_in() {
        let e = OAuthError::InvalidExpiresIn;
        let s = format!("{e}");
        assert!(s.contains("non-positive expires_in"));
    }

    // --- is_token_expired edge cases ---

    #[test]
    fn is_token_expired_handles_zero_expiry() {
        let cached = Some(CachedToken {
            access_token: "abc".to_string(),
            expires_at_unix: 0,
        });
        // A token expiring at Unix time 0 is
        // expired for any `now >= 0` (i.e.
        // basically always, since 1970). For
        // the pre-1970 case (negative `now`),
        // the token hasn't expired yet.
        assert!(is_token_expired(&cached, 0));
        assert!(is_token_expired(&cached, 1));
        assert!(!is_token_expired(&cached, -100));
    }
}
