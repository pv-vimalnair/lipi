//! Wire-shape tests for the Phase 5a IPC surface:
//! `secrets_set_api_key`, `secrets_has_api_key`,
//! `secrets_delete_api_key`, `ai_list_providers`,
//! `ai_get_configured_providers`. The Rust commands
//! take primitives, so the "shape" is the JSON
//! serialisation of the return values:
//!   - `ProviderInfo` is camelCase and includes
//!     `id`, `displayName`, `defaultModel`, etc.
//!   - `secrets_has_api_key` returns a bare `bool`.
//!   - `ai_get_configured_providers` returns
//!     `Vec<String>` of provider ids.
//!
//! We also assert that the secrets round-trip works
//! through the public `pub use`d functions (the same
//! surface the Tauri commands call). The Tauri commands
//! themselves are not exercised in tests (they need an
//! `AppHandle`), but their bodies are one-liners that
//! just forward to the same functions we test here.
//!
//! The mock keychain is installed by the secrets unit
//! tests. This file lives in `tests/` (integration
//! tests), so it gets its own crate and runs the lib
//! functions directly.

use std::sync::Once;

use keyring::mock::MockCredentialBuilder;
use lipi_lib::{ai_list_providers_rs, secrets_delete_rs, secrets_set_rs};

static INSTALL_MOCK: Once = Once::new();

fn install_mock() {
    INSTALL_MOCK.call_once(|| {
        let _ = keyring::set_default_credential_builder(Box::new(
            MockCredentialBuilder {},
        ));
    });
}

#[test]
fn provider_info_wire_shape_is_camel_case_and_complete() {
    let providers = ai_list_providers_rs();
    assert_eq!(providers.len(), 3);
    for p in &providers {
        let json = serde_json::to_value(p).unwrap();
        // Required camelCase fields per ProviderInfo.
        for key in [
            "id",
            "displayName",
            "openaiCompatibleBaseUrl",
            "anthropicCompatibleBaseUrl",
            "defaultModel",
            "availableModels",
            "description",
            "keyUrl",
        ] {
            assert!(
                json.get(key).is_some(),
                "ProviderInfo missing `{key}` field: {json}"
            );
        }
        // snake_case must NOT appear (would indicate a
        // missing `#[serde(rename_all = "camelCase")]`).
        for key in [
            "display_name",
            "openai_compatible_base_url",
            "anthropic_compatible_base_url",
            "default_model",
            "available_models",
            "key_url",
        ] {
            assert!(
                json.get(key).is_none(),
                "ProviderInfo should NOT have `{key}`: {json}"
            );
        }
        // `availableModels` is a JSON array of strings.
        let arr = json["availableModels"]
            .as_array()
            .expect("availableModels is an array");
        assert!(!arr.is_empty());
        for m in arr {
            assert!(m.is_string());
        }
    }
}

#[test]
fn provider_ids_are_openai_anthropic_openrouter() {
    let ids: Vec<String> = ai_list_providers_rs()
        .iter()
        .map(|p| p.id.to_string())
        .collect();
    assert_eq!(ids, vec!["openai", "anthropic", "openrouter"]);
}

#[test]
fn default_model_is_in_available_models_for_every_provider() {
    for p in ai_list_providers_rs() {
        assert!(
            p.available_models.contains(&p.default_model),
            "{}: default model `{}` not in available models {:?}",
            p.id,
            p.default_model,
            p.available_models
        );
    }
}

#[test]
fn secrets_round_trip_through_public_functions() {
    install_mock();
    // Use a unique provider per test.
    let provider = "openai";
    // The smoke test runs in the default (desktop) build
    // which uses the OS keyring (mocked above). Stronghold
    // snapshot_path is None -> ignored on desktop,
    // required on mobile (gated by the `mobile` feature).
    let snapshot: Option<&std::path::Path> = None;
    // Ensure clean state.
    let _ = secrets_delete_rs(provider, snapshot);

    // has -> false initially
    let entry = lipi_lib::secrets_has_rs(provider, snapshot).unwrap();
    assert!(!entry);

    // set
    secrets_set_rs(provider, "sk-test-1234", snapshot).unwrap();
    let entry = lipi_lib::secrets_has_rs(provider, snapshot).unwrap();
    assert!(entry);

    // get returns Some
    let got = lipi_lib::secrets_get_api_key_rs(provider, snapshot).unwrap();
    assert_eq!(got.as_deref(), Some("sk-test-1234"));

    // delete
    lipi_lib::secrets_delete_rs(provider, snapshot).unwrap();
    let entry = lipi_lib::secrets_has_rs(provider, snapshot).unwrap();
    assert!(!entry);
}

#[test]
fn secret_error_wire_shape_is_camel_case_with_kind_tag() {
    // Empty provider id is invalid — we can verify the
    // wire shape of SecretError directly via
    // serde_json::to_value. snapshot_path is None
    // (desktop build uses the OS keyring, mocked above).
    let err = lipi_lib::secrets_set_rs("", "x", None).unwrap_err();
    let json = serde_json::to_value(&err).unwrap();
    // SecretError is `#[serde(tag = "kind")]`. The TS
    // side reads `payload.kind` and `payload.detail`.
    assert_eq!(json["kind"], "invalidInput");
    // The Rust side uses a struct-like variant with a
    // `detail: String` field; the rename_all = "camelCase"
    // doesn't touch the field name (it's already
    // single-word), so the wire field is `detail`.
    assert!(
        json["detail"].is_string(),
        "expected a `detail` string field: {json}"
    );
}

#[test]
fn ai_get_configured_providers_includes_any_provider_with_a_key() {
    install_mock();
    // The mock keychain is process-global; we cannot
    // assert the exact set (other tests may have
    // configured providers in parallel). Instead,
    // set a unique key, then verify the result
    // contains at least that provider.
    let provider = "openai";
    lipi_lib::secrets_set_rs(provider, "sk-test-5a", None).unwrap();
    let configured: Vec<String> = lipi_lib::ai_get_configured_providers_rs(None)
        .iter()
        .map(|s| s.to_string())
        .collect();
    assert!(
        configured.contains(&provider.to_string()),
        "expected `{provider}` in configured list, got {configured:?}"
    );
    // Every entry is a known provider id.
    for id in &configured {
        assert!(
            ["openai", "anthropic", "openrouter"].contains(&id.as_str()),
            "unknown provider id in configured list: `{id}`"
        );
    }
}
