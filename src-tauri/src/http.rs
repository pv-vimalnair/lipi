//! Phase 5c — `http_request` IPC.
//!
//! The second of the two custom-tool "kinds":
//! `http`. The JS `toolRegistry` calls this
//! for any `kind: "http"` custom tool.
//!
//! ## Why Rust, not the browser's `fetch`?
//!
//! Tauri's webview sandbox doesn't allow
//! arbitrary `fetch` (CORS, mixed-content,
//! arbitrary headers like `Authorization`).
//! Going through Rust `reqwest` gives us
//! full control over the request: any URL,
//! any headers, any method, any body. The
//! security model stays in Rust where the
//! user can audit it.
//!
//! ## Why no built-in auth / secrets store?
//!
//! Custom tools are user-defined and the
//! `lipi-tools.json` file lives next to the
//! workspace. A user who wants to call
//! `https://api.example.com/v1/issues/{key}`
//! with a bearer token can put the token in
//! the file directly. This is the same trust
//! model as GitHub Actions workflows
//! (`.github/workflows/*.yml`). 5d+ may
//! surface a "secrets" tab; for now the
//! file IS the secret store.
//!
//! ## What's *not* here
//!
//! - Streaming tool results. 5c returns one
//!   bounded body string to the AI model.
//!   Rust may stream the network response
//!   internally to enforce that bound, but
//!   it does not emit partial `ai://chunk`
//!   events mid-tool.
//! - Multipart uploads or cookies. Redirects
//!   are not followed automatically because a
//!   public allowlisted host can redirect to a
//!   private network address.
//! - Connect-time DNS pinning. We preflight-check
//!   the requested host, literal IPs, and resolved
//!   addresses before sending; a future hardening
//!   pass can pin the actual socket address to fully
//!   close DNS rebinding races.

use std::collections::HashMap;
use std::net::IpAddr;
use std::time::Duration;

use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
use reqwest::{Client, Method, Response};
use serde::{Deserialize, Serialize};
use thiserror::Error;

/// Default per-request timeout. 5c MVP value.
pub const DEFAULT_TIMEOUT: Duration = Duration::from_secs(30);

/// Cap on the response body size we
/// materialise into a `String`. 1 MiB is
/// enough for typical JSON APIs (Slack,
/// Jira, GitHub, etc.); anything larger is
/// almost certainly the wrong tool. We
/// *truncate* (with a marker) rather than
/// erroring out, so the model still gets
/// something useful.
pub const MAX_BODY_BYTES_DEFAULT: usize = 1024 * 1024;
const TRUNCATED_MARKER: &str = "\n<truncated>";

/// Public error type. Serialised to JS as
/// `{kind: <discriminator>, message: <string>}`.
#[derive(Debug, Error, Serialize)]
#[serde(tag = "kind", content = "message")]
pub enum HttpRequestError {
    /// The URL is empty, malformed, or uses
    /// a scheme we don't support (we only
    /// allow `http://` and `https://` in 5c).
    #[error("invalid URL `{url}`: {detail}")]
    InvalidUrl { url: String, detail: String },
    /// A header name is invalid (reqwest
    /// requires valid token characters).
    #[error("invalid header name `{name}`: {detail}")]
    InvalidHeaderName { name: String, detail: String },
    /// A header value is invalid (e.g. it
    /// contains a NUL byte or is not valid
    /// UTF-8-like ASCII per RFC 7230).
    #[error("invalid header value for `{name}`: {detail}")]
    InvalidHeaderValue { name: String, detail: String },
    /// reqwest's transport-level error
    /// (DNS, TCP, TLS). 5c treats this as a
    /// transport error; the model can react
    /// with "I can't reach the API" advice.
    #[error("network error: {detail}")]
    Network { detail: String },
    /// The request was sent but the server
    /// returned a non-2xx status. We still
    /// include the body (truncated) so the
    /// model can see the error payload.
    #[error("HTTP {status}: status was non-2xx")]
    Non2xx { status: u16, body: String },
    /// The request did not finish in time.
    #[error("HTTP request timed out after {seconds}s")]
    Timeout { seconds: u64 },
}

/// The public response shape. Returned on
/// the happy path (2xx) and also on
/// `Non2xx` (with the body inline).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpRequestResult {
    /// HTTP status (e.g. 200, 404). Always
    /// populated, even on the error path.
    pub status: u16,
    /// Headers as a flat `Vec<(name, value)>`
    /// (HashMap doesn't serialise
    /// deterministically). We only include
    /// the FIRST 50 to keep the payload
    /// bounded.
    pub headers: Vec<(String, String)>,
    /// Truncated response body (UTF-8 lossy
    /// if the server lied about charset).
    pub body: String,
}

/// Args for `http_request`. The JS
/// `toolRegistry` builds this from a custom
/// tool's `url` template + the model's
/// substituted args.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpRequestArgs {
    /// URL with optional `{arg}` placeholders
    /// already substituted by the JS side.
    /// Must be a valid absolute `http://` or
    /// `https://` URL. (We don't support
    /// `file://`, `data:`, etc. — 5c is an
    /// internet fetcher.)
    pub url: String,
    /// Method. Defaults to `"GET"` if not
    /// set. 5c supports any method
    /// reqwest does (`GET`, `POST`, `PUT`,
    /// `PATCH`, `DELETE`, `HEAD`, `OPTIONS`).
    #[serde(default)]
    pub method: Option<String>,
    /// Headers. Empty map = no extra
    /// headers. The `Content-Type` header
    /// is *not* auto-set; if the user wants
    /// `application/json` they should set
    /// it explicitly.
    #[serde(default)]
    pub headers: HashMap<String, String>,
    /// Request body (raw string). Empty
    /// string = no body. The user is
    /// responsible for serialising JSON or
    /// other formats themselves; 5c is a
    /// dumb pipe.
    #[serde(default)]
    pub body: String,
    /// Per-call timeout. 5c MVP always
    /// passes `DEFAULT_TIMEOUT` from the JS
    /// side; the field exists for 5d+
    /// per-tool overrides.
    #[serde(default)]
    pub timeout_secs: Option<u64>,
    /// Per-call response-body cap. Same
    /// 5d+ reason as `timeout_secs`.
    #[serde(default)]
    pub max_body_bytes: Option<usize>,
    /// Per-tool host allowlist. The JS custom-tool executor
    /// derives this from a static URL-template host, or the
    /// user can set it explicitly for placeholder-based hosts.
    #[serde(default)]
    pub allowed_hosts: Vec<String>,
    /// Explicit opt-in for localhost, private, link-local,
    /// and metadata-address targets. Default false.
    #[serde(default)]
    pub allow_private_network: bool,
}

/// 5c: the public, testable implementation.
/// Takes the args and a pre-built reqwest
/// `Client` so tests can pass a client with
/// a custom base URL (we don't have a
/// real public server in CI to hit).
pub async fn http_request_impl(
    client: Client,
    args: HttpRequestArgs,
    timeout: Duration,
    max_body_bytes: usize,
) -> Result<HttpRequestResult, HttpRequestError> {
    // 1. Validate URL.
    if args.url.is_empty() {
        return Err(HttpRequestError::InvalidUrl {
            url: args.url,
            detail: "URL is empty".to_string(),
        });
    }
    let parsed = url::Url::parse(&args.url).map_err(|e| HttpRequestError::InvalidUrl {
        url: args.url.clone(),
        detail: e.to_string(),
    })?;
    let scheme = parsed.scheme();
    if scheme != "http" && scheme != "https" {
        return Err(HttpRequestError::InvalidUrl {
            url: args.url.clone(),
            detail: format!("unsupported scheme `{scheme}`; only `http`/`https` allowed in 5c"),
        });
    }
    // 2. Validate method.
    let method_str = args.method.as_deref().unwrap_or("GET");
    let method =
        Method::from_bytes(method_str.as_bytes()).map_err(|e| HttpRequestError::InvalidUrl {
            url: args.url.clone(),
            detail: format!("invalid method `{method_str}`: {e}"),
        })?;

    // 3. Build headers.
    let mut header_map = HeaderMap::new();
    for (name, value) in &args.headers {
        let header_name = HeaderName::try_from(name.as_str()).map_err(|e| {
            HttpRequestError::InvalidHeaderName {
                name: name.clone(),
                detail: e.to_string(),
            }
        })?;
        let header_value =
            HeaderValue::from_str(value).map_err(|e| HttpRequestError::InvalidHeaderValue {
                name: name.clone(),
                detail: e.to_string(),
            })?;
        header_map.insert(header_name, header_value);
    }

    validate_url_host_policy(&parsed, &args).await?;

    // 4. Build request.
    let mut request = client.request(method, parsed).headers(header_map);
    if !args.body.is_empty() {
        request = request.body(args.body);
    }

    // 5. Send with timeout. We do this by
    //    wrapping the entire future — reqwest
    //    doesn't have a per-request timeout
    //    setting we can override in 0.12
    //    without re-building the Client, and
    //    `tokio::time::timeout` is the
    //    standard pattern.
    let send_fut = request.send();
    let response = match tokio::time::timeout(timeout, send_fut).await {
        Ok(res) => res.map_err(|e| HttpRequestError::Network {
            detail: e.to_string(),
        })?,
        Err(_) => {
            return Err(HttpRequestError::Timeout {
                seconds: timeout.as_secs(),
            });
        }
    };

    // 6. Extract headers BEFORE reading the
    //    body. `read_body_truncated` consumes
    //    the response stream, so we
    //    have to capture the headers first.
    //    We cap the count at 50 to keep the
    //    payload bounded.
    let status = response.status();
    let headers: Vec<(String, String)> = response
        .headers()
        .iter()
        .take(50)
        .map(|(n, v)| (n.as_str().to_string(), v.to_str().unwrap_or("").to_string()))
        .collect();

    // 7. Read the body (truncated).
    let body = read_body_truncated(response, max_body_bytes).await;

    // 8. Categorise.
    if !status.is_success() {
        return Err(HttpRequestError::Non2xx {
            status: status.as_u16(),
            body,
        });
    }

    // 9. Happy path: build the result.
    Ok(HttpRequestResult {
        status: status.as_u16(),
        headers,
        body,
    })
}

async fn validate_url_host_policy(
    parsed: &url::Url,
    args: &HttpRequestArgs,
) -> Result<(), HttpRequestError> {
    // Clone once — every error path below needs the URL string.
    let url = args.url.clone();

    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err(HttpRequestError::InvalidUrl {
            url,
            detail: "credentials in HTTP tool URLs are not allowed".to_string(),
        });
    }

    let host = parsed
        .host_str()
        .ok_or_else(|| HttpRequestError::InvalidUrl {
            url: url.clone(),
            detail: "URL must include a host".to_string(),
        })?;

    if !host_is_allowed(host, &args.allowed_hosts) {
        return Err(HttpRequestError::InvalidUrl {
            url,
            detail: format!("host `{host}` is not in this tool's allowedHosts list"),
        });
    }

    if !args.allow_private_network {
        if host_is_local_name(host) {
            return Err(HttpRequestError::InvalidUrl {
                url,
                detail: format!(
                    "host `{host}` is local/private; set allowPrivateNetwork for this tool to opt in"
                ),
            });
        }
        if let Ok(ip) = host.parse::<IpAddr>() {
            if ip_is_private_or_local(ip) {
                return Err(HttpRequestError::InvalidUrl {
                    url,
                    detail: format!(
                        "address `{ip}` is local/private; set allowPrivateNetwork for this tool to opt in"
                    ),
                });
            }
        } else {
            let port = parsed.port_or_known_default().unwrap_or(80);
            let resolved = tokio::net::lookup_host((host, port)).await.map_err(|e| {
                HttpRequestError::Network {
                    detail: format!("failed to resolve `{host}`: {e}"),
                }
            })?;
            for socket in resolved {
                let ip = socket.ip();
                if ip_is_private_or_local(ip) {
                    return Err(HttpRequestError::InvalidUrl {
                        url,
                        detail: format!(
                            "host `{host}` resolved to local/private address `{ip}`; set allowPrivateNetwork for this tool to opt in"
                        ),
                    });
                }
            }
        }
    }

    Ok(())
}

fn host_is_allowed(host: &str, allowed_hosts: &[String]) -> bool {
    let host = host.trim_end_matches('.').to_ascii_lowercase();
    allowed_hosts.iter().any(|allowed| {
        let allowed = allowed.trim().trim_end_matches('.').to_ascii_lowercase();
        if allowed.is_empty() {
            return false;
        }
        if let Some(suffix) = allowed.strip_prefix("*.") {
            return host.ends_with(&format!(".{suffix}"));
        }
        host == allowed
    })
}

fn host_is_local_name(host: &str) -> bool {
    let host = host.trim_end_matches('.').to_ascii_lowercase();
    host == "localhost" || host.ends_with(".localhost")
}

fn ip_is_private_or_local(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => {
            let octets = ip.octets();
            ip.is_private()
                || ip.is_loopback()
                || ip.is_link_local()
                || ip.is_broadcast()
                || ip.is_documentation()
                || octets[0] == 0
                || (octets[0] == 100 && (64..=127).contains(&octets[1]))
                || (octets[0] == 169 && octets[1] == 254)
        }
        IpAddr::V6(ip) => {
            if let Some(mapped_v4) = ip.to_ipv4_mapped() {
                return ip_is_private_or_local(IpAddr::V4(mapped_v4));
            }
            let segments = ip.segments();
            ip.is_loopback()
                || ip.is_unspecified()
                || ip.is_unique_local()
                || ip.is_unicast_link_local()
                || (segments[0] == 0x2001 && segments[1] == 0x0db8)
        }
    }
}

/// Stream the response body into a bounded
/// buffer and stop reading as soon as
/// `max_body_bytes` is reached.
async fn read_body_truncated(mut response: Response, max_body_bytes: usize) -> String {
    let mut bytes = Vec::with_capacity(max_body_bytes.min(8 * 1024));
    let mut truncated = false;

    loop {
        match response.chunk().await {
            Ok(Some(chunk)) => {
                let remaining = max_body_bytes.saturating_sub(bytes.len());
                if chunk.len() > remaining {
                    bytes.extend_from_slice(&chunk[..remaining]);
                    truncated = true;
                    break;
                }
                bytes.extend_from_slice(&chunk);
            }
            Ok(None) => break,
            Err(_) => return String::new(),
        }
    }

    let mut s = String::from_utf8_lossy(&bytes).into_owned();
    if truncated {
        s.push_str(TRUNCATED_MARKER);
    }
    s
}

/// 5c: public entry point called by the
/// `#[tauri::command]` wrapper in `lib.rs`.
/// The JS `toolRegistry` invokes this via
/// `invoke('http_request', …)`.
pub async fn http_request(args: HttpRequestArgs) -> Result<HttpRequestResult, HttpRequestError> {
    // Build a fresh client per call. 5c
    // MVP doesn't pool clients (the
    // reqwest client is cheap to build
    // and the user typically makes one
    // HTTP tool call per turn). A 5d+
    // enhancement can use a shared,
    // long-lived `Client` managed by
    // Tauri state.
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| HttpRequestError::Network {
            detail: e.to_string(),
        })?;
    let timeout = args
        .timeout_secs
        .map(Duration::from_secs)
        .unwrap_or(DEFAULT_TIMEOUT);
    let max_body_bytes = args.max_body_bytes.unwrap_or(MAX_BODY_BYTES_DEFAULT);
    http_request_impl(client, args, timeout, max_body_bytes).await
}

// --- Tests ------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    /// Build a `reqwest::Response` from a
    /// known status + body. Useful for
    /// unit-testing `read_body_truncated`
    /// without spinning up a server.
    fn synthetic_response(status: u16, body: &[&str]) -> Response {
        let mut builder = http::Response::builder().status(status);
        builder = builder.header("Content-Type", "text/plain");
        let joined = body.join("");
        let http_response = builder.body(joined.into_bytes()).unwrap();
        Response::from(http_response)
    }

    fn args_for_url(url: &str) -> HttpRequestArgs {
        let allowed_host = url::Url::parse(url)
            .ok()
            .and_then(|u| u.host_str().map(|h| h.to_string()))
            .unwrap_or_else(|| "example.com".to_string());
        HttpRequestArgs {
            url: url.to_string(),
            method: None,
            headers: HashMap::new(),
            body: String::new(),
            timeout_secs: None,
            max_body_bytes: None,
            allowed_hosts: vec![allowed_host],
            allow_private_network: false,
        }
    }

    #[tokio::test]
    async fn read_body_truncated_handles_short_body() {
        let response = synthetic_response(200, &["hello world"]);
        let s = read_body_truncated(response, 1024).await;
        assert_eq!(s, "hello world");
    }

    #[tokio::test]
    async fn read_body_truncated_marks_with_truncated_tag() {
        // 4 KiB body, 1 KiB cap.
        let body = "x".repeat(4096);
        let response = synthetic_response(200, &[&body]);
        let s = read_body_truncated(response, 1024).await;
        assert!(s.ends_with("<truncated>"), "tail: {:?}", &s[s.len() - 20..]);
        // Body length <= cap + marker length + some slack.
        assert!(s.len() <= 1024 + "<truncated>".len() + 8);
    }

    #[tokio::test]
    async fn read_body_truncated_drops_bytes_beyond_cap() {
        let body = format!("{}TAIL_SHOULD_NOT_SURVIVE", "a".repeat(4096));
        let response = synthetic_response(200, &[&body]);
        let s = read_body_truncated(response, 128).await;
        assert!(s.ends_with(TRUNCATED_MARKER));
        assert!(!s.contains("TAIL_SHOULD_NOT_SURVIVE"));
        assert!(s.len() <= 128 + TRUNCATED_MARKER.len());
    }

    #[tokio::test]
    async fn read_body_truncated_zero_cap_returns_only_marker_for_non_empty_body() {
        let response = synthetic_response(200, &["hello"]);
        let s = read_body_truncated(response, 0).await;
        assert_eq!(s, TRUNCATED_MARKER);
    }

    #[tokio::test]
    async fn read_body_truncated_handles_empty_body() {
        let response = synthetic_response(204, &[""]);
        let s = read_body_truncated(response, 1024).await;
        assert_eq!(s, "");
    }

    #[test]
    fn invalid_url_returns_invalid_url_error() {
        // We need an async runtime to call
        // http_request_impl; `tokio::test`
        // does that. The validation is sync
        // (no network) so we can also do
        // it in a non-async test by calling
        // url::Url::parse directly. The
        // function returns the error via
        // a future, so we still need an
        // async context.
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        let result = rt.block_on(async {
            let client = reqwest::Client::new();
            let args = HttpRequestArgs {
                url: "not a url".to_string(),
                method: None,
                headers: HashMap::new(),
                body: String::new(),
                timeout_secs: None,
                max_body_bytes: None,
                allowed_hosts: vec!["example.com".to_string()],
                allow_private_network: false,
            };
            http_request_impl(client, args, DEFAULT_TIMEOUT, MAX_BODY_BYTES_DEFAULT).await
        });
        assert!(matches!(result, Err(HttpRequestError::InvalidUrl { .. })));
    }

    #[test]
    fn unsupported_scheme_returns_invalid_url_error() {
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        let result = rt.block_on(async {
            let client = reqwest::Client::new();
            let args = HttpRequestArgs {
                url: "file:///etc/passwd".to_string(),
                method: None,
                headers: HashMap::new(),
                body: String::new(),
                timeout_secs: None,
                max_body_bytes: None,
                allowed_hosts: vec!["example.com".to_string()],
                allow_private_network: false,
            };
            http_request_impl(client, args, DEFAULT_TIMEOUT, MAX_BODY_BYTES_DEFAULT).await
        });
        match result {
            Err(HttpRequestError::InvalidUrl { url, detail }) => {
                assert_eq!(url, "file:///etc/passwd");
                assert!(detail.contains("unsupported scheme"));
            }
            other => panic!("expected InvalidUrl, got {other:?}"),
        }
    }

    #[test]
    fn invalid_header_name_returns_invalid_header_name_error() {
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        let result = rt.block_on(async {
            let client = reqwest::Client::new();
            let mut headers = HashMap::new();
            // Header names with non-token
            // characters are invalid.
            headers.insert("bad name with space".to_string(), "value".to_string());
            let args = HttpRequestArgs {
                url: "https://example.com".to_string(),
                method: None,
                headers,
                body: String::new(),
                timeout_secs: None,
                max_body_bytes: None,
                allowed_hosts: vec!["example.com".to_string()],
                allow_private_network: false,
            };
            http_request_impl(client, args, DEFAULT_TIMEOUT, MAX_BODY_BYTES_DEFAULT).await
        });
        assert!(matches!(
            result,
            Err(HttpRequestError::InvalidHeaderName { .. })
        ));
    }

    #[test]
    fn host_allowlist_requires_exact_or_wildcard_match() {
        assert!(host_is_allowed(
            "api.example.com",
            &["api.example.com".to_string()]
        ));
        assert!(host_is_allowed(
            "api.example.com",
            &["*.example.com".to_string()]
        ));
        assert!(!host_is_allowed(
            "evil-example.com",
            &["*.example.com".to_string()]
        ));
        assert!(!host_is_allowed(
            "api.example.com",
            &["api.other.com".to_string()]
        ));
    }

    #[test]
    fn rejects_host_outside_allowed_hosts_before_network() {
        let args = HttpRequestArgs {
            allowed_hosts: vec!["api.example.com".to_string()],
            ..args_for_url("https://metadata.google.internal/computeMetadata/v1")
        };
        let parsed = url::Url::parse(&args.url).unwrap();
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        let err = rt
            .block_on(validate_url_host_policy(&parsed, &args))
            .unwrap_err();
        assert!(matches!(err, HttpRequestError::InvalidUrl { .. }));
    }

    #[test]
    fn rejects_localhost_without_private_network_opt_in() {
        let args = args_for_url("http://localhost:3000/status");
        let parsed = url::Url::parse(&args.url).unwrap();
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        let err = rt
            .block_on(validate_url_host_policy(&parsed, &args))
            .unwrap_err();
        match err {
            HttpRequestError::InvalidUrl { detail, .. } => {
                assert!(detail.contains("allowPrivateNetwork"));
            }
            other => panic!("expected InvalidUrl, got {other:?}"),
        }
    }

    #[test]
    fn rejects_private_literal_ip_without_private_network_opt_in() {
        let args = args_for_url("http://192.168.1.1/status");
        let parsed = url::Url::parse(&args.url).unwrap();
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        let err = rt
            .block_on(validate_url_host_policy(&parsed, &args))
            .unwrap_err();
        match err {
            HttpRequestError::InvalidUrl { detail, .. } => {
                assert!(detail.contains("allowPrivateNetwork"));
            }
            other => panic!("expected InvalidUrl, got {other:?}"),
        }
    }

    #[test]
    fn rejects_ipv4_mapped_loopback_without_private_network_opt_in() {
        let args = args_for_url("http://[::ffff:127.0.0.1]/status");
        let parsed = url::Url::parse(&args.url).unwrap();
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        let err = rt
            .block_on(validate_url_host_policy(&parsed, &args))
            .unwrap_err();
        match err {
            HttpRequestError::InvalidUrl { detail, .. } => {
                assert!(detail.contains("allowPrivateNetwork"));
            }
            other => panic!("expected InvalidUrl, got {other:?}"),
        }
    }

    #[test]
    fn allows_private_literal_ip_with_explicit_opt_in() {
        let mut args = args_for_url("http://192.168.1.1/status");
        args.allow_private_network = true;
        let parsed = url::Url::parse(&args.url).unwrap();
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        rt.block_on(validate_url_host_policy(&parsed, &args))
            .unwrap();
    }

    #[test]
    fn rejects_credentials_in_url() {
        let args = args_for_url("https://user:pass@example.com/path");
        let parsed = url::Url::parse(&args.url).unwrap();
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        let err = rt
            .block_on(validate_url_host_policy(&parsed, &args))
            .unwrap_err();
        match err {
            HttpRequestError::InvalidUrl { detail, .. } => {
                assert!(detail.contains("credentials"));
            }
            other => panic!("expected InvalidUrl, got {other:?}"),
        }
    }
}
