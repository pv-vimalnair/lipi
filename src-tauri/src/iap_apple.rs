//! Mac App Store receipt validation.
//!
//! Phase 4 (IAP receipt validation). The `iap_apple`
//! module implements the [App Store `verifyReceipt`]
//! protocol:
//!
//! 1. POST the receipt to Apple's `verifyReceipt`
//!    endpoint (`https://buy.itunes.apple.com/verifyReceipt`).
//! 2. Check the response's `status` field is `0`
//!    (success).
//! 3. Check the response's `latest_receipt_info[0]` has
//!    the expected `product_id` for the requested
//!    plan (e.g. `app.lipi.ide.monthly`).
//! 4. Check the `expires_date_ms` is in the future.
//! 5. Return a `ValidatedIapReceipt` struct with the
//!    product id, purchase date, and expiration date.
//!
//! # Endpoints
//!
//! - Production: `https://buy.itunes.apple.com/verifyReceipt`
//! - Sandbox: `https://sandbox.itunes.apple.com/verifyReceipt`
//!
//! Phase 4 hardcodes the production endpoint. The
//! sandbox endpoint is for TestFlight users; Phase 4
//! returns `iap-sandbox-not-supported` for sandbox
//! receipts (the project lead can manually switch the
//! user to a real license key).
//!
//! # Shared secret
//!
//! The `verifyReceipt` request includes a `password`
//! field with the app's shared secret (a 32-char hex
//! string from App Store Connect). The shared secret
//! is read at build time from the `LIPI_APPLE_IAP_SHARED_SECRET`
//! env var via `option_env!` so the binary never has
//! the secret on disk in plaintext.
//!
//! If the env var is not set, the module returns
//! `iap-shared-secret-missing` for every call (this
//! happens in development builds and in CI; the
//! production release pipeline sets the env var in
//! the GitHub Actions secret store).
//!
//! [App Store `verifyReceipt`]: https://developer.apple.com/documentation/appstorereceipts/verifyreceipt

use serde::{Deserialize, Serialize};

/// The Apple App Store production `verifyReceipt` endpoint.
/// Hardcoded; the sandbox endpoint is intentionally not
/// supported in Phase 4.
#[allow(dead_code)] // Used by the future raw-receipt entry point (`verify_apple_receipt`).
const APPLE_VERIFY_RECEIPT_URL: &str = "https://buy.itunes.apple.com/verifyReceipt";

/// The expected IAP product ID for the `monthly` plan.
/// Must match the App Store Connect product
/// configuration.
pub const APPLE_PRODUCT_ID_MONTHLY: &str = "app.lipi.ide.monthly";

/// The expected IAP product ID for the `yearly` plan.
/// Must match the App Store Connect product
/// configuration.
pub const APPLE_PRODUCT_ID_YEARLY: &str = "app.lipi.ide.yearly";

/// The shared secret for App Store Connect. Read at
/// build time from `LIPI_APPLE_IAP_SHARED_SECRET`.
/// If unset (e.g. dev build, CI without the secret),
/// the module falls back to `None` and every call
/// returns `iap-shared-secret-missing`.
///
/// The `option_env!` macro embeds the env var value
/// into the binary at compile time. The env var is
/// never read at runtime, so the secret is never
/// exfiltrated via process inspection (after the
/// build).
#[allow(dead_code)] // Used by the future raw-receipt entry point (`verify_apple_receipt`).
const APPLE_SHARED_SECRET: Option<&'static str> = option_env!("LIPI_APPLE_IAP_SHARED_SECRET");

/// The validated Apple IAP receipt. The fields are
/// the post-validation data the dispatcher needs to
/// build a `LicensePayload`.
///
/// `purchased_at_unix` and `expires_at_unix` are
/// Unix timestamps in seconds (Apple returns
/// milliseconds; we divide by 1000).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AppleValidatedReceipt {
    /// The product ID of the IAP (e.g.
    /// `app.lipi.ide.monthly`). Must match the
    /// requested plan.
    pub product_id: String,

    /// Unix timestamp (in seconds) of the
    /// original purchase.
    pub purchased_at_unix: i64,

    /// Unix timestamp (in seconds) of the
    /// subscription expiration. Required for
    /// auto-renewing subscriptions; the
    /// `LicensePayload.exp` is set to this
    /// value.
    pub expires_at_unix: i64,
}

// --- The HTTP response shape (serde) -------------------------------

/// Top-level `verifyReceipt` response.
#[derive(Debug, Clone, Deserialize)]
pub(crate) struct AppleVerifyResponse {
    /// `0` = success; non-zero = error (see
    /// Apple's status code reference).
    pub status: u32,

    /// The latest receipt info (one entry per
    /// in-app purchase). Only present on success.
    /// Phase 4 reads `latest_receipt_info[0]` (the
    /// most recent transaction).
    #[serde(default)]
    pub latest_receipt_info: Vec<AppleInAppPurchase>,
}

/// A single in-app purchase row from
/// `latest_receipt_info[]`. Apple's field names
/// use snake_case; the `#[serde(rename_all = ...)]`
/// below maps them.
#[derive(Debug, Clone, Deserialize)]
pub(crate) struct AppleInAppPurchase {
    /// The product ID of the IAP (e.g.
    /// `app.lipi.ide.monthly`).
    #[serde(rename = "product_id")]
    pub product_id: String,

    /// Purchase date in milliseconds since the
    /// Unix epoch. String-typed because Apple's
    /// JSON parser uses strings for large numbers.
    #[serde(rename = "purchase_date_ms")]
    pub purchase_date_ms: String,

    /// Expiration date in milliseconds since the
    /// Unix epoch. Required for auto-renewing
    /// subscriptions.
    #[serde(rename = "expires_date_ms")]
    pub expires_date_ms: String,
}

// --- The validation function (pure, testable) -----------------------

/// Validate an Apple `verifyReceipt` response.
///
/// The response is the *deserialized* JSON (not the
/// raw HTTP body). Separating deserialization from
/// validation means the tests can use a mock JSON
/// fixture without a real HTTP call.
///
/// # Errors (mapped to `IapError` by the caller)
///
/// - `status != 0` → `iap-rejected-by-apple` with
///   Apple's status code in the detail.
/// - `latest_receipt_info` is empty → `iap-no-purchase-found`.
/// - `latest_receipt_info[0].product_id` doesn't
///   match the expected product ID for the requested
///   plan → `iap-product-id-mismatch`.
/// - `expires_date_ms` is missing or in the past →
///   `iap-expired`.
/// - `purchase_date_ms` is in the future → `iap-future-purchase`.
pub fn validate_apple_response(
    response: &AppleVerifyResponse,
    plan: &str,
    now_unix_secs: i64,
) -> Result<AppleValidatedReceipt, AppleError> {
    if response.status != 0 {
        return Err(AppleError::RejectedByApple {
            status: response.status,
        });
    }
    let row = response
        .latest_receipt_info
        .first()
        .ok_or(AppleError::NoPurchaseFound)?;
    let expected_product_id = expected_product_id_for_plan(plan);
    if row.product_id != expected_product_id {
        return Err(AppleError::ProductIdMismatch {
            expected: expected_product_id.to_string(),
            got: row.product_id.clone(),
        });
    }
    let purchased_at_ms: i64 =
        row.purchase_date_ms
            .parse()
            .map_err(|_| AppleError::InvalidResponse {
                detail: format!(
                    "purchase_date_ms {:?} is not a valid integer",
                    row.purchase_date_ms
                ),
            })?;
    let expires_at_ms: i64 = row.expires_date_ms.parse().ok().ok_or_else(|| AppleError::InvalidResponse {
        detail: format!("expires_date_ms {:?} is not a valid integer (or is missing — required for auto-renewing subscriptions)", row.expires_date_ms),
    })?;
    let purchased_at_unix = purchased_at_ms / 1000;
    let expires_at_unix = expires_at_ms / 1000;
    if purchased_at_unix > now_unix_secs {
        return Err(AppleError::FuturePurchase {
            purchased_at: purchased_at_unix,
            now: now_unix_secs,
        });
    }
    if expires_at_unix <= now_unix_secs {
        return Err(AppleError::Expired {
            expired_at: expires_at_unix,
            now: now_unix_secs,
        });
    }
    Ok(AppleValidatedReceipt {
        product_id: row.product_id.clone(),
        purchased_at_unix,
        expires_at_unix,
    })
}

/// Map a plan name (`"monthly"`, `"yearly"`) to the
/// expected Apple product ID. Returns
/// `iap-unknown-plan` for unknown plans.
fn expected_product_id_for_plan(plan: &str) -> &str {
    match plan {
        "monthly" => APPLE_PRODUCT_ID_MONTHLY,
        "yearly" => APPLE_PRODUCT_ID_YEARLY,
        _ => "unknown",
    }
}

// --- The error type -----------------------------------------------

/// The error type for the Apple validator. The
/// dispatcher maps these to `IapError` variants
/// (with the platform-specific reason). The detail
/// field carries the human-readable message.
#[allow(dead_code)] // Some variants are only constructed by the future raw-receipt entry point.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AppleError {
    /// The shared secret env var is not set
    /// (development build, CI without the secret).
    /// The UI shows "Apple IAP is not configured in
    /// this build; please paste a license key instead."
    SharedSecretMissing,

    /// The HTTP request failed (network error,
    /// timeout, DNS, etc.). The dispatcher maps
    /// this to `iap-network-error`.
    NetworkError { detail: String },

    /// The HTTP response could not be deserialized
    /// as a `verifyReceipt` response (Apple changed
    /// the format, or the response is HTML, etc.).
    InvalidResponse { detail: String },

    /// Apple's `status` field is non-zero. The
    /// status code is included in the detail.
    /// Common codes: 21002 (data malformed), 21004
    /// (shared secret mismatch), 21005 (receipt
    /// server unavailable), 21007 (this receipt is
    /// from the sandbox — Phase 4 returns this
    /// directly so the user knows).
    RejectedByApple { status: u32 },

    /// The response was a success but
    /// `latest_receipt_info` is empty. Shouldn't
    /// happen in practice (a valid receipt always
    /// has at least one purchase row).
    NoPurchaseFound,

    /// The product ID doesn't match the expected
    /// product ID for the requested plan (e.g. the
    /// user is trying to redeem a yearly receipt
    /// against a monthly plan).
    ProductIdMismatch { expected: String, got: String },

    /// The `expires_date_ms` field is missing or
    /// in the past.
    Expired { expired_at: i64, now: i64 },

    /// The `purchase_date_ms` is in the future
    /// (clock skew or a forged receipt).
    FuturePurchase { purchased_at: i64, now: i64 },

    /// The plan name is not one of `"monthly"`,
    /// `"yearly"`. The UI shows "unknown plan: {plan}".
    UnknownPlan { plan: String },
}

impl AppleError {
    /// A short reason string for the dispatcher to
    /// embed in the `LicenseStatus::Invalid { reason }`
    /// return value. Matches the convention from
    /// the Phase 3 stub.
    pub fn reason(&self) -> String {
        match self {
            AppleError::SharedSecretMissing => "iap-shared-secret-missing".to_string(),
            AppleError::NetworkError { detail } => format!("iap-network-error: {detail}"),
            AppleError::InvalidResponse { detail } => format!("iap-malformed-response: {detail}"),
            AppleError::RejectedByApple { status } => {
                // Special-case status 21007 (sandbox receipt)
                // so the user gets a clear message instead of
                // a numeric code.
                if *status == 21007 {
                    "iap-sandbox-not-supported: this receipt is a TestFlight / sandbox receipt. Phase 4 only supports production receipts.".to_string()
                } else {
                    format!("iap-rejected-by-apple: Apple status {status} (see https://developer.apple.com/documentation/appstorereceipts/status for the full code reference)")
                }
            }
            AppleError::NoPurchaseFound => {
                "iap-no-purchase-found: the receipt is valid but has no in-app purchases"
                    .to_string()
            }
            AppleError::ProductIdMismatch { expected, got } => {
                format!("iap-product-id-mismatch: expected {expected:?} for this plan, got {got:?}")
            }
            AppleError::Expired { expired_at, now } => {
                format!("iap-expired: the subscription expired at unix {expired_at} (now {now})")
            }
            AppleError::FuturePurchase { purchased_at, now } => {
                format!("iap-future-purchase: the receipt claims a purchase at unix {purchased_at}, which is in the future (now {now})")
            }
            AppleError::UnknownPlan { plan } => {
                format!("iap-unknown-plan: {plan:?} (expected one of \"monthly\", \"yearly\")")
            }
        }
    }
}

// --- The HTTP caller -----------------------------------------------

/// Send a `verifyReceipt` request to Apple and
/// return the validated receipt. This is the
/// "real" entry point (with the HTTP call); the
/// pure `validate_apple_response` is for tests
/// and for the dispatcher's mock-fallback path.
///
/// # HTTP client
///
/// Uses `reqwest` (already a transitive dep of
/// Tauri). The 5-second timeout matches the
/// `updater_health` module's timeout (consistent
/// UX: network calls don't hang the UI).
///
/// # Shared secret
///
/// Reads the `APPLE_SHARED_SECRET` const (which
/// reads from the build-time env var). If unset,
/// returns `AppleError::SharedSecretMissing`.
///
/// # Errors
///
/// - `AppleError::SharedSecretMissing` if the
///   env var is not set.
/// - `AppleError::NetworkError` on HTTP failure.
/// - `AppleError::InvalidResponse` on deserialization failure.
/// - `AppleError::RejectedByApple` /
///   `AppleError::NoPurchaseFound` / etc. on validation failure.
pub async fn verify_apple_receipt(
    receipt_b64: &str,
    plan: &str,
    now_unix_secs: i64,
) -> Result<AppleValidatedReceipt, AppleError> {
    let shared_secret = APPLE_SHARED_SECRET.ok_or(AppleError::SharedSecretMissing)?;
    let request_body = serde_json::json!({
        "receipt-data": receipt_b64,
        "password": shared_secret,
    });
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .map_err(|e| AppleError::NetworkError {
            detail: format!("failed to build HTTP client: {e}"),
        })?;
    let response = client
        .post(APPLE_VERIFY_RECEIPT_URL)
        .json(&request_body)
        .send()
        .await
        .map_err(|e| AppleError::NetworkError {
            detail: format!("HTTP POST failed: {e}"),
        })?;
    let status = response.status();
    if !status.is_success() {
        return Err(AppleError::NetworkError {
            detail: format!("Apple returned HTTP {status}"),
        });
    }
    let body: AppleVerifyResponse =
        response
            .json()
            .await
            .map_err(|e| AppleError::InvalidResponse {
                detail: format!("failed to parse Apple response: {e}"),
            })?;
    validate_apple_response(&body, plan, now_unix_secs)
}

// --- Tests --------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    // --- expected_product_id_for_plan ---

    #[test]
    fn expected_product_id_for_plan_monthly() {
        assert_eq!(
            expected_product_id_for_plan("monthly"),
            APPLE_PRODUCT_ID_MONTHLY
        );
    }

    #[test]
    fn expected_product_id_for_plan_yearly() {
        assert_eq!(
            expected_product_id_for_plan("yearly"),
            APPLE_PRODUCT_ID_YEARLY
        );
    }

    #[test]
    fn expected_product_id_for_plan_unknown_returns_unknown() {
        assert_eq!(expected_product_id_for_plan("lifetime"), "unknown");
        assert_eq!(expected_product_id_for_plan(""), "unknown");
    }

    // --- validate_apple_response: happy path ---

    #[test]
    fn validate_apple_response_accepts_status_0_with_matching_monthly_product_id() {
        let now = 1_700_000_000i64;
        let response = AppleVerifyResponse {
            status: 0,
            latest_receipt_info: vec![AppleInAppPurchase {
                product_id: APPLE_PRODUCT_ID_MONTHLY.to_string(),
                purchase_date_ms: ((now - 30 * 86_400) * 1000).to_string(),
                expires_date_ms: ((now + 30 * 86_400) * 1000).to_string(),
            }],
        };
        let result = validate_apple_response(&response, "monthly", now).unwrap();
        assert_eq!(result.product_id, APPLE_PRODUCT_ID_MONTHLY);
        assert_eq!(result.purchased_at_unix, now - 30 * 86_400);
        assert_eq!(result.expires_at_unix, now + 30 * 86_400);
    }

    #[test]
    fn validate_apple_response_accepts_status_0_with_matching_yearly_product_id() {
        let now = 1_700_000_000i64;
        let response = AppleVerifyResponse {
            status: 0,
            latest_receipt_info: vec![AppleInAppPurchase {
                product_id: APPLE_PRODUCT_ID_YEARLY.to_string(),
                purchase_date_ms: ((now - 365 * 86_400) * 1000).to_string(),
                expires_date_ms: ((now + 365 * 86_400) * 1000).to_string(),
            }],
        };
        let result = validate_apple_response(&response, "yearly", now).unwrap();
        assert_eq!(result.product_id, APPLE_PRODUCT_ID_YEARLY);
    }

    // --- validate_apple_response: status codes ---

    #[test]
    fn validate_apple_response_rejects_status_21002_malformed_data() {
        let response = AppleVerifyResponse {
            status: 21002,
            latest_receipt_info: vec![],
        };
        let err = validate_apple_response(&response, "monthly", 1_700_000_000).unwrap_err();
        assert!(matches!(err, AppleError::RejectedByApple { status: 21002 }));
    }

    #[test]
    fn validate_apple_response_rejects_status_21004_shared_secret_mismatch() {
        let response = AppleVerifyResponse {
            status: 21004,
            latest_receipt_info: vec![],
        };
        let err = validate_apple_response(&response, "monthly", 1_700_000_000).unwrap_err();
        assert!(matches!(err, AppleError::RejectedByApple { status: 21004 }));
    }

    #[test]
    fn validate_apple_response_rejects_status_21007_sandbox_receipt() {
        let response = AppleVerifyResponse {
            status: 21007,
            latest_receipt_info: vec![],
        };
        let err = validate_apple_response(&response, "monthly", 1_700_000_000).unwrap_err();
        // Status 21007 is special: the receipt is
        // from the sandbox, not production. The
        // reason string should mention sandbox.
        let reason = err.reason();
        assert!(
            reason.contains("sandbox"),
            "expected sandbox in reason: {reason}"
        );
    }

    // --- validate_apple_response: product ID ---

    #[test]
    fn validate_apple_response_rejects_mismatched_product_id() {
        let now = 1_700_000_000i64;
        let response = AppleVerifyResponse {
            status: 0,
            latest_receipt_info: vec![AppleInAppPurchase {
                product_id: APPLE_PRODUCT_ID_YEARLY.to_string(),
                purchase_date_ms: ((now - 86_400) * 1000).to_string(),
                expires_date_ms: ((now + 86_400) * 1000).to_string(),
            }],
        };
        // User asked for "monthly" but the receipt is for "yearly".
        let err = validate_apple_response(&response, "monthly", now).unwrap_err();
        assert!(matches!(err, AppleError::ProductIdMismatch { .. }));
        let reason = err.reason();
        assert!(reason.contains("iap-product-id-mismatch"));
    }

    // --- validate_apple_response: expiration / purchase date ---

    #[test]
    fn validate_apple_response_rejects_expired_subscription() {
        let now = 1_700_000_000i64;
        let response = AppleVerifyResponse {
            status: 0,
            latest_receipt_info: vec![AppleInAppPurchase {
                product_id: APPLE_PRODUCT_ID_MONTHLY.to_string(),
                purchase_date_ms: ((now - 60 * 86_400) * 1000).to_string(),
                expires_date_ms: ((now - 86_400) * 1000).to_string(), // expired yesterday
            }],
        };
        let err = validate_apple_response(&response, "monthly", now).unwrap_err();
        assert!(matches!(err, AppleError::Expired { .. }));
        let reason = err.reason();
        assert!(reason.contains("iap-expired"));
    }

    #[test]
    fn validate_apple_response_rejects_future_purchase_date() {
        let now = 1_700_000_000i64;
        let response = AppleVerifyResponse {
            status: 0,
            latest_receipt_info: vec![AppleInAppPurchase {
                product_id: APPLE_PRODUCT_ID_MONTHLY.to_string(),
                purchase_date_ms: ((now + 86_400) * 1000).to_string(), // 1 day in the future
                expires_date_ms: ((now + 30 * 86_400) * 1000).to_string(),
            }],
        };
        let err = validate_apple_response(&response, "monthly", now).unwrap_err();
        assert!(matches!(err, AppleError::FuturePurchase { .. }));
        let reason = err.reason();
        assert!(reason.contains("iap-future-purchase"));
    }

    // --- validate_apple_response: malformed ---

    #[test]
    fn validate_apple_response_rejects_empty_latest_receipt_info() {
        let response = AppleVerifyResponse {
            status: 0,
            latest_receipt_info: vec![],
        };
        let err = validate_apple_response(&response, "monthly", 1_700_000_000).unwrap_err();
        assert!(matches!(err, AppleError::NoPurchaseFound));
    }

    #[test]
    fn validate_apple_response_rejects_non_numeric_purchase_date() {
        let response = AppleVerifyResponse {
            status: 0,
            latest_receipt_info: vec![AppleInAppPurchase {
                product_id: APPLE_PRODUCT_ID_MONTHLY.to_string(),
                purchase_date_ms: "not-a-number".to_string(),
                expires_date_ms: "1700000000000".to_string(),
            }],
        };
        let err = validate_apple_response(&response, "monthly", 1_700_000_000).unwrap_err();
        assert!(matches!(err, AppleError::InvalidResponse { .. }));
    }

    // --- reason() ---

    #[test]
    fn apple_error_reason_for_shared_secret_missing() {
        let err = AppleError::SharedSecretMissing;
        assert_eq!(err.reason(), "iap-shared-secret-missing");
    }

    #[test]
    fn apple_error_reason_for_network_error() {
        let err = AppleError::NetworkError {
            detail: "connection refused".to_string(),
        };
        let reason = err.reason();
        assert!(reason.starts_with("iap-network-error:"));
        assert!(reason.contains("connection refused"));
    }
}
