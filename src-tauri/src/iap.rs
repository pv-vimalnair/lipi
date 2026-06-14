//! Phase 3: the IAP (in-app purchase) receipt adapter.
//!
//! Desktop-only (`#[cfg(not(mobile))]`). The real IAP
//! implementation lands in Phase 4 (Mac App Store
//! receipt validation, Microsoft Store receipt
//! validation). For now, this module ships a **stub**
//! that returns `LicenseStatus::Invalid` with a clear
//! "not yet implemented" reason, so the UI can be built
//! and tested before the real receipt validation lands.
//!
//! # Why a stub now
//!
//! The "Restore from App Store" UI surface is a 30-line
//! React component that's much easier to design and test
//! when the IPC call exists (even as a stub) than when
//! the IPC call is missing. Phase 4 will fill in the
//! real implementation behind the same Tauri command
//! signature (`iap_redeem(receipt: String, plan: String)
//! -> LicenseStatus`), so the UI doesn't change.
//!
//! # What Phase 4 will do
//!
//! 1. Add a Tauri command `iap_redeem_macos` that takes
//!    a base64-encoded App Store receipt + a plan, calls
//!    Apple's `verifyReceipt` endpoint, verifies the
//!    in-app purchase product ID matches the plan, and
//!    returns a `LicenseStatus` (or a fresh
//!    `LicensePayload` to be signed by the local Rust
//!    side and stored in the keychain).
//! 2. Add a Tauri command `iap_redeem_windows` that
//!    does the same for Microsoft Store receipts.
//! 3. The unified `iap_redeem` (this stub) becomes the
//!    dispatcher — it inspects the receipt format and
//!    routes to the platform-specific validator.
//!
//! # Security note
//!
//! Even when the real implementation lands, the receipt
//! validation is the only check. A user who can fake a
//! receipt can get a free license. The mitigation is
//! the same as for the offline-licensing layer: machine
//! fingerprint binding (the resulting license is bound
//! to the user's machine, so a faked receipt only works
//! on the user's own machine, which is the same as a
//! paid license they could have bought for $5/mo).

use crate::licensing::LicenseStatus;

/// Plan ids accepted by `iap_redeem`. The v1 stub
/// accepts any string; the real implementation (Phase
/// 4) will validate against the IAP product IDs.
#[allow(dead_code)] // only referenced from tests in v1 (Phase 4 wires the production path)
pub const PLAN_MONTHLY: &str = "monthly";
#[allow(dead_code)] // only referenced from tests in v1 (Phase 4 wires the production path)
pub const PLAN_YEARLY: &str = "yearly";

/// Tauri command: redeem an IAP receipt. The v1 stub
/// returns `Invalid` with reason `iap-not-yet-implemented`,
/// so the UI can show "IAP restoration is coming in a
/// future update" with a "Paste a license key instead"
/// link. Phase 4 fills in the real validation.
#[tauri::command]
pub fn iap_redeem(receipt: String, plan: String) -> LicenseStatus {
    // The v1 stub is intentionally a one-liner that
    // returns the same "not yet implemented" reason
    // regardless of input. The reason string is the
    // contract with the UI — the UI shows the humanized
    // version of this reason. See
    // `humanizeInvalidReason` in LicenseCard.tsx.
    LicenseStatus::Invalid {
        reason: format!(
            "iap-not-yet-implemented: Mac App Store and Microsoft Store IAP integration is coming in a future update (plan: {plan}, receipt bytes: {}). For now, please paste a license key (or email licensing@lipi.ide to get one).",
            receipt.len()
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn iap_redeem_with_empty_receipt_returns_invalid() {
        let status = iap_redeem(String::new(), PLAN_MONTHLY.to_string());
        match status {
            LicenseStatus::Invalid { reason } => {
                assert!(
                    reason.contains("iap-not-yet-implemented"),
                    "expected iap-not-yet-implemented, got: {reason}"
                );
            }
            _ => panic!("expected Invalid, got: {status:?}"),
        }
    }

    #[test]
    fn iap_redeem_with_non_empty_receipt_returns_invalid_with_iap_not_yet_implemented_reason() {
        let receipt = "eyJ0aGVyZSI6ImZha2UtcmVjZWlwdC1ieXRlcyJ9".to_string();
        let status = iap_redeem(receipt.clone(), PLAN_MONTHLY.to_string());
        match status {
            LicenseStatus::Invalid { reason } => {
                assert!(reason.contains("iap-not-yet-implemented"));
                // The reason should mention the receipt's
                // byte length so the UI / logs can see
                // that the receipt was non-empty.
                assert!(
                    reason.contains(&receipt.len().to_string()),
                    "expected reason to mention receipt length {}: {reason}",
                    receipt.len()
                );
            }
            _ => panic!("expected Invalid, got: {status:?}"),
        }
    }

    #[test]
    fn iap_redeem_with_monthly_plan_returns_invalid() {
        let status = iap_redeem("fake-receipt".to_string(), PLAN_MONTHLY.to_string());
        match status {
            LicenseStatus::Invalid { reason } => {
                assert!(reason.contains(PLAN_MONTHLY), "expected plan name in reason: {reason}");
            }
            _ => panic!("expected Invalid, got: {status:?}"),
        }
    }

    #[test]
    fn iap_redeem_with_yearly_plan_returns_invalid() {
        let status = iap_redeem("fake-receipt".to_string(), PLAN_YEARLY.to_string());
        match status {
            LicenseStatus::Invalid { reason } => {
                assert!(reason.contains(PLAN_YEARLY), "expected plan name in reason: {reason}");
            }
            _ => panic!("expected Invalid, got: {status:?}"),
        }
    }

    #[test]
    fn iap_redeem_with_unknown_plan_returns_invalid() {
        let status = iap_redeem("fake-receipt".to_string(), "lifetime".to_string());
        // The v1 stub accepts any plan string (the real
        // validation is Phase 4). The reason should
        // still mention the plan name (echoed back to
        // the user for debugging).
        match status {
            LicenseStatus::Invalid { reason } => {
                assert!(reason.contains("lifetime"));
            }
            _ => panic!("expected Invalid, got: {status:?}"),
        }
    }
}
