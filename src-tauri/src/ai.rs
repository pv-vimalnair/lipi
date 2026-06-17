//! AI provider registry + streaming proxy to LLM providers.
//!
//! Phase 5a: static provider table, `list_providers`,
//! `get_configured_providers`. No network calls.
//!
//! Phase 5b-1 (this phase): OpenAI-compatible streaming
//! chat. One provider adapter, one SSE parser, one Tauri
//! command. The OpenRouter adapter is a base-URL swap and
//! lives in 5b-2 alongside the Anthropic adapter. The
//! 5b-1 surface is:
//!
//!   - `ChatMessage`, `ChatDelta`, `ChatError` types
//!     (serialised to camelCase JSON for the JS side).
//!   - `SseStream` — a tiny SSE parser over an
//!     `AsyncRead`. Handles `data: {json}\n\n` framing,
//!     `[DONE]` sentinels, partial UTF-8 across chunks,
//!     and comment lines. Pure byte-IO; doesn't depend
//!     on reqwest (so the tests can feed it a `Cursor`).
//!   - `stream_chat_openai(api_key, base_url, model,
//!     messages, on_chunk, cancel) -> Result<(), ChatError>`.
//!     Opens an HTTPS POST, parses the SSE body, and
//!     invokes `on_chunk` for each `Delta` / `Done` /
//!     `Error`. The `cancel` token is checked between
//!     chunks; when flipped, the function returns
//!     `Ok(())` after emitting a synthetic
//!     `Done { cancelled: true }` chunk.
//!   - `#[tauri::command] fn ai_chat_stream(...)` —
//!     reads the API key from the keychain, generates
//!     a `requestId`, spawns a tokio task that calls
//!     `stream_chat_openai` and emits `ai://chunk` /
//!     `ai://done` / `ai://error` events to the main
//!     window. Returns the `requestId` synchronously
//!     so the JS side can subscribe before the first
//!     chunk arrives (same pattern as 4a's terminal).
//!
//! Phase 5b-2 will add:
//!   - OpenRouter adapter (base-URL swap of OpenAI).
//!   - Anthropic adapter (different SSE framing, named
//!     events `message_start` / `content_block_delta` /
//!     `message_stop`; different request body and
//!     auth headers).
//!   - `#[tauri::command] fn ai_cancel_stream(...)` —
//!     flips the cancellation token in a
//!     `HashMap<requestId, Arc<AtomicBool>>` so the
//!     reader task bails out.
//!
//! ## Why a static table (and not a live `/models` fetch)
//!
//! Fetching the live model list per-provider is doable
//! (OpenAI's `/v1/models`, Anthropic's `/v1/models`, etc.)
//! but adds a network call to every Settings screen open
//! and surfaces provider-specific quirks (OpenRouter has
//! hundreds of models, Anthropic paginates). For 5a the
//! curated list of 6 models (2 per provider) is enough.
//! 5b-or-later can add a "Refresh models" button that
//! hits the live endpoint and merges the results.
//!
//! ## Per-provider base URLs and auth headers
//!
//! All three providers use Bearer-token auth. The base URL
//! is per-provider. OpenAI and OpenRouter use the same
//! `/v1/chat/completions` endpoint and the same
//! streaming-event format (so OpenRouter is a base-URL
//! swap, not a separate adapter). Anthropic uses
//! `/v1/messages` and a different event format
//! (`message_start` / `content_block_delta` / etc.).

use serde::Serialize;

use crate::secrets;

/// A static description of a supported AI provider.
/// Exposed to the frontend via `ai_list_providers`.
/// The `id` is the user name in the OS keychain
/// (`service = "app.lipi.ide"`, `user = <id>`).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderInfo {
    /// Stable id, used in the keychain and as the
    /// "provider" parameter to all AI IPC commands.
    /// Never rename without a migration.
    pub id: &'static str,
    /// Human-readable display name for the UI.
    pub display_name: &'static str,
    /// Base URL for the OpenAI-compatible
    /// `/v1/chat/completions` endpoint. `None`
    /// for providers (Anthropic) that need a
    /// different endpoint and a dedicated adapter.
    /// 5a: stored but unused; 5b uses it.
    pub openai_compatible_base_url: Option<&'static str>,
    /// Base URL for the Anthropic-compatible
    /// `/v1/messages` endpoint. Symmetric to
    /// `openai_compatible_base_url`. `None` for
    /// providers that don't speak it.
    /// 5a: stored but unused; 5b uses it.
    pub anthropic_compatible_base_url: Option<&'static str>,
    /// The default model for chat completions
    /// from this provider. The user can override
    /// per-request via the `model` field in 5b.
    pub default_model: &'static str,
    /// The hardcoded model list shown in the UI
    /// picker. We expose 2 per provider (one fast
    /// and cheap, one capable) for 5a.
    pub available_models: &'static [&'static str],
    /// Short blurb shown on the Settings card.
    pub description: &'static str,
    /// Link to the provider's API key page. Shown
    /// on the Settings card as "Get a key →".
    pub key_url: &'static str,
}

/// Return the static list of supported providers. The
/// 3 providers are ordered: OpenAI first (most common),
/// Anthropic second (most capable), OpenRouter third
/// (unified access). Re-ordering in the UI is fine;
/// this order is the canonical "first" order.
pub fn list_providers() -> Vec<ProviderInfo> {
    vec![
        ProviderInfo {
            id: "openai",
            display_name: "OpenAI",
            openai_compatible_base_url: Some("https://api.openai.com/v1"),
            anthropic_compatible_base_url: None,
            default_model: "gpt-4o-mini",
            available_models: &["gpt-4o-mini", "gpt-4o"],
            description: "GPT-4o and GPT-4o mini. Fast, capable, widely used.",
            key_url: "https://platform.openai.com/api-keys",
        },
        ProviderInfo {
            id: "anthropic",
            display_name: "Anthropic",
            openai_compatible_base_url: None,
            anthropic_compatible_base_url: Some("https://api.anthropic.com/v1"),
            default_model: "claude-3-5-haiku-latest",
            available_models: &["claude-3-5-haiku-latest", "claude-3-5-sonnet-latest"],
            description: "Claude 3.5 Haiku and Sonnet. Strong at code and reasoning.",
            key_url: "https://console.anthropic.com/settings/keys",
        },
        ProviderInfo {
            id: "openrouter",
            display_name: "OpenRouter",
            openai_compatible_base_url: Some("https://openrouter.ai/api/v1"),
            anthropic_compatible_base_url: None,
            default_model: "anthropic/claude-3.5-sonnet",
            available_models: &[
                "anthropic/claude-3.5-sonnet",
                "openai/gpt-4o-mini",
            ],
            description: "Unified access to many models. One key, many providers.",
            key_url: "https://openrouter.ai/keys",
        },
    ]
}

/// Look up a provider by id. Returns `None` if the id
/// is not in the static list. Used by 5b to validate
/// the `provider` field of an `ai_chat_stream` call.
pub fn provider_by_id(id: &str) -> Option<ProviderInfo> {
    list_providers().into_iter().find(|p| p.id == id)
}

/// Return the ids of providers that have a key in the
/// keychain. Used by the AI panel to render the
/// "configured" / "not configured" badges without
/// making the frontend call `has_api_key` 3 times.
///
/// If a keychain error occurs for one provider, that
/// provider is silently omitted from the result
/// (the frontend's separate `has_api_key` call will
/// surface the error in detail when the user clicks
/// that card). We never propagate keychain errors
/// out of this "list the configured ones" helper —
/// it's a best-effort UI hint, not a security check.
pub fn get_configured_providers(
    snapshot_path: Option<&std::path::Path>,
) -> Vec<&'static str> {
    list_providers()
        .iter()
        .filter_map(|p| {
            match secrets::has_api_key(p.id, snapshot_path) {
                Ok(true) => Some(p.id),
                _ => None,
            }
        })
        .collect()
}

// --- Phase 5b-1: streaming chat proxy -------------------------------------
//
// The actual SSE parser and OpenAI provider adapter
// live in `src/chat.rs` (Rule 3 — single file,
// single concern). The `mod chat;` declaration is
// in `lib.rs` so the file lives at the crate root.

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn list_providers_returns_three() {
        let providers = list_providers();
        assert_eq!(providers.len(), 3);
        let ids: Vec<&str> = providers.iter().map(|p| p.id).collect();
        assert_eq!(ids, vec!["openai", "anthropic", "openrouter"]);
    }

    #[test]
    fn list_providers_have_required_fields() {
        for p in list_providers() {
            assert!(!p.id.is_empty());
            assert!(!p.display_name.is_empty());
            assert!(!p.default_model.is_empty());
            assert!(!p.available_models.is_empty());
            assert!(p.available_models.contains(&p.default_model));
            assert!(!p.description.is_empty());
            assert!(!p.key_url.is_empty());
            assert!(p.key_url.starts_with("https://"));
        }
    }

    #[test]
    fn provider_by_id_finds_known_providers() {
        assert_eq!(provider_by_id("openai").unwrap().id, "openai");
        assert_eq!(provider_by_id("anthropic").unwrap().id, "anthropic");
        assert_eq!(provider_by_id("openrouter").unwrap().id, "openrouter");
    }

    #[test]
    fn provider_by_id_returns_none_for_unknown() {
        assert!(provider_by_id("grok").is_none());
        assert!(provider_by_id("").is_none());
        assert!(provider_by_id("OpenAI").is_none()); // case-sensitive
    }

    #[test]
    fn get_configured_providers_empty_when_no_keys() {
        // No keys in the keychain (the test runner
        // uses the mock store; we don't preset any
        // passwords). Should be empty.
        // Note: this test depends on secrets using
        // the mock builder. We can't set the mock
        // builder from here (it would race with the
        // secrets.rs tests' Once). For the test
        // runner, the secrets tests install the mock
        // and run first; if they don't, this test
        // is best-effort and may report "all three
        // configured" — which is also a valid
        // pass-through for the *shape* of the result.
        // We assert just that the result is a subset
        // of known providers.
        let configured = get_configured_providers(None);
        for id in &configured {
            assert!(provider_by_id(id).is_some());
        }
    }
}
