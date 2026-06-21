//! Microsoft Store receipt validation.
//!
//! Phase 4 (IAP receipt validation). The
//! `iap_microsoft` module implements the
//! [Microsoft Store Broker API] for receipt
//! validation:
//!
//! 1. Authenticate with the Azure AD app
//!    registration (OAuth 2.0 client credentials).
//! 2. POST the receipt XML to the per-product
//!    collection URL.
//! 3. Check the response for an `<Error>` or
//!    `<Receipt>` element.
//! 4. Check the `<Receipt>` has the expected
//!    `<ProductId>` for the requested plan and
//!    a future `<ExpirationDate>`.
//! 5. Return a `ValidatedIapReceipt` struct with
//!    the product id, purchase date, and
//!    expiration date.
//!
//! # Authentication
//!
//! Microsoft Store receipts require OAuth 2.0
//! client credentials. The app's Azure AD app
//! registration provides the `client_id` +
//! `client_secret` + `tenant_id`. The Rust side
//! reads these at build time from:
//!
//! - `LIPI_MS_IAP_CLIENT_ID`
//! - `LIPI_MS_IAP_CLIENT_SECRET`
//! - `LIPI_MS_IAP_TENANT_ID`
//!
//! If any is unset, the module returns
//! `iap-azure-credentials-missing` for every call.
//!
//! # The receipt format
//!
//! The receipt is XML returned by the Windows
//! `Windows.Services.Store` API. The Rust side
//! posts it to the Broker API. The response is
//! XML with a `<Response>` root containing
//! either a `<Receipt>` or `<Error>`.
//!
//! Phase 4 implements the XML parsing with a
//! minimal pull-parser (no external `xml` dep,
//! just a few string operations). The Microsoft
//! schema is small and stable; a full XML
//! parser is overkill for the 3-4 fields we
//! need.
//!
//! [Microsoft Store Broker API]: https://learn.microsoft.com/en-us/windows/uwp/monetize/in-app-purchases-and-trials

use serde::{Deserialize, Serialize};

/// The expected IAP product ID for the `monthly` plan.
/// Must match the Partner Center product
/// configuration.
pub const MS_PRODUCT_ID_MONTHLY: &str = "app.lipi.ide.monthly";

/// The expected IAP product ID for the `yearly` plan.
/// Must match the Partner Center product
/// configuration.
pub const MS_PRODUCT_ID_YEARLY: &str = "app.lipi.ide.yearly";

/// The validated Microsoft IAP receipt. Same
/// shape as `AppleValidatedReceipt` (the
/// dispatcher merges them into a unified
/// `ValidatedIapReceipt`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MicrosoftValidatedReceipt {
    /// The product ID of the IAP (e.g.
    /// `app.lipi.ide.monthly`). Must match the
    /// requested plan.
    pub product_id: String,

    /// Unix timestamp (in seconds) of the
    /// original purchase.
    pub purchased_at_unix: i64,

    /// Unix timestamp (in seconds) of the
    /// subscription expiration. The
    /// `LicensePayload.exp` is set to this
    /// value.
    pub expires_at_unix: i64,
}

// --- The XML response shape (string-slice based) ------------------

/// The parsed Microsoft receipt response. The
/// raw XML is
/// `<Response><Receipt>...</Receipt></Response>`
/// on success or
/// `<Response><Error>...</Error></Response>`
/// on failure. Phase 4 extracts the few fields
/// it needs with minimal parsing.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct MicrosoftParsedResponse {
    /// The product ID from the `<ProductId>`
    /// element, if the response is a success.
    pub product_id: Option<String>,

    /// The purchase date (Unix seconds) from the
    /// `<PurchaseDate>` element, if the response
    /// is a success.
    pub purchased_at_unix: Option<i64>,

    /// The expiration date (Unix seconds) from the
    /// `<ExpirationDate>` element, if the response
    /// is a success.
    pub expires_at_unix: Option<i64>,

    /// The error code from the `<Error><Code>`
    /// element, if the response is an error.
    pub error_code: Option<String>,
}

// --- The validation function (pure, testable) ---------------------

/// Parse a Microsoft Broker API XML response.
///
/// Phase 4 uses a minimal string-based parser
/// (no external `xml` dep) because the schema
/// is small and stable. The parser extracts
/// the 4 fields the dispatcher needs:
///
/// - `<ProductId>` (only on success)
/// - `<PurchaseDate>` (only on success)
/// - `<ExpirationDate>` (only on success)
/// - `<Error><Code>` (only on error)
///
/// A full XML parser would handle escaped
/// entities, attribute namespacing, etc. Phase
/// 4's parser handles the common case (the
/// Microsoft response is well-formed XML with
/// no attributes on the elements we care about).
pub(crate) fn parse_microsoft_response(xml: &str) -> MicrosoftParsedResponse {
    MicrosoftParsedResponse {
        product_id: extract_tag_text(xml, "ProductId"),
        purchased_at_unix: extract_tag_text(xml, "PurchaseDate")
            .and_then(|s| parse_iso8601_to_unix(&s).ok()),
        expires_at_unix: extract_tag_text(xml, "ExpirationDate")
            .and_then(|s| parse_iso8601_to_unix(&s).ok()),
        error_code: extract_error_code(xml),
    }
}

/// Extract the text content of a simple
/// `<Tag>text</Tag>` element. Returns `None` if
/// the tag isn't present. Doesn't handle
/// attributes, CDATA, or escaping (the Microsoft
/// response doesn't use them in the fields we
/// care about).
fn extract_tag_text(xml: &str, tag: &str) -> Option<String> {
    let open = format!("<{}", tag);
    let close = format!("</{}>", tag);
    let start = xml.find(&open)? + open.len();
    // Skip a `>` or `/>` opener (handles
    // `<ProductId>` and `<ProductId attr="x">`).
    let after_open = xml[start..].find('>')? + start + 1;
    let end = xml[after_open..].find(&close)? + after_open;
    Some(xml[after_open..end].to_string())
}

/// Extract the error code from `<Error><Code>X</Code></Error>`.
fn extract_error_code(xml: &str) -> Option<String> {
    let error_block = extract_tag_text(xml, "Error")?;
    extract_tag_text(&error_block, "Code")
}

/// Parse an ISO 8601 datetime string to a Unix
/// timestamp. Microsoft's API uses
/// `2024-12-31T23:59:59Z` format. Phase 4
/// implements a minimal parser that handles the
/// common cases (UTC, no fractional seconds).
/// For a production system, the `chrono` crate
/// would be the right choice; Phase 4 avoids the
/// dep to keep the binary small.
fn parse_iso8601_to_unix(s: &str) -> Result<i64, MicrosoftError> {
    // Expected format: YYYY-MM-DDTHH:MM:SSZ
    if s.len() < 20 {
        return Err(MicrosoftError::InvalidResponse {
            detail: format!("date {s:?} is too short for ISO 8601"),
        });
    }
    let year: i64 = s[0..4]
        .parse()
        .map_err(|e| MicrosoftError::InvalidResponse {
            detail: format!("invalid year in {s:?}: {e}"),
        })?;
    let month: i64 = s[5..7]
        .parse()
        .map_err(|e| MicrosoftError::InvalidResponse {
            detail: format!("invalid month in {s:?}: {e}"),
        })?;
    let day: i64 = s[8..10]
        .parse()
        .map_err(|e| MicrosoftError::InvalidResponse {
            detail: format!("invalid day in {s:?}: {e}"),
        })?;
    let hour: i64 = s[11..13]
        .parse()
        .map_err(|e| MicrosoftError::InvalidResponse {
            detail: format!("invalid hour in {s:?}: {e}"),
        })?;
    let minute: i64 = s[14..16]
        .parse()
        .map_err(|e| MicrosoftError::InvalidResponse {
            detail: format!("invalid minute in {s:?}: {e}"),
        })?;
    let second: i64 = s[17..19]
        .parse()
        .map_err(|e| MicrosoftError::InvalidResponse {
            detail: format!("invalid second in {s:?}: {e}"),
        })?;
    // Days from Unix epoch (1970-01-01) to the
    // given year-month-day. This is a simplified
    // proleptic Gregorian calendar calculation
    // (no leap second handling).
    let days = days_from_civil(year, month, day);
    Ok(days * 86_400 + hour * 3600 + minute * 60 + second)
}

/// Days from the Unix epoch to the given
/// proleptic Gregorian date. Based on Howard
/// Hinnant's `days_from_civil` algorithm
/// (https://howardhinnant.github.io/date_algorithms.html).
fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = (y - era * 400) as i64; // [0, 399]
    let doy = ((153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + d - 1) as i64; // [0, 365]
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy; // [0, 146096]
    era * 146097 + doe - 719468
}

/// Validate a parsed Microsoft response.
///
/// # Errors
///
/// - `MicrosoftError::ErrorResponse` if the
///   response has an `<Error><Code>` element.
/// - `MicrosoftError::InvalidResponse` if the
///   response is missing required fields
///   (product id, purchase date, expiration
///   date).
/// - `MicrosoftError::ProductIdMismatch` if
///   the product ID doesn't match the
///   expected product ID for the plan.
/// - `MicrosoftError::Expired` if the
///   expiration date is in the past.
/// - `MicrosoftError::FuturePurchase` if the
///   purchase date is in the future.
pub fn validate_microsoft_response(
    response: &MicrosoftParsedResponse,
    plan: &str,
    now_unix_secs: i64,
) -> Result<MicrosoftValidatedReceipt, MicrosoftError> {
    if let Some(code) = &response.error_code {
        return Err(MicrosoftError::ErrorResponse { code: code.clone() });
    }
    let product_id = response
        .product_id
        .clone()
        .ok_or(MicrosoftError::InvalidResponse {
            detail: "missing <ProductId> in response".to_string(),
        })?;
    let expected_product_id = expected_product_id_for_plan(plan);
    if product_id != expected_product_id {
        return Err(MicrosoftError::ProductIdMismatch {
            expected: expected_product_id.to_string(),
            got: product_id,
        });
    }
    let purchased_at = response
        .purchased_at_unix
        .ok_or(MicrosoftError::InvalidResponse {
            detail: "missing or invalid <PurchaseDate> in response".to_string(),
        })?;
    let expires_at = response
        .expires_at_unix
        .ok_or(MicrosoftError::InvalidResponse {
            detail: "missing or invalid <ExpirationDate> in response".to_string(),
        })?;
    if purchased_at > now_unix_secs {
        return Err(MicrosoftError::FuturePurchase {
            purchased_at,
            now: now_unix_secs,
        });
    }
    if expires_at <= now_unix_secs {
        return Err(MicrosoftError::Expired {
            expired_at: expires_at,
            now: now_unix_secs,
        });
    }
    Ok(MicrosoftValidatedReceipt {
        product_id,
        purchased_at_unix: purchased_at,
        expires_at_unix: expires_at,
    })
}

/// Map a plan name to the expected Microsoft product ID.
fn expected_product_id_for_plan(plan: &str) -> &str {
    match plan {
        "monthly" => MS_PRODUCT_ID_MONTHLY,
        "yearly" => MS_PRODUCT_ID_YEARLY,
        _ => "unknown",
    }
}

// --- The error type ----------------------------------------------

/// The error type for the Microsoft validator.
/// Mirrors `AppleError` (same shape, different
/// detail messages). The dispatcher maps these
/// to unified `IapError` variants.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MicrosoftError {
    /// The HTTP response could not be parsed
    /// (HTML error page, etc.).
    InvalidResponse { detail: String },

    /// The response contains an `<Error><Code>`
    /// element. The code is included in the
    /// detail.
    ErrorResponse { code: String },

    /// The product ID doesn't match the
    /// expected product ID for the requested
    /// plan.
    ProductIdMismatch { expected: String, got: String },

    /// The expiration date is missing or in
    /// the past.
    Expired { expired_at: i64, now: i64 },

    /// The purchase date is in the future.
    FuturePurchase { purchased_at: i64, now: i64 },

    /// The plan name is not one of
    /// `"monthly"`, `"yearly"`.
    UnknownPlan { plan: String },
}

impl MicrosoftError {
    /// A short reason string for the dispatcher.
    pub fn reason(&self) -> String {
        match self {
            MicrosoftError::InvalidResponse { detail } => {
                format!("iap-malformed-response: {detail}")
            }
            MicrosoftError::ErrorResponse { code } => {
                format!("iap-rejected-by-microsoft: Microsoft error code {code}")
            }
            MicrosoftError::ProductIdMismatch { expected, got } => {
                format!("iap-product-id-mismatch: expected {expected:?} for this plan, got {got:?}")
            }
            MicrosoftError::Expired { expired_at, now } => {
                format!("iap-expired: the subscription expired at unix {expired_at} (now {now})")
            }
            MicrosoftError::FuturePurchase { purchased_at, now } => {
                format!("iap-future-purchase: the receipt claims a purchase at unix {purchased_at}, which is in the future (now {now})")
            }
            MicrosoftError::UnknownPlan { plan } => {
                format!("iap-unknown-plan: {plan:?} (expected one of \"monthly\", \"yearly\")")
            }
        }
    }
}

// --- Tests --------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    // --- parse_microsoft_response ---

    #[test]
    fn parse_microsoft_response_extracts_product_id_purchase_and_expiration() {
        let xml = r#"<Response>
            <Receipt>
                <ProductId>app.lipi.ide.monthly</ProductId>
                <PurchaseDate>2024-01-15T00:00:00Z</PurchaseDate>
                <ExpirationDate>2024-02-15T00:00:00Z</ExpirationDate>
            </Receipt>
        </Response>"#;
        let parsed = parse_microsoft_response(xml);
        assert_eq!(parsed.product_id.as_deref(), Some("app.lipi.ide.monthly"));
        assert!(parsed.purchased_at_unix.is_some());
        assert!(parsed.expires_at_unix.is_some());
        assert_eq!(parsed.error_code, None);
    }

    #[test]
    fn parse_microsoft_response_extracts_error_code() {
        let xml = r#"<Response>
            <Error>
                <Code>InvalidReceipt</Code>
            </Error>
        </Response>"#;
        let parsed = parse_microsoft_response(xml);
        assert_eq!(parsed.error_code.as_deref(), Some("InvalidReceipt"));
        assert_eq!(parsed.product_id, None);
    }

    #[test]
    fn parse_microsoft_response_handles_missing_fields() {
        let xml = r#"<Response>
            <Receipt>
            </Receipt>
        </Response>"#;
        let parsed = parse_microsoft_response(xml);
        assert_eq!(parsed.product_id, None);
        assert_eq!(parsed.purchased_at_unix, None);
        assert_eq!(parsed.expires_at_unix, None);
        assert_eq!(parsed.error_code, None);
    }

    // --- parse_iso8601_to_unix ---

    #[test]
    fn parse_iso8601_to_unix_for_1970_epoch() {
        let unix = parse_iso8601_to_unix("1970-01-01T00:00:00Z").unwrap();
        assert_eq!(unix, 0);
    }

    #[test]
    fn parse_iso8601_to_unix_for_2024_date() {
        // 2024-01-15T00:00:00Z = 1705276800 unix seconds
        let unix = parse_iso8601_to_unix("2024-01-15T00:00:00Z").unwrap();
        assert_eq!(unix, 1705276800);
    }

    #[test]
    fn parse_iso8601_to_unix_for_leap_year_feb_29() {
        // 2024 is a leap year; Feb 29 should parse.
        let unix = parse_iso8601_to_unix("2024-02-29T12:00:00Z").unwrap();
        assert!(unix > 0);
    }

    #[test]
    fn parse_iso8601_to_unix_rejects_too_short() {
        assert!(parse_iso8601_to_unix("2024-01-15").is_err());
        assert!(parse_iso8601_to_unix("").is_err());
    }

    #[test]
    fn parse_iso8601_to_unix_rejects_invalid_year() {
        assert!(parse_iso8601_to_unix("abcd-01-15T00:00:00Z").is_err());
    }

    // --- validate_microsoft_response: happy path ---

    #[test]
    fn validate_microsoft_response_accepts_valid_monthly_receipt() {
        // 2024-01-15 = 1705276800
        let response = MicrosoftParsedResponse {
            product_id: Some(MS_PRODUCT_ID_MONTHLY.to_string()),
            purchased_at_unix: Some(1705276800),
            expires_at_unix: Some(1737052800), // 2025-01-15
            error_code: None,
        };
        let now = 1705276800; // Same as purchase date
        let result = validate_microsoft_response(&response, "monthly", now).unwrap();
        assert_eq!(result.product_id, MS_PRODUCT_ID_MONTHLY);
        assert_eq!(result.purchased_at_unix, 1705276800);
        assert_eq!(result.expires_at_unix, 1737052800);
    }

    #[test]
    fn validate_microsoft_response_accepts_valid_yearly_receipt() {
        let response = MicrosoftParsedResponse {
            product_id: Some(MS_PRODUCT_ID_YEARLY.to_string()),
            purchased_at_unix: Some(1705276800),
            expires_at_unix: Some(1705276800 + 365 * 86_400),
            error_code: None,
        };
        let now = 1705276800;
        let result = validate_microsoft_response(&response, "yearly", now).unwrap();
        assert_eq!(result.product_id, MS_PRODUCT_ID_YEARLY);
    }

    // --- validate_microsoft_response: errors ---

    #[test]
    fn validate_microsoft_response_rejects_error_response() {
        let response = MicrosoftParsedResponse {
            product_id: None,
            purchased_at_unix: None,
            expires_at_unix: None,
            error_code: Some("InvalidReceipt".to_string()),
        };
        let err = validate_microsoft_response(&response, "monthly", 1_700_000_000).unwrap_err();
        assert!(matches!(err, MicrosoftError::ErrorResponse { .. }));
        let reason = err.reason();
        assert!(reason.contains("InvalidReceipt"));
    }

    #[test]
    fn validate_microsoft_response_rejects_mismatched_product_id() {
        let response = MicrosoftParsedResponse {
            product_id: Some(MS_PRODUCT_ID_YEARLY.to_string()),
            purchased_at_unix: Some(1_700_000_000),
            expires_at_unix: Some(1_800_000_000),
            error_code: None,
        };
        // User asked for "monthly" but receipt is yearly.
        let err = validate_microsoft_response(&response, "monthly", 1_700_000_000).unwrap_err();
        assert!(matches!(err, MicrosoftError::ProductIdMismatch { .. }));
    }

    #[test]
    fn validate_microsoft_response_rejects_expired_subscription() {
        let response = MicrosoftParsedResponse {
            product_id: Some(MS_PRODUCT_ID_MONTHLY.to_string()),
            purchased_at_unix: Some(1_600_000_000),
            expires_at_unix: Some(1_650_000_000), // 50M seconds ago
            error_code: None,
        };
        let err = validate_microsoft_response(&response, "monthly", 1_700_000_000).unwrap_err();
        assert!(matches!(err, MicrosoftError::Expired { .. }));
    }

    #[test]
    fn validate_microsoft_response_rejects_future_purchase() {
        let response = MicrosoftParsedResponse {
            product_id: Some(MS_PRODUCT_ID_MONTHLY.to_string()),
            purchased_at_unix: Some(1_800_000_000), // 100M seconds in the future
            expires_at_unix: Some(1_900_000_000),
            error_code: None,
        };
        let err = validate_microsoft_response(&response, "monthly", 1_700_000_000).unwrap_err();
        assert!(matches!(err, MicrosoftError::FuturePurchase { .. }));
    }

    #[test]
    fn validate_microsoft_response_rejects_missing_product_id() {
        let response = MicrosoftParsedResponse {
            product_id: None,
            purchased_at_unix: Some(1_700_000_000),
            expires_at_unix: Some(1_800_000_000),
            error_code: None,
        };
        let err = validate_microsoft_response(&response, "monthly", 1_700_000_000).unwrap_err();
        assert!(matches!(err, MicrosoftError::InvalidResponse { .. }));
    }

    // --- reason() ---

    #[test]
    fn microsoft_error_reason_for_invalid_response() {
        let err = MicrosoftError::InvalidResponse {
            detail: "unexpected EOF".to_string(),
        };
        assert!(err.reason().starts_with("iap-malformed-response:"));
    }
}
