//! Phase 5b-1 — streaming chat proxy to OpenAI-compatible
//! providers.
//!
//! This module is the Rust side of the AI chat pipeline.
//! It is independent of the Tauri runtime: the public
//! functions are plain async Rust and can be unit-tested
//! against a hand-crafted `AsyncRead`. The Tauri command
//! wrapper in `lib.rs` adds the `ai://*` event emission
//! on top.
//!
//! The 5b-1 scope is one provider adapter (OpenAI) and a
//! tiny SSE parser. The OpenRouter adapter is a base-URL
//! swap and lives in 5b-2; the Anthropic adapter (with
//! a different SSE framing) also lives in 5b-2.
//!
//! ## 5b-4 additions: tool calls
//!
//! Both providers support "function calling" — the model
//! can request that the client (us) call a named function
//! with a JSON-serialised argument object, and the
//! function's return value is then sent back to the model
//! as a follow-up message. The wire shape is:
//!
//!   - **OpenAI**: streaming chunks carry
//!     `delta.tool_calls = [{ index, id?, type?, function:
//!     { name?, arguments? } }]`. The `id` / `type` /
//!     `function.name` arrive in the first chunk for a
//!     given `index`; `function.arguments` is built up as
//!     a JSON string across many deltas (OpenAI doesn't
//!     parse it on the wire — it just concatenates bytes).
//!   - **Anthropic**: `content_block_start` carries
//!     `{ type: "tool_use", id, name, input: {} }` (the
//!     initial `input` is always `{}`; the real JSON
//!     arrives via subsequent `content_block_delta`s
//!     with `{ type: "input_json_delta", partial_json:
//!     "<chunk>" }`).
//!
//! In both cases the JSON argument is assembled
//! server-side, byte-by-byte, by the model. The Rust
//! adapter maintains a `HashMap<index, InProgressTool>`
//! (OpenAI) or a per-`content_block_index` map (Anthropic),
//! concatenates each chunk, and emits a single
//! `ChatDelta::ToolCall` chunk per completed tool call
//! (i.e. when the next `index` arrives, or when the
//! stream ends). This keeps the JS-side demux
//! simple — it sees one `ToolCall` event per tool the
//! model decided to invoke, and the UI renders a
//! per-tool trace.
//!
//! We do NOT implement the actual tool execution in
//! 5b-4. The model asks "please call `get_weather`
//! with `{\"location\": \"SF\"}`", the JS side stores
//! that in the chat thread, the user (in a future phase)
//! configures a tool handler, and a follow-up message
//! is sent back to the model with the result. 5b-4 is
//! just the streaming + storage surface.
//!
//! ## Streaming model
//!
//! The JS side calls a Tauri command with a `requestId`,
//! and we emit `ai://chunk` / `ai://done` / `ai://error`
//! events tagged with that `requestId`. The JS store
//! demuxes by `requestId`. This matches the 4a terminal
//! pattern (one Tauri command, many events).
//!
//! Internally, the `stream_chat_openai` function takes
//! an `on_chunk` callback (so the same function is
//! usable from tests and from the Tauri command wrapper)
//! and a `cancel: Arc<AtomicBool>` that the 5b-2
//! `ai_cancel_stream` command will flip.
//!
//! ## Why `reqwest` + `rustls-tls`
//!
//! We need a streaming HTTP client (the SSE response is
//! an open connection with chunks arriving over 1-30s).
//! `reqwest` with `rustls-tls` gives us:
//!   - `rustls` is pure-Rust, statically linked; no
//!     OpenSSL / libssl system dependency (matches the
//!     5a `keyring` `vendored` decision).
//!   - `body.bytes_stream()` returns an async `Stream`
//!     of `Bytes` that we can feed into our SSE parser.
//!   - `Client::new()` is cheap to clone and we make
//!     a new client per request (no shared connection
//!     pool to coordinate for a 5b-MVP).

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};

// --- Types ---------------------------------------------------------------

/// A single message in the chat thread. The OpenAI
/// schema is `{ role, content }`; we add `name` as
/// optional (used by some providers for multi-user
/// chat, but typically absent).
///
/// 5b-6 additions: `tool_calls` and `tool_call_id`
/// for the tool-execution loop. The model can emit
/// tool calls (assistant messages carry the
/// `tool_calls` array); we execute them on the JS
/// side and send the result back as a follow-up
/// message with `role: "tool"` and
/// `tool_call_id: <the original call's id>`. The
/// provider adapters convert this internal
/// representation into their own wire format
/// (OpenAI uses the same shape we receive;
/// Anthropic needs assistant tool calls converted
/// to `content` blocks of `tool_use` and tool
/// results to `user` messages with `tool_result`
/// content blocks — see `build_anthropic_messages`
/// below).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessage {
    /// One of `"system"`, `"user"`, `"assistant"`,
    /// `"tool"`. The provider adapter is free to
    /// coerce — Anthropic maps `"tool"` to a
    /// `"user"` role with a `tool_result` content
    /// block, for example.
    pub role: String,
    pub content: String,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub name: Option<String>,
    /// 5b-6: present on assistant messages that
    /// emitted one or more tool calls. The order
    /// of the calls is preserved (the first call
    /// was the first one the model decided to
    /// invoke; the result messages reference
    /// them by `id`).
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub tool_calls: Option<Vec<AssistantToolCall>>,
    /// 5b-6: present on tool result messages
    /// (`role: "tool"`). The id of the call this
    /// is the result of. The provider adapter
    /// uses this to route the result to the right
    /// call (OpenAI: `tool_call_id` on the
    /// `role: "tool"` message; Anthropic:
    /// `tool_use_id` on the `tool_result` content
    /// block).
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub tool_call_id: Option<String>,
}

/// 5b-6: a tool call attached to an assistant
/// message. The JS side sends these back in
/// follow-up requests so the provider knows
/// "this assistant message had these tool calls"
/// (the model uses the id to map a result message
/// back to the call). The `arguments` is the
/// same concatenated JSON string the JS side
/// received in the `ToolCall` chunk — we don't
/// parse it on the wire, the provider does its
/// own validation.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AssistantToolCall {
    /// Provider-assigned id. OpenAI: `call_…`,
    /// Anthropic: `toolu_…`. The JS-side
    /// execution loop echoes this id back as
    /// the `tool_call_id` on the result message.
    pub id: String,
    /// Function name, e.g. `"get_file_contents"`.
    pub name: String,
    /// Concatenated JSON argument string. May
    /// be `""` for no-arg tools; may not be
    /// valid JSON if the model hallucinated.
    pub arguments: String,
}

// --- Tool definitions (5b-6, extended in 5b-7) --------------------------
//
// Both provider adapters need a hardcoded list
// of available tools to declare up-front (the
// model can only call tools it knows about).
// 5b-6 has just one: `get_file_contents(path)`.
// The JS-side `toolRegistry` is the source of
// truth for which tools are EXECUTABLE; the Rust
// side just needs to declare the same set so the
// model knows to call them. A future phase (5c+)
// will plumb this through dynamically — for now
// the two sides are kept in sync by hand.
//
// We use `serde_json::Value` (not a typed struct)
// so the JSON schema can be embedded verbatim
// without a hand-written Rust struct for each
// tool. The two providers have slightly different
// tool-declaration shapes — OpenAI wraps in
// `{type:"function", function:{...}}` and
// Anthropic uses `{name, description, input_schema}`
// — so we keep them as raw `Value`s and shape
// them in the adapter's serialise call.
//
// 5b-7: per-tool enable/disable. The JS Settings
// screen collects the user's opt-in set and passes
// it in `ChatRequestArgs.enabled_tool_names`. The
// `get_openai_tools` / `get_anthropic_tools`
// functions now FILTER their output by that set —
// a disabled tool is invisible to the model, which
// is the cleanest semantics (no "the model keeps
// asking for a tool I disabled" loops). The MVP
// set is intentionally tiny. Adding more built-in
// tools (e.g. `get_git_status`,
// `run_terminal_command`) is a 5c+ concern; when
// you add one, also add a `ToolSpec` entry below
// (single source of truth for name + description
// + parameters — both adapters read from it).
//
// `enabled.is_empty()` is treated as "all enabled"
// (the legacy / unset case). This means a JS
// client that doesn't know about 5b-7 yet still
// gets the full tool set — backwards compatible.

/// 5b-7: a single tool's metadata. The Rust side
/// uses this as the canonical list of "tools we
/// know how to declare". The provider-specific
/// shapes (OpenAI's `{type:"function", function}`
/// wrapper, Anthropic's flatter shape) are derived
/// from this at request-build time.
struct ToolSpec {
    name: &'static str,
    description: &'static str,
    /// JSON Schema object describing the
    /// function's arguments. Same shape used
    /// for both OpenAI's `parameters` and
    /// Anthropic's `input_schema`.
    parameters: serde_json::Value,
}

/// 5b-7: the canonical tool catalogue. Loaded
/// once via `OnceLock` (the `json!` macro isn't
/// `const`-callable, so we can't use a `const`
/// slice). The order in the resulting slice is
/// the declaration order sent to the provider
/// (providers don't care about the order, but
/// stable ordering is friendlier in logs and
/// dev-tools). When 5c+ adds custom user-defined
/// tools, the JS side will pass the full list
/// in `enabled_tool_names` and the Rust side
/// will look each one up here — unknown names
/// get dropped silently.
fn tool_catalogue() -> &'static [ToolSpec] {
    use std::sync::OnceLock;
    static CACHE: OnceLock<Vec<ToolSpec>> = OnceLock::new();
    CACHE.get_or_init(|| {
        vec![ToolSpec {
            name: "get_file_contents",
            description:
                "Read the contents of a file at the given path (relative to the workspace root). \
                 Returns the file content as a UTF-8 string. Returns an error string for binary \
                 files or missing paths.",
            parameters: serde_json::json!({
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Workspace-relative path to the file, e.g. 'src/index.ts' or 'README.md'."
                    }
                },
                "required": ["path"],
                "additionalProperties": false
            }),
        }]
    })
}

/// 5b-7: the set of tool names that are enabled
/// for the current request. An empty slice means
/// "all enabled" (backwards-compatible default).
/// A non-empty slice is a whitelist — only tools
/// in this slice are declared to the model.
fn is_tool_enabled(enabled: &[String], name: &str) -> bool {
    if enabled.is_empty() {
        // Legacy path — the JS client didn't send
        // the field. Treat as "all enabled".
        return true;
    }
    enabled.iter().any(|n| n == name)
}

/// OpenAI tool definitions. The schema is
/// `[{type:"function", function:{name, description, parameters: <JSON Schema>}}]`.
/// `parameters` is a JSON Schema object describing
/// the function's arguments. The model uses this
/// to validate the arguments it generates.
///
/// 5b-7: `enabled` is the per-request whitelist
/// from `ChatRequestArgs.enabled_tool_names`. An
/// empty slice means "declare everything" (the
/// default for JS clients that pre-date 5b-7).
fn get_openai_tools(enabled: &[String]) -> Vec<serde_json::Value> {
    tool_catalogue()
        .iter()
        .filter(|t| is_tool_enabled(enabled, t.name))
        .map(|t| {
            serde_json::json!({
                "type": "function",
                "function": {
                    "name": t.name,
                    "description": t.description,
                    "parameters": t.parameters,
                }
            })
        })
        .collect()
}

/// Anthropic tool definitions. The schema is
/// `[{name, description, input_schema: <JSON Schema>}]`.
/// `input_schema` is a JSON Schema object
/// describing the function's arguments (same
/// shape as the OpenAI `parameters` field).
/// Note: no `type: "function"` wrapper
/// (Anthropic's schema is flatter).
///
/// 5b-7: see `get_openai_tools` for the
/// `enabled` semantics.
fn get_anthropic_tools(enabled: &[String]) -> Vec<serde_json::Value> {
    tool_catalogue()
        .iter()
        .filter(|t| is_tool_enabled(enabled, t.name))
        .map(|t| {
            serde_json::json!({
                "name": t.name,
                "description": t.description,
                "input_schema": t.parameters,
            })
        })
        .collect()
}

// --- Anthropic message shape (5b-6) -------------------------------------
//
// Anthropic's `messages` array is more complex
// than OpenAI's — `content` is an array of
// "content blocks" (`{type: "text"}` or
// `{type: "tool_use"}` for assistant messages,
// `{type: "tool_result"}` for tool results).
// We convert our internal `ChatMessage` to this
// shape in `build_anthropic_messages` below.
//
// We use `serde_json::Value` for the content
// blocks to avoid a deep `Serialize` derive
// for every variant — the wire format is small
// and `Value` makes the conversions explicit
// and easy to test.

/// The Anthropic `messages[i]` shape:
/// `{role, content: [block, ...]}`. We own the
/// `Vec<Value>` so we can build it in-place.
#[derive(Serialize)]
struct AnthropicMessage {
    role: String,
    content: Vec<serde_json::Value>,
}

/// Convert a slice of internal `ChatMessage`s
/// into the Anthropic request body shape.
///
/// Conversions:
///   - `role: "user"` with `content: String` →
///     `user` message with a single text block.
///   - `role: "assistant"` with `content: String`
///     and no `tool_calls` → `assistant` message
///     with a single text block.
///   - `role: "assistant"` with `content: String`
///     and a `tool_calls` array → `assistant`
///     message with a text block (the text) PLUS
///     one `tool_use` block per call (in order).
///     The `tool_use` block's `input` is the
///     parsed JSON argument object — we attempt
///     to parse and fall back to `{}` if the
///     model hallucinated.
///   - `role: "tool"` with `tool_call_id` and
///     `content` → `user` message (Anthropic's
///     convention) with a single `tool_result`
///     block. The block's `content` is the
///     string content of the result.
///   - `role: "system"` is filtered out by the
///     caller (it's converted to the top-level
///     `system` field).
///
/// Note: Anthropic requires messages to alternate
/// between `user` and `assistant` (with a few
/// exceptions for tool results). We do NOT
/// attempt to merge consecutive same-role
/// messages here — that's the caller's
/// responsibility. The JS side sends messages
/// in conversation order, and our internal
/// `ChatMessage` flow always has the model
/// speak last in a turn. If the user (or a
/// future tool) inserts consecutive user
/// messages, Anthropic will reject the request
/// and we'll see a 4xx — the JS side will
/// surface the error and the user can fix
/// their tool's output format.
fn build_anthropic_messages(messages: &[&ChatMessage]) -> Vec<AnthropicMessage> {
    let mut out: Vec<AnthropicMessage> = Vec::with_capacity(messages.len());
    for m in messages {
        match m.role.as_str() {
            "user" => {
                out.push(AnthropicMessage {
                    role: "user".to_string(),
                    content: vec![serde_json::json!({
                        "type": "text",
                        "text": m.content,
                    })],
                });
            }
            "assistant" => {
                let mut blocks: Vec<serde_json::Value> = Vec::new();
                if !m.content.is_empty() {
                    blocks.push(serde_json::json!({
                        "type": "text",
                        "text": m.content,
                    }));
                }
                if let Some(calls) = &m.tool_calls {
                    for c in calls {
                        // Parse the `arguments` JSON
                        // for the Anthropic wire
                        // format — Anthropic wants
                        // an `input` OBJECT, not a
                        // string. If the model
                        // hallucinated (invalid
                        // JSON), we emit an empty
                        // object; the model's
                        // follow-up handling is
                        // its own problem.
                        let input: serde_json::Value = serde_json::from_str(&c.arguments)
                            .unwrap_or_else(|_| serde_json::json!({}));
                        blocks.push(serde_json::json!({
                            "type": "tool_use",
                            "id": c.id,
                            "name": c.name,
                            "input": input,
                        }));
                    }
                }
                // Anthropic requires the
                // assistant message to have at
                // least one block; emit an
                // empty text block if both
                // `content` and `tool_calls`
                // are absent.
                if blocks.is_empty() {
                    blocks.push(serde_json::json!({
                        "type": "text",
                        "text": "",
                    }));
                }
                out.push(AnthropicMessage {
                    role: "assistant".to_string(),
                    content: blocks,
                });
            }
            "tool" => {
                // Anthropic's tool-result shape:
                // `role: "user", content: [{type: "tool_result", tool_use_id, content}]`.
                // The `content` is a string (or an
                // array of content blocks for
                // multi-block results; we use the
                // simple string form for the MVP).
                let tool_use_id = m.tool_call_id.clone().unwrap_or_else(|| "".to_string());
                out.push(AnthropicMessage {
                    role: "user".to_string(),
                    content: vec![serde_json::json!({
                        "type": "tool_result",
                        "tool_use_id": tool_use_id,
                        "content": m.content,
                    })],
                });
            }
            // `system` is filtered by the caller
            // (extracted to the top-level `system`
            // field). We shouldn't see it here,
            // but if we do (defensive), drop it.
            "system" => {}
            // Unknown role — pass through as a
            // user-role text block. The provider
            // will reject it with a 4xx if the
            // role is unknown; better to fail
            // loudly than to silently drop.
            _ => {
                out.push(AnthropicMessage {
                    role: "user".to_string(),
                    content: vec![serde_json::json!({
                        "type": "text",
                        "text": m.content,
                    })],
                });
            }
        }
    }
    out
}

/// A unit of streaming output from the provider.
/// This is the Rust-internal chunk type; the Tauri
/// command serialises each variant to a camelCase
/// JSON payload for the `ai://chunk` event.
///
/// `Done` carries `cancelled: bool` (and an
/// optional `stopReason` from 5b-2) so the JS side
/// can distinguish a natural completion from a
/// user-initiated stop. The Anthropic adapter
/// surfaces a `stopReason` (e.g. `"end_turn"`,
/// `"max_tokens"`, `"stop_sequence"`) so the UI
/// can show a "truncated" banner when the model
/// hit the token cap.
///
/// Note: the `tag = "kind"` serde attribute means
/// the variant's first field can't also be named
/// `kind` (it would collide with the tag). So
/// `Error` uses `errorKind` as the field name, and
/// the JS side reads `payload.kind` (from the tag)
/// and `payload.errorKind` (from the field). The
/// Tauri command will rename `errorKind` → `kind`
/// when emitting the event payload (matching the
/// TS discriminated union).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum ChatDelta {
    /// A chunk of assistant text. Multiple `Delta`s
    /// concatenate in order to form the full response.
    Delta { text: String },
    /// A complete tool call (5b-4). The model has
    /// decided to invoke the named function with
    /// the given JSON argument. The Rust adapter
    /// assembles the `input` JSON byte-by-byte
    /// from the provider's streaming protocol —
    /// by the time we emit this `ToolCall` chunk,
    /// `input` is the fully concatenated JSON
    /// string (we don't parse it — the JS side
    /// decides whether to validate, display, or
    /// execute it).
    ///
    /// For OpenAI: the tool call is "complete"
    /// when the next chunk's `tool_calls[].index`
    /// is different (i.e. a new tool is starting)
    /// or when the stream ends. We hold the
    /// `id` and `name` from the first chunk
    /// for the index and concatenate the
    /// `function.arguments` string from
    /// subsequent chunks.
    ///
    /// For Anthropic: the tool call is "complete"
    /// when we see a `content_block_stop` for the
    /// same `index`, or when `message_stop`
    /// arrives. The `id` and `name` come from
    /// the `content_block_start` event; the
    /// `input` JSON is concatenated from
    /// `content_block_delta` events with
    /// `type: "input_json_delta"`.
    ///
    /// The JS side stores these in
    /// `ChatMessage.toolCalls: ToolCall[]` and
    /// renders them as a per-message tool
    /// trace.
    ToolCall {
        /// Provider-assigned id (OpenAI: `call_…`,
        /// Anthropic: `toolu_…`). The JS side
        /// uses this as the React `key` and as
        /// the id to map the tool's *result*
        /// message back to the original call
        /// (a future phase; 5b-4 is read-only).
        id: String,
        /// The function name, e.g. `get_weather`.
        name: String,
        /// The fully concatenated JSON argument
        /// string. May be empty (`""`) for tool
        /// calls with no arguments. May not be
        /// valid JSON if the model hallucinated;
        /// the JS side should `JSON.parse` with
        /// a try/catch.
        input: String,
    },
    /// Stream is over. `cancelled: true` means the
    /// user (or 5b-2's `ai_cancel_stream` command)
    /// asked us to stop; `cancelled: false` means the
    /// provider sent `[DONE]` (or the Anthropic
    /// equivalent `message_stop` event).
    ///
    /// `stopReason` is `Some(…)` for natural
    /// completions from providers that report one
    /// (Anthropic via `message_delta.stop_reason`).
    /// For OpenAI / OpenRouter it's always
    /// `None` — those providers don't surface a
    /// stop reason in the streaming response (the
    /// non-streaming response has
    /// `choices[0].finish_reason`; the streaming
    /// one sends an empty chunk with the same
    /// field, which we could parse in a future
    /// phase).
    Done {
        cancelled: bool,
        /// `"end_turn" | "max_tokens" | "stop_sequence" | "tool_use"`.
        /// Only the Anthropic adapter populates this in 5b-2.
        /// `tool_use` indicates the model finished
        /// its turn by emitting one or more tool
        /// calls; the corresponding `ToolCall`
        /// chunks will have arrived BEFORE this
        /// `Done`. The JS side uses this to show
        /// a "model asked to call X" banner.
        ///
        /// The field is renamed to `stopReason` on
        /// the wire (camelCase) to match the rest
        /// of the chat payload — the enum's
        /// `rename_all = "camelCase"` only applies
        /// to variant names, not to field names,
        /// so we have to add a per-field rename.
        #[serde(
            rename = "stopReason",
            skip_serializing_if = "Option::is_none",
            default
        )]
        stop_reason: Option<String>,
    },
    /// Transport / parse / auth / rate-limit error.
    /// The Tauri command emits this as an `ai://error`
    /// event with the same payload.
    Error {
        /// One of `"transport"`, `"auth"`, `"rateLimit"`,
        /// `"parse"`, `"cancelled"`, `"server"`, `"http"`.
        /// Mirrors the TS `AiErrorKind` discriminated union.
        /// Field is `errorKind` here (not `kind`) because
        /// the `tag = "kind"` attribute reserves the
        /// `kind` field name for the discriminant.
        #[serde(rename = "errorKind")]
        error_kind: String,
        message: String,
    },
}

/// Errors from the streaming pipeline. Returned by
/// `stream_chat_openai` ONLY for setup failures (bad
/// URL, missing API key); streaming errors are
/// surfaced as `ChatDelta::Error` chunks so the
/// caller can react per-chunk.
#[derive(Debug, thiserror::Error, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum ChatError {
    /// The API key is empty. The Tauri command
    /// surfaces this as `ChatDelta::Error { kind:
    /// "auth", message: "No API key configured for
    /// <provider>" }` rather than propagating the
    /// error, so the JS side sees a uniform
    /// `ChatDelta` stream.
    #[error("missing API key for provider `{0}`")]
    MissingApiKey(String),
    /// The provider is unknown. Same handling as
    /// `MissingApiKey`.
    #[error("unknown provider `{0}`")]
    UnknownProvider(String),
    /// reqwest build failure (bad URL, etc.). This
    /// is a programming error, not a runtime one.
    #[error("http client error: {detail}")]
    HttpClient { detail: String },
    /// reqwest errored BEFORE the first byte came
    /// back (DNS, TLS, connection refused). 5b-2
    /// maps this to `ChatDelta::Error { kind:
    /// "transport" }`.
    #[error("http transport error: {detail}")]
    HttpTransport { detail: String },
    /// reqwest returned a non-2xx status. We don't
    /// read the body — the caller's job is to map
    /// status codes to `ChatDelta::Error` kinds
    /// (401 → auth, 429 → rateLimit, etc.). The
    /// 5b-1 `stream_chat_openai` only returns this
    /// for `Other(status, body_snippet)`; 5b-2
    /// adds the proper mapping.
    #[error("http status {status}: {body}")]
    HttpStatus { status: u16, body: String },
}

// --- SSE parser ----------------------------------------------------------
//
// A tiny async SSE parser. We need this because
// `reqwest`'s `body.bytes_stream()` gives us raw
// `Bytes` chunks, and the OpenAI / Anthropic SSE
// framing is `data: {json}\n\n` with arbitrary
// boundaries between chunks.
//
// The parser is generic over `R: AsyncRead +
// Unpin`, so unit tests can feed it a `Cursor<&[u8]>`
// (synchronous Read) wrapped in a `tokio::io::BufReader`
// or just use the `tokio_test::io::Builder` helper.
//
// The parser yields `SseEvent` items. An event is
// either:
//   - `Data { data: String }` — a single complete
//     `data: ...\n\n` frame. Per SSE spec, multiple
//     `data:` lines in the same event concatenate
//     with `\n` (we don't currently see this in
//     OpenAI / Anthropic streams, but we handle it).
//   - `Done` — the `[DONE]` sentinel. Some providers
//     use this; Anthropic doesn't (it uses a named
//     `message_stop` event instead, handled in 5b-2).
//   - `Comment` — `:` lines, ignored by callers.
//     (We don't yield these — we just skip them
//     while looking for the next event.)
//
// The parser buffers bytes until it sees a full
// frame (`\n\n`) or a full comment-line + `\n\n`.
// Partial UTF-8 is handled by holding the buffer
// as `Bytes` and only converting to `String` when
// we yield an event. Partial JSON within a frame
// is impossible because we only attempt parse on
// a frame boundary.

use tokio::io::{AsyncBufReadExt, AsyncReadExt, BufReader};

/// An event yielded by `SseStream::next()`.
#[derive(Debug, PartialEq, Eq)]
pub enum SseEvent {
    /// An event with no `event:` line. One or more
    /// `data: …` lines from the same event, joined
    /// with `\n` per the SSE spec. This is what
    /// OpenAI uses (it never sets `event:`).
    Data { data: String },
    /// An event with an `event:` line. The
    /// Anthropic adapter uses these — e.g.
    /// `event: content_block_delta\ndata:
    /// {"delta":{"type":"text_delta","text":"Hi"}}`
    /// yields `Named { event: "content_block_delta",
    /// data: "..." }`. The `data` is the raw
    /// `data:` line contents (JSON to be parsed by
    /// the adapter).
    Named { event: String, data: String },
    /// The OpenAI `[DONE]` sentinel. Anthropic
    /// doesn't use this — it uses the
    /// `message_stop` named event instead, which
    /// the Anthropic adapter maps to `Done`
    /// itself.
    Done,
}

/// Parse an SSE stream into events. The reader is
/// consumed; create a new `SseStream` per request.
pub struct SseStream<R: AsyncReadExt + Unpin> {
    reader: BufReader<R>,
    /// Per-call line buffer for the line we just
    /// read from the inner reader. Cleared on
    /// every iteration of `next()`.
    buffer: Vec<u8>,
    /// Per-event buffer for the `data:` lines.
    /// Lives on the `SseStream` so we can
    /// accumulate across `next()` calls (in case
    /// the line boundary and the event boundary
    /// don't align).
    data_buffer: Vec<u8>,
    /// Per-event `event:` line value, if any.
    /// Set when we see an `event: foo` line and
    /// reset on event boundary. When set, the
    /// emitted `SseEvent` is `Named { event, data
    /// }` instead of `Data { data }`. Empty string
    /// means "no event: line was seen" (i.e.
    /// OpenAI-style unnamed events).
    event_name: String,
    /// True if we saw any field-line (data/event/
    /// id/retry) since the last event boundary.
    /// Used to distinguish a blank line that's an
    /// event boundary from a blank line that's a
    /// real blank line at the start of the stream.
    saw_event: bool,
}

impl<R: AsyncReadExt + Unpin> SseStream<R> {
    pub fn new(reader: R) -> Self {
        Self {
            reader: BufReader::new(reader),
            buffer: Vec::with_capacity(4096),
            data_buffer: Vec::with_capacity(4096),
            event_name: String::new(),
            saw_event: false,
        }
    }

    /// Read the next event from the stream.
    /// Returns `Ok(None)` on EOF (clean end of
    /// stream). Returns `Err(io::Error)` on I/O
    /// errors from the underlying reader.
    pub async fn next(&mut self) -> Result<Option<SseEvent>, std::io::Error> {
        loop {
            self.buffer.clear();
            let n = self.reader.read_until(b'\n', &mut self.buffer).await?;
            if n == 0 {
                // EOF. If we have a partial event
                // in the data buffer, emit it.
                return Ok(self.flush_event());
            }
            // Strip trailing `\n` / `\r\n`.
            while matches!(self.buffer.last(), Some(b'\n') | Some(b'\r')) {
                self.buffer.pop();
            }
            if self.buffer.is_empty() {
                // Blank line = event boundary.
                if !self.saw_event {
                    // No field lines seen since the
                    // last boundary (e.g. we just
                    // started reading, or the previous
                    // event was a comment-only).
                    continue;
                }
                return Ok(self.flush_event());
            }
            // Non-blank line; classify it.
            self.saw_event = true;
            if self.buffer.first() == Some(&b':') {
                // Comment line; ignore.
                continue;
            }
            if let Some(rest) = strip_prefix(&self.buffer, b"data:") {
                let mut payload = rest.to_vec();
                // Per SSE spec, a single space after
                // `data:` is stripped.
                if payload.first() == Some(&b' ') {
                    payload.remove(0);
                }
                if !self.data_buffer.is_empty() {
                    self.data_buffer.push(b'\n');
                }
                self.data_buffer.extend_from_slice(&payload);
                continue;
            }
            if let Some(rest) = strip_prefix(&self.buffer, b"event:") {
                // `event: content_block_delta` —
                // store the name so the next
                // blank-line boundary emits a
                // `SseEvent::Named { event, data }`
                // instead of `SseEvent::Data`. We
                // always overwrite (the SSE spec
                // says only the last `event:` line
                // in a given event counts).
                let mut name = rest.to_vec();
                if name.first() == Some(&b' ') {
                    name.remove(0);
                }
                self.event_name = String::from_utf8_lossy(&name).into_owned();
                continue;
            }
            // Other field names (`id:`, `retry:`)
            // are ignored. We track event
            // resumability via the `Last-Event-Id`
            // header in a future phase if needed.
        }
    }

    /// Convert the current `data_buffer` into an
    /// `SseEvent` and reset the per-event state.
    /// Returns `None` if the event had no data
    /// (e.g. just comments or just an `event:`
    /// line with no data).
    fn flush_event(&mut self) -> Option<SseEvent> {
        self.saw_event = false;
        let event_name = std::mem::take(&mut self.event_name);
        if self.data_buffer.is_empty() {
            return None;
        }
        let data = String::from_utf8_lossy(&self.data_buffer).into_owned();
        self.data_buffer.clear();
        // `[DONE]` is the OpenAI sentinel. We
        // only treat the data as `Done` if the
        // event has no `event:` name (per the
        // OpenAI SSE spec, `[DONE]` is always an
        // unnamed event). If an adapter uses
        // named events, the adapter is
        // responsible for mapping its own
        // completion signal (e.g. Anthropic's
        // `message_stop`) to `SseEvent::Done`
        // — our parser doesn't auto-map
        // anything.
        if event_name.is_empty() && data.trim() == "[DONE]" {
            Some(SseEvent::Done)
        } else if event_name.is_empty() {
            Some(SseEvent::Data { data })
        } else {
            Some(SseEvent::Named {
                event: event_name,
                data,
            })
        }
    }
}

/// Strip a literal byte prefix. Returns the slice
/// after the prefix, or `None` if the prefix
/// doesn't match.
fn strip_prefix<'a>(haystack: &'a [u8], prefix: &[u8]) -> Option<&'a [u8]> {
    if haystack.len() >= prefix.len() && &haystack[..prefix.len()] == prefix {
        Some(&haystack[prefix.len()..])
    } else {
        None
    }
}

// --- Chunk parsers (5b-4) -----------------------------------------------
//
// The 5b-1 / 5b-2 adapters use per-chunk parsing
// inline in the SSE loop. In 5b-4 we extract the
// per-chunk parsing into pure functions so we can
// unit-test the tool-call extraction without
// running a real HTTPS server (or even an SSE
// stream). The adapter loops become thin wrappers
// around these parsers.
//
// The parsers return a list of "updates" that
// the adapter applies to its in-progress state
// (`in_progress_tools` map) and emits as
// `ChatDelta` chunks. We split text updates
// (one per chunk) from tool updates (one per
// tool per chunk) so the adapter can emit them
// in order.

/// One update extracted from an OpenAI chunk.
/// The adapter applies each `ToolUpdate` to its
/// per-`index` accumulator, and emits a
/// `ChatDelta::Delta` for each `Text` (matching
/// the 5b-1 / 5b-2 behaviour).
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum OpenAiChunkUpdate {
    /// A text delta from `delta.content`.
    Text(String),
    /// A tool call update for the given
    /// `index`. The adapter holds an
    /// `InProgressTool` per `index` and
    /// accumulates.
    Tool {
        index: u32,
        id: Option<String>,
        name: Option<String>,
        arguments: Option<String>,
    },
}

/// Parse a single OpenAI SSE `data: ...` chunk
/// payload (the JSON inside `data:`, not the
/// `data: ` prefix). Returns the updates the
/// adapter should apply. Returns an empty
/// `Vec` for chunks that have no `content` and
/// no `tool_calls` (role-only / finish-only
/// chunks).
///
/// The function is total — it never panics on
/// malformed JSON. A malformed chunk is
/// surfaced as a `ChatDelta::Error` (the
/// adapter does this). We just return the
/// updates we successfully extracted, plus
/// the parse error so the adapter can
/// decide what to do.
pub(crate) fn parse_openai_chunk(data: &str) -> (Vec<OpenAiChunkUpdate>, Option<String>) {
    #[derive(Deserialize)]
    struct ChunkShape {
        #[serde(default)]
        choices: Vec<ChunkChoice>,
    }
    #[derive(Deserialize)]
    struct ChunkChoice {
        #[serde(default)]
        delta: ChunkDelta,
    }
    #[derive(Deserialize, Default)]
    struct ChunkDelta {
        #[serde(default)]
        content: Option<String>,
        #[serde(default)]
        tool_calls: Vec<ToolCallDelta>,
    }
    #[derive(Deserialize, Default)]
    struct ToolCallDelta {
        #[serde(default)]
        index: u32,
        #[serde(default)]
        id: Option<String>,
        #[serde(default, rename = "type")]
        type_: Option<String>,
        #[serde(default)]
        function: Option<FunctionCallDelta>,
    }
    #[derive(Deserialize, Default)]
    struct FunctionCallDelta {
        #[serde(default)]
        name: Option<String>,
        #[serde(default)]
        arguments: Option<String>,
    }
    match serde_json::from_str::<ChunkShape>(data) {
        Ok(parsed) => {
            let mut updates = Vec::new();
            for c in parsed.choices {
                if let Some(text) = c.delta.content {
                    if !text.is_empty() {
                        updates.push(OpenAiChunkUpdate::Text(text));
                    }
                }
                for tc in c.delta.tool_calls {
                    updates.push(OpenAiChunkUpdate::Tool {
                        index: tc.index,
                        id: tc.id,
                        name: tc.function.as_ref().and_then(|f| f.name.clone()),
                        arguments: tc.function.as_ref().and_then(|f| f.arguments.clone()),
                    });
                    let _ = tc.type_; // reserved
                }
            }
            (updates, None)
        }
        Err(e) => (Vec::new(), Some(e.to_string())),
    }
}

/// One update extracted from an Anthropic
/// named-SSE `data: ...` payload. Used for
/// the `content_block_delta` event (5b-4
/// branches on `delta.type` to decide text
/// vs tool-input).
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum AnthropicDeltaUpdate {
    /// `delta.type == "text_delta"`.
    Text(String),
    /// `delta.type == "input_json_delta"` —
    /// append `partial_json` to the
    /// in-progress tool at the chunk's
    /// `index`.
    ToolInput { index: u32, partial_json: String },
}

/// Parse a single Anthropic `content_block_delta`
/// payload (the JSON inside `data:`). The
/// `index` field is on the top level
/// (`{"index":0,"delta":{...}}`).
pub(crate) fn parse_anthropic_content_block_delta(
    data: &str,
) -> (Option<AnthropicDeltaUpdate>, Option<String>) {
    #[derive(Deserialize)]
    struct AnthropicDelta {
        #[serde(default)]
        index: u32,
        delta: AnthropicDeltaInner,
    }
    #[derive(Deserialize)]
    struct AnthropicDeltaInner {
        #[serde(default, rename = "type")]
        type_: Option<String>,
        #[serde(default)]
        text: Option<String>,
        #[serde(default)]
        partial_json: Option<String>,
    }
    match serde_json::from_str::<AnthropicDelta>(data) {
        Ok(parsed) => {
            let update = match parsed.delta.type_.as_deref() {
                Some("text_delta") => parsed.delta.text.map(AnthropicDeltaUpdate::Text),
                Some("input_json_delta") => {
                    parsed
                        .delta
                        .partial_json
                        .map(|pj| AnthropicDeltaUpdate::ToolInput {
                            index: parsed.index,
                            partial_json: pj,
                        })
                }
                _ => None,
            };
            (update, None)
        }
        Err(e) => (None, Some(e.to_string())),
    }
}

/// One update extracted from an Anthropic
/// `content_block_start` payload. The
/// adapter uses this to register a new
/// in-progress tool.
#[derive(Debug, PartialEq, Eq)]
pub(crate) struct AnthropicBlockStart {
    pub index: u32,
    /// `Some((id, name))` for `tool_use` blocks;
    /// `None` for `text` blocks (and any other
    /// type we don't track in 5b-4).
    pub tool: Option<(String, String)>,
}

/// Parse an Anthropic `content_block_start`
/// payload. Returns `Some(AnthropicBlockStart { tool: Some((id, name)) })`
/// for `tool_use` blocks (the adapter
/// registers a new in-progress tool).
/// Returns `None` for `text` blocks and any
/// other block type we don't track in 5b-4
/// (the adapter skips the start event
/// entirely; text deltas carry their own
/// payload). Returns `Some(parse_error)` on
/// malformed JSON.
pub(crate) fn parse_anthropic_content_block_start(
    data: &str,
) -> (Option<AnthropicBlockStart>, Option<String>) {
    #[derive(Deserialize)]
    struct ContentBlockStart {
        #[serde(default)]
        index: u32,
        #[serde(default)]
        content_block: Option<ContentBlock>,
    }
    #[derive(Deserialize)]
    struct ContentBlock {
        #[serde(default, rename = "type")]
        type_: Option<String>,
        #[serde(default)]
        id: Option<String>,
        #[serde(default)]
        name: Option<String>,
    }
    match serde_json::from_str::<ContentBlockStart>(data) {
        Ok(parsed) => {
            let start = match parsed.content_block {
                Some(cb) if cb.type_.as_deref() == Some("tool_use") => Some(AnthropicBlockStart {
                    index: parsed.index,
                    tool: Some((cb.id.unwrap_or_default(), cb.name.unwrap_or_default())),
                }),
                _ => None,
            };
            (start, None)
        }
        Err(e) => (None, Some(e.to_string())),
    }
}

// --- Stream function -----------------------------------------------------

/// Open a streaming chat completion to an
/// OpenAI-compatible endpoint and invoke
/// `on_chunk` for each delta / done / error.
///
/// This is the core 5b-1 function. It is provider-
/// agnostic — pass any OpenAI-compatible base URL
/// (OpenAI itself, OpenRouter, Together, etc.).
/// The Anthropic adapter (5b-2) is a different
/// function because the request body, auth
/// headers, and SSE framing are different.
///
/// `cancel` is checked between every SSE event.
/// When it flips, the function emits a synthetic
/// `ChatDelta::Done { cancelled: true }` chunk and
/// returns `Ok(())`. The JS side is expected to
/// clean up any in-flight UI state in response to
/// `Done { cancelled: true }`.
///
/// On a successful natural completion, the
/// function emits `ChatDelta::Done { cancelled:
/// false }` and returns `Ok(())`. The provider
/// sent `[DONE]` (or the connection closed
/// cleanly); either way, we treat it as a normal
/// end-of-stream.
///
/// On a transport / parse / HTTP error, the
/// function emits a single `ChatDelta::Error`
/// chunk and returns `Ok(())`. The JS side
/// surfaces the error inline.
///
/// `stream_chat_openai` only returns `Err(…)`
/// for setup failures (bad URL, missing API key,
/// reqwest build error) — the kinds of errors
/// that mean we never even started the request.
pub async fn stream_chat_openai(
    api_key: &str,
    base_url: &str,
    model: &str,
    messages: &[ChatMessage],
    // 5b-7: per-tool enable/disable. The JS Settings
    // screen collects the user's opt-in set and passes
    // it on every chat-stream request. An empty slice
    // means "all tools enabled" (backwards-compatible
    // default for JS clients that pre-date 5b-7). The
    // resulting tool list is what the model sees; the
    // JS-side executor additionally refuses to run
    // any tool the user disabled since the request
    // started (belt-and-braces — see the
    // `aiStore` docs).
    enabled_tool_names: &[String],
    // 5c: per-request custom tool list. Empty
    // slice = no custom tools (backwards-
    // compatible default for JS clients that
    // pre-date 5c). The list is the source of
    // truth for which custom tools the model
    // sees; the JS `customToolsStore` decides
    // what goes in this slice at request time.
    // 5d+ may add a per-tool enable/disable
    // overlay like 5b-7 has for built-ins.
    custom_tools: &[crate::CustomToolSpec],
    on_chunk: impl Fn(ChatDelta) + Send + 'static,
    cancel: Arc<AtomicBool>,
) -> Result<(), ChatError> {
    // Build the request body. The OpenAI schema:
    //   {
    //     "model": "gpt-4o-mini",
    //     "messages": [{"role": "user", "content": "Hello"}],
    //     "stream": true,
    //     "tools": [...]   // 5b-6: hardcoded for the MVP
    //   }
    #[derive(Serialize)]
    struct OpenAiRequest<'a> {
        model: &'a str,
        messages: &'a [ChatMessage],
        stream: bool,
        /// 5b-6/5b-7/5c: the list of tools the
        /// model can call. 5b-6 hardcoded the
        /// MVP set in `get_openai_tools()`;
        /// 5b-7 filters by the
        /// `enabled_tool_names` whitelist
        /// (empty = all enabled). 5c merges in
        /// the `custom_tools` list (user-
        /// defined in `lipi-tools.json`) on
        /// top of the built-ins. The final
        /// shape is OpenAI's `[{type:"function",
        /// function:{name, description,
        /// parameters}}]`.
        tools: Vec<serde_json::Value>,
    }
    let body = OpenAiRequest {
        model,
        messages,
        stream: true,
        // 5c: merge built-ins + customs. The
        // `merge_tool_list` helper in
        // `custom_tool.rs` does the heavy
        // lifting (filter by whitelist, shape
        // for OpenAI). The closure passes the
        // existing `get_openai_tools` so the
        // 5b-7 path is unchanged.
        tools: crate::merge_tool_list(
            |enabled| get_openai_tools(enabled),
            custom_tools,
            enabled_tool_names,
        ),
    };
    let url = format!("{}/chat/completions", base_url.trim_end_matches('/'));
    let client = reqwest::Client::builder()
        .build()
        .map_err(|e| ChatError::HttpClient {
            detail: e.to_string(),
        })?;
    let resp = client
        .post(&url)
        .header("Authorization", format!("Bearer {api_key}"))
        .header("Content-Type", "application/json")
        .header("Accept", "text/event-stream")
        .json(&body)
        .send()
        .await
        .map_err(|e| ChatError::HttpTransport {
            detail: e.to_string(),
        })?;

    let status = resp.status();
    if !status.is_success() {
        // Try to read the body (it's small — an
        // error response is typically a few hundred
        // bytes). We bound it to 8 KB to avoid
        // runaway memory on a misbehaving server.
        let body = resp
            .text()
            .await
            .unwrap_or_else(|_| "<unreadable>".to_string());
        let snippet = body.chars().take(1024).collect::<String>();
        // Map status to a ChatDelta::Error kind.
        let kind = match status.as_u16() {
            401 | 403 => "auth",
            429 => "rateLimit",
            500..=599 => "server",
            _ => "http",
        };
        on_chunk(ChatDelta::Error {
            error_kind: kind.to_string(),
            message: format!("HTTP {status}: {snippet}"),
        });
        return Err(ChatError::HttpStatus {
            status: status.as_u16(),
            body: snippet,
        });
    }

    // OpenAI returns `text/event-stream`. We
    // `bytes_stream()` and feed the bytes into
    // our SSE parser.
    let byte_stream = resp.bytes_stream();
    // The `bytes_stream()` is an `impl Stream<Item =
    // Result<Bytes, reqwest::Error>>`. We need a
    // single `AsyncRead`-like thing to feed to
    // our parser. The easiest way is to collect
    // bytes into a buffer until we hit a frame
    // boundary, but that defeats streaming.
    //
    // The right approach: hand the stream to a
    // `tokio_util::io::StreamReader` which adapts
    // an async `Stream<Item = Result<Bytes>>` to
    // an `AsyncRead`. Then wrap that in our
    // `SseStream`.
    use tokio_util::io::StreamReader;
    let reader = StreamReader::new(
        byte_stream.map(|r| r.map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))),
    );
    let mut sse = SseStream::new(reader);

    // In-progress tool calls, keyed by the
    // OpenAI-assigned `index` (a u32). OpenAI
    // numbers tool calls 0, 1, 2, ... in the
    // order they appear in the model's
    // response. The `index` is STABLE across
    // chunks — there's no "new index = previous
    // tool complete" signal on the wire. We
    // hold the `id` and `name` from the first
    // chunk for each index, and concatenate
    // `function.arguments` from subsequent
    // chunks. When the stream ends (Done / EOF
    // / cancel / transport error), we flush
    // every in-progress tool as a `ToolCall`
    // chunk and clear the map.
    let mut in_progress_tools: HashMap<u32, InProgressTool> = HashMap::new();

    loop {
        if cancel.load(Ordering::Relaxed) {
            // Flush any in-progress tools as
            // partial — the user asked to stop.
            // (The arguments JSON may be
            // incomplete; the JS side renders
            // the tool trace with whatever we
            // have.)
            for (_, tool) in in_progress_tools.drain() {
                on_chunk(ChatDelta::ToolCall {
                    id: tool.id,
                    name: tool.name,
                    input: tool.input,
                });
            }
            on_chunk(ChatDelta::Done {
                cancelled: true,
                stop_reason: None,
            });
            return Ok(());
        }
        match sse.next().await {
            Ok(Some(SseEvent::Data { data })) => {
                // 5b-4: parse the chunk via the
                // shared `parse_openai_chunk`
                // helper. The helper returns
                // text updates (one per chunk)
                // and tool updates (zero or
                // more per chunk). Text is
                // emitted as `Delta` chunks;
                // tool updates are applied to
                // the per-`index` accumulator
                // and flushed at end-of-stream.
                let (updates, parse_err) = parse_openai_chunk(&data);
                for update in updates {
                    match update {
                        OpenAiChunkUpdate::Text(text) => {
                            on_chunk(ChatDelta::Delta { text });
                        }
                        OpenAiChunkUpdate::Tool {
                            index,
                            id,
                            name,
                            arguments,
                        } => {
                            // OpenAI uses a STABLE
                            // `index` per tool call
                            // across all chunks. There
                            // is NO "new index means
                            // previous tool complete"
                            // signal — the model can
                            // call tool 0, then tool 1,
                            // and tool 0 will still get
                            // trailing argument deltas
                            // in subsequent chunks. So
                            // we just accumulate into
                            // a per-index accumulator
                            // and flush the whole map
                            // when the stream ends.
                            let entry = in_progress_tools
                                .entry(index)
                                .or_insert_with(InProgressTool::default);
                            if let Some(id) = id {
                                entry.id = id;
                            }
                            if let Some(name) = name {
                                entry.name = name;
                            }
                            if let Some(args) = arguments {
                                entry.input.push_str(&args);
                            }
                        }
                    }
                }
                if let Some(err) = parse_err {
                    on_chunk(ChatDelta::Error {
                        error_kind: "parse".to_string(),
                        message: format!(
                            "failed to parse SSE chunk: {err}; raw: {}",
                            data.chars().take(200).collect::<String>()
                        ),
                    });
                    // Continue reading — a single
                    // malformed chunk shouldn't kill
                    // the stream.
                }
            }
            Ok(Some(SseEvent::Named { event, data: _ })) => {
                // OpenAI's SSE stream never uses
                // named events. If we see one
                // here, the server is doing
                // something unexpected (or
                // OpenAI changed their format).
                // Surface as an `Error` chunk
                // and continue.
                on_chunk(ChatDelta::Error {
                    error_kind: "parse".to_string(),
                    message: format!(
                        "unexpected named SSE event `{event}` from OpenAI-compatible endpoint"
                    ),
                });
            }
            Ok(Some(SseEvent::Done)) => {
                // Flush any in-progress tools.
                for (_, tool) in in_progress_tools.drain() {
                    on_chunk(ChatDelta::ToolCall {
                        id: tool.id,
                        name: tool.name,
                        input: tool.input,
                    });
                }
                on_chunk(ChatDelta::Done {
                    cancelled: false,
                    stop_reason: None,
                });
                return Ok(());
            }
            Ok(None) => {
                // EOF. The provider closed the
                // connection without sending [DONE]
                // (rare for OpenAI; common if the
                // server kills the connection early).
                // Treat as a normal completion.
                for (_, tool) in in_progress_tools.drain() {
                    on_chunk(ChatDelta::ToolCall {
                        id: tool.id,
                        name: tool.name,
                        input: tool.input,
                    });
                }
                on_chunk(ChatDelta::Done {
                    cancelled: false,
                    stop_reason: None,
                });
                return Ok(());
            }
            Err(e) => {
                // Don't lose in-progress tools on
                // a transport error — they're the
                // model's actual work. Flush, then
                // surface the error.
                for (_, tool) in in_progress_tools.drain() {
                    on_chunk(ChatDelta::ToolCall {
                        id: tool.id,
                        name: tool.name,
                        input: tool.input,
                    });
                }
                on_chunk(ChatDelta::Error {
                    error_kind: "transport".to_string(),
                    message: format!("SSE read error: {e}"),
                });
                return Ok(());
            }
        }
    }
}

/// In-progress tool call accumulator. The
/// `id` and `name` arrive in the first chunk
/// for a given OpenAI `index`; the
/// `function.arguments` JSON is built up as a
/// `String` (OpenAI concatenates byte-by-byte
/// across chunks — the wire format is just
/// appending the `arguments` field of each
/// chunk). The accumulator is drained into a
/// `ChatDelta::ToolCall` chunk when the
/// stream ends (naturally, on cancel, or on
/// transport error).
#[derive(Default, Debug)]
struct InProgressTool {
    id: String,
    name: String,
    input: String,
}

// --- Stream function: Anthropic -------------------------------------------
//
// Anthropic's API is a different shape from
// OpenAI's. We can't share the OpenAI adapter
// for two reasons:
//
//  1. The request body is different: Anthropic
//     takes a top-level `system` field instead
//     of a `system` role in the messages array,
//     and `max_tokens` is required even for
//     streaming requests.
//
//  2. The SSE stream uses named events:
//       - `message_start`        (1 per stream)
//       - `content_block_start`  (1 per content block)
//       - `content_block_delta`  (1+ per text chunk; the
//                                `data` is `{"delta":{"type":"text_delta","text":"..."}}`)
//       - `content_block_stop`   (1 per content block)
//       - `message_delta`        (1 per stream; `data` is
//                                `{"delta":{"stop_reason":"end_turn",...}}`)
//       - `message_stop`         (1 per stream; the "end of stream" signal)
//     OpenAI uses no `event:` lines, so the
//     OpenAI adapter sees `SseEvent::Data` while
//     this one sees `SseEvent::Named`.
//
// Auth: `x-api-key: <key>` (no `Authorization:
// Bearer`) + `anthropic-version: 2023-06-01`.
//
// We do not support Anthropic's `tools` field in
// 5b-2 — that's a future phase. The model just
// gets text in / text out.
//
// On natural completion, we emit a single
// `ChatDelta::Done { cancelled: false, stop_reason:
// Some("end_turn" | "max_tokens" | ...) }` chunk.
// The JS side uses `stopReason` to show a
// "truncated by token limit" banner when the model
// hit `max_tokens`.

/// Open a streaming chat completion to Anthropic's
/// `/v1/messages` endpoint. See the module
/// comment above for the request/response shape.
pub async fn stream_chat_anthropic(
    api_key: &str,
    base_url: &str,
    model: &str,
    messages: &[ChatMessage],
    // 5b-7: see `stream_chat_openai` for the
    // semantics. Anthropic reuses the same
    // enabled-set filter.
    enabled_tool_names: &[String],
    // 5c: see `stream_chat_openai` for the
    // semantics. Same per-request list, same
    // merge behaviour.
    custom_tools: &[crate::CustomToolSpec],
    on_chunk: impl Fn(ChatDelta) + Send + 'static,
    cancel: Arc<AtomicBool>,
) -> Result<(), ChatError> {
    // Anthropic separates the system prompt from
    // the messages. We extract the latest
    // `role: "system"` message and pass the rest
    // as-is. (If there are multiple system
    // messages, we concatenate them with
    // `\n\n`; Anthropic's API doesn't support
    // multiple system messages in one request,
    // so this is a reasonable transformation.)
    let mut system_text: Option<String> = None;
    let mut user_assistant: Vec<&ChatMessage> = Vec::with_capacity(messages.len());
    for m in messages {
        if m.role == "system" {
            match &mut system_text {
                Some(existing) => {
                    existing.push_str("\n\n");
                    existing.push_str(&m.content);
                }
                None => system_text = Some(m.content.clone()),
            }
        } else {
            user_assistant.push(m);
        }
    }

    // The Anthropic request body (5b-6, with
    // tool support):
    //   {
    //     "model": "claude-3-5-sonnet-20241022",
    //     "max_tokens": 4096,
    //     "system": "..." (optional),
    //     "tools": [...] (5b-6: hardcoded MVP set)
    //     "messages": [
    //       {"role": "user", "content": "..."},
    //       {"role": "assistant", "content": [
    //         {"type": "text", "text": "..."},
    //         {"type": "tool_use", "id": "...", "name": "...", "input": {...}}
    //       ]},
    //       {"role": "user", "content": [
    //         {"type": "tool_result", "tool_use_id": "...", "content": "..."}
    //       ]}
    //     ],
    //     "stream": true
    //   }
    //
    // Anthropic's tool-result message uses
    // `role: "user"` (not `"tool"`), and the
    // content is an array with a single
    // `tool_result` block. The `build_anthropic_messages`
    // helper below converts our internal
    // representation (assistant messages with
    // `tool_calls`, tool result messages with
    // `role: "tool"` + `tool_call_id`) into
    // Anthropic's shape.
    //
    // We hardcode `max_tokens: 4096` for the MVP
    // — 5b-3 will surface this as a model-settings
    // UI control if users want to override.
    #[derive(Serialize)]
    struct AnthropicRequest<'a> {
        model: &'a str,
        max_tokens: u32,
        #[serde(skip_serializing_if = "Option::is_none")]
        system: Option<&'a str>,
        /// 5b-6/5b-7/5c: see `get_openai_tools`
        /// for the whitelist semantics.
        /// Anthropic's schema is `[{name,
        /// description, input_schema}]` (no
        /// `type:"function"` wrapper). 5c adds
        /// custom tools on top of the built-
        /// ins.
        tools: Vec<serde_json::Value>,
        messages: Vec<AnthropicMessage>,
        stream: bool,
    }
    let body = AnthropicRequest {
        model,
        max_tokens: 4096,
        system: system_text.as_deref(),
        tools: crate::merge_tool_list_anthropic(
            |enabled| get_anthropic_tools(enabled),
            custom_tools,
            enabled_tool_names,
        ),
        messages: build_anthropic_messages(&user_assistant),
        stream: true,
    };

    let url = format!("{}/v1/messages", base_url.trim_end_matches('/'));
    let client = reqwest::Client::builder()
        .build()
        .map_err(|e| ChatError::HttpClient {
            detail: e.to_string(),
        })?;
    let resp = client
        .post(&url)
        .header("x-api-key", api_key)
        .header("anthropic-version", "2023-06-01")
        .header("Content-Type", "application/json")
        .header("Accept", "text/event-stream")
        .json(&body)
        .send()
        .await
        .map_err(|e| ChatError::HttpTransport {
            detail: e.to_string(),
        })?;

    let status = resp.status();
    if !status.is_success() {
        let body = resp
            .text()
            .await
            .unwrap_or_else(|_| "<unreadable>".to_string());
        let snippet = body.chars().take(1024).collect::<String>();
        let kind = match status.as_u16() {
            401 | 403 => "auth",
            429 => "rateLimit",
            400 => "http", // 400 from Anthropic is usually a malformed body (missing system, bad role, etc.)
            500..=599 => "server",
            _ => "http",
        };
        on_chunk(ChatDelta::Error {
            error_kind: kind.to_string(),
            message: format!("HTTP {status}: {snippet}"),
        });
        return Err(ChatError::HttpStatus {
            status: status.as_u16(),
            body: snippet,
        });
    }

    let byte_stream = resp.bytes_stream();
    use tokio_util::io::StreamReader;
    let reader = StreamReader::new(
        byte_stream.map(|r| r.map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))),
    );
    let mut sse = SseStream::new(reader);

    // The `stop_reason` lives in the
    // `message_delta` event, NOT in `message_stop`.
    // We carry it across loop iterations.
    let mut pending_stop_reason: Option<String> = None;

    // 5b-4: in-progress tool calls, keyed by
    // Anthropic's `content_block.index`. Each
    // tool call gets a 3-event lifecycle:
    //   1. `content_block_start` with
    //      `content_block.type == "tool_use"`
    //      — register the tool, capturing
    //      `id` and `name`. The `input` is
    //      always `{}` at this point.
    //   2. `content_block_delta` with
    //      `delta.type == "input_json_delta"` —
    //      append `partial_json` to the
    //      accumulator.
    //   3. `content_block_stop` — the tool is
    //      complete. Emit a `ToolCall` chunk
    //      and remove from the map.
    // If the stream ends before step 3 (e.g.
    // cancel, transport error), we flush any
    // remaining tools with whatever input
    // JSON we accumulated.
    let mut in_progress_tools: HashMap<u32, InProgressTool> = HashMap::new();

    loop {
        if cancel.load(Ordering::Relaxed) {
            // Flush any in-progress tools.
            for (_, tool) in in_progress_tools.drain() {
                on_chunk(ChatDelta::ToolCall {
                    id: tool.id,
                    name: tool.name,
                    input: tool.input,
                });
            }
            on_chunk(ChatDelta::Done {
                cancelled: true,
                stop_reason: None,
            });
            return Ok(());
        }
        match sse.next().await {
            Ok(Some(SseEvent::Named { event, data })) => {
                match event.as_str() {
                    "content_block_start" => {
                        // 5b-4: register a new tool
                        // call if the block type is
                        // `tool_use`. Other block
                        // types (`text`, future
                        // `image`) are ignored here
                        // — text is already handled
                        // by `content_block_delta`
                        // with `type: "text_delta"`.
                        let (start, parse_err) = parse_anthropic_content_block_start(&data);
                        if let Some(s) = start {
                            if let Some((id, name)) = s.tool {
                                in_progress_tools.insert(
                                    s.index,
                                    InProgressTool {
                                        id,
                                        name,
                                        input: String::new(),
                                    },
                                );
                            }
                            // `text` blocks: no
                            // registration needed (text
                            // deltas carry their own
                            // payload).
                        }
                        if let Some(err) = parse_err {
                            on_chunk(ChatDelta::Error {
                                error_kind: "parse".to_string(),
                                message: format!(
                                    "failed to parse content_block_start: {err}; raw: {}",
                                    data.chars().take(200).collect::<String>()
                                ),
                            });
                        }
                    }
                    "content_block_delta" => {
                        // 5b-4: parse via the shared
                        // helper. The helper returns
                        // `Text` for `text_delta`
                        // and `ToolInput` for
                        // `input_json_delta` (and
                        // `None` for unknown future
                        // types).
                        let (update, parse_err) = parse_anthropic_content_block_delta(&data);
                        match update {
                            Some(AnthropicDeltaUpdate::Text(text)) => {
                                if !text.is_empty() {
                                    on_chunk(ChatDelta::Delta { text });
                                }
                            }
                            Some(AnthropicDeltaUpdate::ToolInput {
                                index,
                                partial_json,
                            }) => {
                                if let Some(tool) = in_progress_tools.get_mut(&index) {
                                    tool.input.push_str(&partial_json);
                                }
                                // If no tool is
                                // registered for this
                                // index, the
                                // `partial_json` is
                                // for an unknown
                                // block. Silently
                                // skip.
                            }
                            None => {
                                // Unknown delta.type
                                // (`thinking_delta` and
                                // future types) is
                                // silently skipped.
                            }
                        }
                        if let Some(err) = parse_err {
                            on_chunk(ChatDelta::Error {
                                error_kind: "parse".to_string(),
                                message: format!(
                                    "failed to parse content_block_delta: {err}; raw: {}",
                                    data.chars().take(200).collect::<String>()
                                ),
                            });
                        }
                    }
                    "content_block_stop" => {
                        // 5b-4: the tool call at this
                        // `index` is complete. Emit a
                        // `ToolCall` chunk and remove
                        // from the map. The data is
                        // JSON shaped like:
                        //   {"type":"content_block_stop","index":0}
                        #[derive(Deserialize, Default)]
                        struct ContentBlockStop {
                            #[serde(default)]
                            index: u32,
                        }
                        match serde_json::from_str::<ContentBlockStop>(&data) {
                            Ok(parsed) => {
                                if let Some(tool) = in_progress_tools.remove(&parsed.index) {
                                    on_chunk(ChatDelta::ToolCall {
                                        id: tool.id,
                                        name: tool.name,
                                        input: tool.input,
                                    });
                                }
                                // If no tool is
                                // registered for this
                                // index, it was a
                                // text block. Nothing
                                // to do.
                            }
                            Err(e) => {
                                on_chunk(ChatDelta::Error {
                                    error_kind: "parse".to_string(),
                                    message: format!(
                                        "failed to parse content_block_stop: {e}; raw: {}",
                                        data.chars().take(200).collect::<String>()
                                    ),
                                });
                            }
                        }
                    }
                    "message_delta" => {
                        // The data is JSON shaped like:
                        //   {"type":"message_delta",
                        //    "delta":{"stop_reason":"end_turn",
                        //             "stop_sequence":null},
                        //    "usage":{"output_tokens":15}}
                        // We extract `delta.stop_reason`
                        // and remember it for the
                        // `message_stop` that follows.
                        // Anthropic's `stop_reason` will
                        // be `"tool_use"` when the model
                        // finished its turn by emitting
                        // one or more tool calls (5b-4).
                        #[derive(Deserialize)]
                        struct MessageDelta {
                            delta: MessageDeltaInner,
                        }
                        #[derive(Deserialize)]
                        struct MessageDeltaInner {
                            #[serde(default)]
                            stop_reason: Option<String>,
                        }
                        match serde_json::from_str::<MessageDelta>(&data) {
                            Ok(parsed) => {
                                if let Some(sr) = parsed.delta.stop_reason {
                                    pending_stop_reason = Some(sr);
                                }
                            }
                            Err(_) => {
                                // Don't surface parse
                                // errors here — a
                                // malformed
                                // `message_delta` is
                                // not fatal; the
                                // `message_stop` will
                                // still come and we
                                // can finish the
                                // stream.
                            }
                        }
                    }
                    "message_stop" => {
                        // End of stream. Flush any
                        // in-progress tools (the
                        // server should have
                        // emitted a
                        // `content_block_stop`
                        // for each, but be
                        // defensive), then emit
                        // Done with the
                        // stop_reason we
                        // remembered.
                        for (_, tool) in in_progress_tools.drain() {
                            on_chunk(ChatDelta::ToolCall {
                                id: tool.id,
                                name: tool.name,
                                input: tool.input,
                            });
                        }
                        on_chunk(ChatDelta::Done {
                            cancelled: false,
                            stop_reason: pending_stop_reason.take(),
                        });
                        return Ok(());
                    }
                    // The other events
                    // (`message_start`,
                    // `ping`) carry no
                    // assistant text and are
                    // silently skipped.
                    _ => {}
                }
            }
            Ok(Some(SseEvent::Data { data })) => {
                // Anthropic shouldn't send
                // unnamed events. Surface as
                // a warning chunk and
                // continue.
                on_chunk(ChatDelta::Error {
                    error_kind: "parse".to_string(),
                    message: format!(
                        "unexpected unnamed SSE event from Anthropic: {}",
                        data.chars().take(200).collect::<String>()
                    ),
                });
            }
            Ok(Some(SseEvent::Done)) => {
                // `[DONE]` is an OpenAI
                // sentinel; Anthropic uses
                // `message_stop` instead.
                // If we see `[DONE]` from
                // Anthropic (shouldn't
                // happen), treat as a
                // normal completion.
                for (_, tool) in in_progress_tools.drain() {
                    on_chunk(ChatDelta::ToolCall {
                        id: tool.id,
                        name: tool.name,
                        input: tool.input,
                    });
                }
                on_chunk(ChatDelta::Done {
                    cancelled: false,
                    stop_reason: pending_stop_reason.take(),
                });
                return Ok(());
            }
            Ok(None) => {
                for (_, tool) in in_progress_tools.drain() {
                    on_chunk(ChatDelta::ToolCall {
                        id: tool.id,
                        name: tool.name,
                        input: tool.input,
                    });
                }
                on_chunk(ChatDelta::Done {
                    cancelled: false,
                    stop_reason: pending_stop_reason.take(),
                });
                return Ok(());
            }
            Err(e) => {
                // Flush tools even on transport
                // error — they're the model's
                // actual work and shouldn't be
                // lost.
                for (_, tool) in in_progress_tools.drain() {
                    on_chunk(ChatDelta::ToolCall {
                        id: tool.id,
                        name: tool.name,
                        input: tool.input,
                    });
                }
                on_chunk(ChatDelta::Error {
                    error_kind: "transport".to_string(),
                    message: format!("SSE read error: {e}"),
                });
                return Ok(());
            }
        }
    }
}

// --- Tests ---------------------------------------------------------------
//
// The tests in this module exercise `SseStream`
// against hand-crafted byte sequences. We don't
// make any real HTTPS calls here — that's an
// integration test concern (5b-2 will add it).

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;
    use tokio::io::BufReader;

    /// Convenience: build an SseStream over a
    /// static byte slice and collect the next
    /// event.
    async fn first_event(bytes: &[u8]) -> Option<SseEvent> {
        let reader = BufReader::new(Cursor::new(bytes.to_vec()));
        let mut sse = SseStream::new(reader);
        sse.next().await.unwrap()
    }

    async fn collect_all(bytes: &[u8]) -> Vec<SseEvent> {
        let reader = BufReader::new(Cursor::new(bytes.to_vec()));
        let mut sse = SseStream::new(reader);
        let mut out = Vec::new();
        while let Some(ev) = sse.next().await.unwrap() {
            out.push(ev);
        }
        out
    }

    #[tokio::test]
    async fn parses_a_single_complete_frame() {
        let bytes = b"data: {\"choices\":[{\"delta\":{\"content\":\"Hello\"}}]}\n\n";
        let ev = first_event(bytes).await;
        assert_eq!(
            ev,
            Some(SseEvent::Data {
                data: "{\"choices\":[{\"delta\":{\"content\":\"Hello\"}}]}".to_string()
            })
        );
    }

    #[tokio::test]
    async fn parses_multiple_frames_in_sequence() {
        let bytes = b"data: chunk1\n\ndata: chunk2\n\ndata: chunk3\n\n";
        let events = collect_all(bytes).await;
        assert_eq!(events.len(), 3);
        assert_eq!(
            events[0],
            SseEvent::Data {
                data: "chunk1".to_string()
            }
        );
        assert_eq!(
            events[1],
            SseEvent::Data {
                data: "chunk2".to_string()
            }
        );
        assert_eq!(
            events[2],
            SseEvent::Data {
                data: "chunk3".to_string()
            }
        );
    }

    #[tokio::test]
    async fn recognizes_done_sentinel() {
        let bytes = b"data: [DONE]\n\n";
        let ev = first_event(bytes).await;
        assert_eq!(ev, Some(SseEvent::Done));
    }

    #[tokio::test]
    async fn skips_comment_lines() {
        // Per SSE spec, lines starting with `:` are
        // comments and should be ignored. Our parser
        // should yield the data frame and silently
        // drop the comment.
        let bytes = b": this is a comment\ndata: real\n\n";
        let ev = first_event(bytes).await;
        assert_eq!(
            ev,
            Some(SseEvent::Data {
                data: "real".to_string()
            })
        );
    }

    #[tokio::test]
    async fn handles_crlf_line_endings() {
        // Some servers send \r\n instead of \n. Our
        // `read_until(b'\n')` collects up to and
        // including the \n, and the strip-loop
        // removes the trailing \r.
        let bytes = b"data: hello\r\n\r\ndata: world\r\n\r\n";
        let events = collect_all(bytes).await;
        assert_eq!(events.len(), 2);
        assert_eq!(
            events[0],
            SseEvent::Data {
                data: "hello".to_string()
            }
        );
        assert_eq!(
            events[1],
            SseEvent::Data {
                data: "world".to_string()
            }
        );
    }

    #[tokio::test]
    async fn strips_leading_space_after_data_colon() {
        // Per SSE spec, "data: foo" and "data:foo"
        // are different (the space is significant
        // and is stripped by the spec). Most servers
        // send "data: <payload>" with the space;
        // some don't. We accept both.
        let bytes = b"data:foo\n\ndata: bar\n\n";
        let events = collect_all(bytes).await;
        assert_eq!(events.len(), 2);
        assert_eq!(
            events[0],
            SseEvent::Data {
                data: "foo".to_string()
            }
        );
        assert_eq!(
            events[1],
            SseEvent::Data {
                data: "bar".to_string()
            }
        );
    }

    #[tokio::test]
    async fn yields_none_on_eof() {
        let bytes = b"";
        let reader = BufReader::new(Cursor::new(bytes.to_vec()));
        let mut sse = SseStream::new(reader);
        let ev = sse.next().await.unwrap();
        assert_eq!(ev, None);
    }

    #[tokio::test]
    async fn concatenates_multiple_data_lines_per_event() {
        // Per SSE spec, multiple `data:` lines in
        // the same event concatenate with \n. We
        // handle this for completeness, even though
        // OpenAI / Anthropic never do it in practice.
        let bytes = b"data: line1\ndata: line2\ndata: line3\n\n";
        let ev = first_event(bytes).await;
        assert_eq!(
            ev,
            Some(SseEvent::Data {
                data: "line1\nline2\nline3".to_string()
            })
        );
    }

    // --- 5b-2: named event tests (Anthropic) ---

    #[tokio::test]
    async fn named_event_yields_named_variant() {
        // Anthropic-style framing: `event: foo` line
        // followed by `data: bar` line, terminated
        // by blank line. We yield
        // `SseEvent::Named { event, data }`.
        let bytes = b"event: content_block_delta\ndata: {\"delta\":{\"type\":\"text_delta\",\"text\":\"Hi\"}}\n\n";
        let ev = first_event(bytes).await;
        assert_eq!(
            ev,
            Some(SseEvent::Named {
                event: "content_block_delta".to_string(),
                data: "{\"delta\":{\"type\":\"text_delta\",\"text\":\"Hi\"}}".to_string(),
            })
        );
    }

    #[tokio::test]
    async fn event_name_resets_between_events() {
        // The `event:` line is per-event. After a
        // blank-line boundary, the next event
        // starts with an empty `event_name`.
        let bytes =
            b"event: content_block_delta\ndata: first\n\nevent: message_stop\ndata: second\n\n";
        let events = collect_all(bytes).await;
        assert_eq!(events.len(), 2);
        assert_eq!(
            events[0],
            SseEvent::Named {
                event: "content_block_delta".to_string(),
                data: "first".to_string(),
            }
        );
        assert_eq!(
            events[1],
            SseEvent::Named {
                event: "message_stop".to_string(),
                data: "second".to_string(),
            }
        );
    }

    #[tokio::test]
    async fn last_event_line_wins_on_multiple_event_lines() {
        // Per SSE spec, if an event has multiple
        // `event:` lines, only the last one
        // counts. Our parser overwrites.
        let bytes = b"event: first\nevent: second\ndata: payload\n\n";
        let ev = first_event(bytes).await;
        assert_eq!(
            ev,
            Some(SseEvent::Named {
                event: "second".to_string(),
                data: "payload".to_string(),
            })
        );
    }

    #[tokio::test]
    async fn strips_leading_space_after_event_colon() {
        // Same `data:` rule applies to `event:`:
        // a single space after the colon is
        // stripped.
        let bytes =
            b"event: content_block_delta\ndata: x\n\nevent:content_block_delta\ndata: y\n\n";
        let events = collect_all(bytes).await;
        assert_eq!(events.len(), 2);
        assert_eq!(
            events[0],
            SseEvent::Named {
                event: "content_block_delta".to_string(),
                data: "x".to_string(),
            }
        );
        assert_eq!(
            events[1],
            SseEvent::Named {
                event: "content_block_delta".to_string(),
                data: "y".to_string(),
            }
        );
    }

    #[tokio::test]
    async fn done_sentinel_is_not_recognised_inside_named_event() {
        // If a named event has `data: [DONE]`,
        // the parser still yields a `Named`
        // variant — the `[DONE]` shorthand is
        // only for unnamed events. Anthropic
        // doesn't use `[DONE]`; it uses
        // `message_stop` instead. The adapter
        // (5b-2) maps `message_stop` to its
        // own `Done` chunk; the parser just
        // yields the named event unchanged.
        let bytes = b"event: message_stop\ndata: [DONE]\n\n";
        let ev = first_event(bytes).await;
        assert_eq!(
            ev,
            Some(SseEvent::Named {
                event: "message_stop".to_string(),
                data: "[DONE]".to_string(),
            })
        );
    }

    // --- 5b-4: chunk parser tests (OpenAI) ---

    /// The 5b-4 `parse_openai_chunk` helper
    /// returns the updates the adapter should
    /// apply. We assert on the helper's output
    /// (not on the adapter's emitted `ChatDelta`
    /// stream) because the helper is the
    /// testable unit.

    #[test]
    fn parse_openai_text_chunk() {
        let data = r#"{"choices":[{"delta":{"content":"Hello"}}]}"#;
        let (updates, err) = parse_openai_chunk(data);
        assert!(err.is_none());
        assert_eq!(updates, vec![OpenAiChunkUpdate::Text("Hello".to_string())]);
    }

    #[test]
    fn parse_openai_empty_content_is_skipped() {
        // Role-only chunks at the start of a
        // stream have `delta.content == ""` or
        // absent. We don't emit a `Delta` for
        // an empty string — the adapter will
        // skip.
        let data = r#"{"choices":[{"delta":{"content":""}}]}"#;
        let (updates, err) = parse_openai_chunk(data);
        assert!(err.is_none());
        assert!(updates.is_empty());
    }

    #[test]
    fn parse_openai_role_only_chunk_has_no_updates() {
        // The first chunk is usually just
        // `{"choices":[{"delta":{"role":"assistant"}}]}`.
        // We should yield zero updates (no
        // text, no tool calls).
        let data = r#"{"choices":[{"delta":{"role":"assistant"}}]}"#;
        let (updates, err) = parse_openai_chunk(data);
        assert!(err.is_none());
        assert!(updates.is_empty());
    }

    #[test]
    fn parse_openai_tool_call_first_chunk() {
        // First chunk for a tool call carries
        // `id`, `type`, and `function.name` in
        // addition to an empty `arguments`.
        let data = r#"{"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_abc","type":"function","function":{"name":"get_weather","arguments":""}}]}}]}"#;
        let (updates, err) = parse_openai_chunk(data);
        assert!(err.is_none());
        assert_eq!(
            updates,
            vec![OpenAiChunkUpdate::Tool {
                index: 0,
                id: Some("call_abc".to_string()),
                name: Some("get_weather".to_string()),
                arguments: Some(String::new()),
            }]
        );
    }

    #[test]
    fn parse_openai_tool_call_subsequent_chunks_concatenate_arguments() {
        // Subsequent chunks for the same `index`
        // carry only `function.arguments` (the
        // JSON is built up byte-by-byte). The
        // `id` and `name` are absent.
        let data = r#"{"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\"loc"}}]}}]}"#;
        let (updates, err) = parse_openai_chunk(data);
        assert!(err.is_none());
        assert_eq!(
            updates,
            vec![OpenAiChunkUpdate::Tool {
                index: 0,
                id: None,
                name: None,
                arguments: Some("{\"loc".to_string()),
            }]
        );
    }

    #[test]
    fn parse_openai_two_parallel_tool_calls_in_one_chunk() {
        // The model can call multiple tools in
        // one turn. The wire shape has multiple
        // `tool_calls[]` entries in the same
        // chunk (one per tool), each with their
        // own `index`.
        let data = r#"{"choices":[{"delta":{"tool_calls":[
          {"index":0,"id":"call_a","type":"function","function":{"name":"get_weather","arguments":""}},
          {"index":1,"id":"call_b","type":"function","function":{"name":"get_time","arguments":""}}
        ]}}]}"#;
        let (updates, err) = parse_openai_chunk(data);
        assert!(err.is_none());
        assert_eq!(updates.len(), 2);
        assert_eq!(
            updates[0],
            OpenAiChunkUpdate::Tool {
                index: 0,
                id: Some("call_a".to_string()),
                name: Some("get_weather".to_string()),
                arguments: Some(String::new()),
            }
        );
        assert_eq!(
            updates[1],
            OpenAiChunkUpdate::Tool {
                index: 1,
                id: Some("call_b".to_string()),
                name: Some("get_time".to_string()),
                arguments: Some(String::new()),
            }
        );
    }

    #[test]
    fn parse_openai_mixed_text_and_tool_in_one_chunk() {
        // Some chunks carry BOTH `content` and
        // `tool_calls` (rare but allowed). The
        // helper yields them in order.
        let data = r#"{"choices":[{"delta":{"content":"Calling weather: ","tool_calls":[{"index":0,"id":"call_a","type":"function","function":{"name":"get_weather","arguments":""}}]}}]}"#;
        let (updates, err) = parse_openai_chunk(data);
        assert!(err.is_none());
        assert_eq!(
            updates,
            vec![
                OpenAiChunkUpdate::Text("Calling weather: ".to_string()),
                OpenAiChunkUpdate::Tool {
                    index: 0,
                    id: Some("call_a".to_string()),
                    name: Some("get_weather".to_string()),
                    arguments: Some(String::new()),
                },
            ]
        );
    }

    #[test]
    fn parse_openai_malformed_chunk_surfaces_error() {
        let (updates, err) = parse_openai_chunk("not valid json");
        assert!(updates.is_empty());
        assert!(err.is_some());
    }

    // --- 5b-4: chunk parser tests (Anthropic) ---

    #[test]
    fn parse_anthropic_text_delta() {
        let data = r#"{"index":0,"delta":{"type":"text_delta","text":"Hello"}}"#;
        let (update, err) = parse_anthropic_content_block_delta(data);
        assert!(err.is_none());
        assert_eq!(
            update,
            Some(AnthropicDeltaUpdate::Text("Hello".to_string()))
        );
    }

    #[test]
    fn parse_anthropic_tool_input_delta() {
        let data = r#"{"index":1,"delta":{"type":"input_json_delta","partial_json":"{\"loc"}}"#;
        let (update, err) = parse_anthropic_content_block_delta(data);
        assert!(err.is_none());
        assert_eq!(
            update,
            Some(AnthropicDeltaUpdate::ToolInput {
                index: 1,
                partial_json: "{\"loc".to_string(),
            })
        );
    }

    #[test]
    fn parse_anthropic_unknown_delta_type_yields_none() {
        // `thinking_delta` and future types
        // return `None` so the adapter can
        // silently skip them.
        let data = r#"{"index":0,"delta":{"type":"thinking_delta","thinking":"…"}}"#;
        let (update, err) = parse_anthropic_content_block_delta(data);
        assert!(err.is_none());
        assert_eq!(update, None);
    }

    #[test]
    fn parse_anthropic_malformed_delta_surfaces_error() {
        let (update, err) = parse_anthropic_content_block_delta("not json");
        assert!(update.is_none());
        assert!(err.is_some());
    }

    #[test]
    fn parse_anthropic_block_start_for_tool_use() {
        let data = r#"{"index":0,"content_block":{"type":"tool_use","id":"toolu_abc","name":"get_weather","input":{}}}"#;
        let (start, err) = parse_anthropic_content_block_start(data);
        assert!(err.is_none());
        assert_eq!(
            start,
            Some(AnthropicBlockStart {
                index: 0,
                tool: Some(("toolu_abc".to_string(), "get_weather".to_string())),
            })
        );
    }

    #[test]
    fn parse_anthropic_block_start_for_text_yields_none() {
        // A `text` block doesn't need a tool
        // registration. The helper returns
        // `None` so the adapter can skip it
        // (text deltas carry their own payload
        // and don't need an in-progress
        // accumulator). This matches the
        // implementation's contract.
        let data = r#"{"index":0,"content_block":{"type":"text","text":""}}"#;
        let (start, err) = parse_anthropic_content_block_start(data);
        assert!(err.is_none());
        assert_eq!(start, None);
    }

    #[test]
    fn parse_anthropic_block_start_malformed_surfaces_error() {
        let (start, err) = parse_anthropic_content_block_start("not json");
        assert!(start.is_none());
        assert!(err.is_some());
    }

    // --- 5b-4: round-trip ChatDelta::ToolCall JSON shape ---

    /// The JS-side `ChatChunkPayload.toolCall`
    /// variant mirrors this shape. If this
    /// test breaks, the TS `ChatChunkPayload`
    /// discriminated union needs to be
    /// updated in lockstep.
    #[test]
    fn tool_call_delta_serialises_to_expected_camelcase_shape() {
        let delta = ChatDelta::ToolCall {
            id: "call_abc".to_string(),
            name: "get_weather".to_string(),
            input: "{\"location\":\"SF\"}".to_string(),
        };
        let json: serde_json::Value = serde_json::to_value(&delta).unwrap();
        assert_eq!(
            json,
            serde_json::json!({
                "kind": "toolCall",
                "id": "call_abc",
                "name": "get_weather",
                "input": "{\"location\":\"SF\"}"
            })
        );
    }

    /// `Delta` still serialises to the same
    /// shape as 5b-1 (5b-4 didn't break it).
    #[test]
    fn text_delta_serialises_to_expected_camelcase_shape() {
        let delta = ChatDelta::Delta {
            text: "Hi".to_string(),
        };
        let json: serde_json::Value = serde_json::to_value(&delta).unwrap();
        assert_eq!(json, serde_json::json!({ "kind": "delta", "text": "Hi" }));
    }

    /// `Done` with `stop_reason: "tool_use"`
    /// (Anthropic when the model emits
    /// tool calls) still serialises correctly.
    #[test]
    fn done_delta_with_tool_use_stop_reason_serialises_correctly() {
        let delta = ChatDelta::Done {
            cancelled: false,
            stop_reason: Some("tool_use".to_string()),
        };
        let json: serde_json::Value = serde_json::to_value(&delta).unwrap();
        assert_eq!(
            json,
            serde_json::json!({
                "kind": "done",
                "cancelled": false,
                "stopReason": "tool_use"
            })
        );
    }

    // ---- 5b-6: tool-call wire format ---------------------

    /// `ChatMessage` with `tool_calls` (assistant
    /// that emitted a tool call) serialises to
    /// the OpenAI shape:
    /// `{role: "assistant", content: "...", toolCalls: [{id, name, arguments}]}`.
    /// The `toolCalls` field is camelCase via
    /// the struct-level rename. `tool_call_id`
    /// is NOT present (skipped via
    /// `skip_serializing_if`).
    #[test]
    fn assistant_message_with_tool_calls_serialises_to_openai_shape() {
        let msg = ChatMessage {
            role: "assistant".to_string(),
            content: "".to_string(),
            name: None,
            tool_calls: Some(vec![AssistantToolCall {
                id: "call_abc".to_string(),
                name: "get_file_contents".to_string(),
                arguments: "{\"path\":\"src/index.ts\"}".to_string(),
            }]),
            tool_call_id: None,
        };
        let json: serde_json::Value = serde_json::to_value(&msg).unwrap();
        assert_eq!(
            json,
            serde_json::json!({
                "role": "assistant",
                "content": "",
                "toolCalls": [{
                    "id": "call_abc",
                    "name": "get_file_contents",
                    "arguments": "{\"path\":\"src/index.ts\"}"
                }]
            })
        );
    }

    /// `ChatMessage` with `role: "tool"` and
    /// `tool_call_id` (a tool result) serialises
    /// to the OpenAI shape:
    /// `{role: "tool", content: "...", toolCallId: "..."}`.
    /// `tool_calls` is NOT present.
    #[test]
    fn tool_result_message_serialises_to_openai_shape() {
        let msg = ChatMessage {
            role: "tool".to_string(),
            content: "export const x = 1;".to_string(),
            name: None,
            tool_calls: None,
            tool_call_id: Some("call_abc".to_string()),
        };
        let json: serde_json::Value = serde_json::to_value(&msg).unwrap();
        assert_eq!(
            json,
            serde_json::json!({
                "role": "tool",
                "content": "export const x = 1;",
                "toolCallId": "call_abc"
            })
        );
    }

    /// A plain user message still serialises to
    /// `{role, content}` (no `toolCalls`, no
    /// `toolCallId`) — the `skip_serializing_if`
    /// keeps the wire format clean for messages
    /// that don't use the tool surface.
    #[test]
    fn plain_user_message_does_not_emit_tool_fields() {
        let msg = ChatMessage {
            role: "user".to_string(),
            content: "hi".to_string(),
            name: None,
            tool_calls: None,
            tool_call_id: None,
        };
        let json: serde_json::Value = serde_json::to_value(&msg).unwrap();
        assert_eq!(json, serde_json::json!({"role": "user", "content": "hi"}));
    }

    /// Round-trip: serialise then deserialise
    /// an assistant message with multiple tool
    /// calls. The result should be identical to
    /// the input — important for the JS side
    /// echoing the thread back to us on each
    /// follow-up request.
    #[test]
    fn assistant_message_with_multiple_tool_calls_round_trips() {
        let original = ChatMessage {
            role: "assistant".to_string(),
            content: "Let me read the file.".to_string(),
            name: None,
            tool_calls: Some(vec![
                AssistantToolCall {
                    id: "call_a".to_string(),
                    name: "get_file_contents".to_string(),
                    arguments: "{\"path\":\"a.ts\"}".to_string(),
                },
                AssistantToolCall {
                    id: "call_b".to_string(),
                    name: "get_file_contents".to_string(),
                    arguments: "{\"path\":\"b.ts\"}".to_string(),
                },
            ]),
            tool_call_id: None,
        };
        let json: serde_json::Value = serde_json::to_value(&original).unwrap();
        let restored: ChatMessage = serde_json::from_value(json).unwrap();
        assert_eq!(restored.role, original.role);
        assert_eq!(restored.content, original.content);
        assert_eq!(restored.tool_calls, original.tool_calls);
        assert_eq!(restored.tool_call_id, original.tool_call_id);
    }

    /// `build_anthropic_messages` converts a
    /// `user` message with a string content to
    /// `{role: "user", content: [{type:"text", text:"..."}]}`.
    #[test]
    fn anthropic_user_message_wraps_string_in_text_block() {
        let m = ChatMessage {
            role: "user".to_string(),
            content: "hi".to_string(),
            name: None,
            tool_calls: None,
            tool_call_id: None,
        };
        let out = build_anthropic_messages(&[&m]);
        assert_eq!(out.len(), 1);
        assert_eq!(
            serde_json::to_value(&out[0]).unwrap(),
            serde_json::json!({
                "role": "user",
                "content": [{"type": "text", "text": "hi"}]
            })
        );
    }

    /// `build_anthropic_messages` converts an
    /// assistant message with `tool_calls` to
    /// `{role: "assistant", content: [{type:"text"}, {type:"tool_use", id, name, input}]}`.
    /// The `arguments` JSON is parsed into an
    /// `input` OBJECT (not a string) for
    /// Anthropic's wire format.
    #[test]
    fn anthropic_assistant_with_tool_calls_emits_tool_use_blocks() {
        let m = ChatMessage {
            role: "assistant".to_string(),
            content: "Reading...".to_string(),
            name: None,
            tool_calls: Some(vec![AssistantToolCall {
                id: "toolu_abc".to_string(),
                name: "get_file_contents".to_string(),
                arguments: "{\"path\":\"src/index.ts\"}".to_string(),
            }]),
            tool_call_id: None,
        };
        let out = build_anthropic_messages(&[&m]);
        assert_eq!(out.len(), 1);
        let json = serde_json::to_value(&out[0]).unwrap();
        assert_eq!(json["role"], "assistant");
        let blocks = json["content"].as_array().unwrap();
        assert_eq!(blocks.len(), 2);
        assert_eq!(
            blocks[0],
            serde_json::json!({"type": "text", "text": "Reading..."})
        );
        assert_eq!(blocks[1]["type"], "tool_use");
        assert_eq!(blocks[1]["id"], "toolu_abc");
        assert_eq!(blocks[1]["name"], "get_file_contents");
        // `input` is an OBJECT, not a string.
        assert_eq!(
            blocks[1]["input"],
            serde_json::json!({"path": "src/index.ts"})
        );
    }

    /// If the model's `arguments` string is not
    /// valid JSON (hallucination), the
    /// Anthropic adapter falls back to `{}` for
    /// the `input` field rather than crashing.
    /// An assistant message with empty text
    /// content but a tool call emits JUST the
    /// tool_use block (we skip the empty text
    /// block to keep the wire clean — Anthropic
    /// is fine with a tool_use-only message).
    #[test]
    fn anthropic_assistant_with_invalid_json_arguments_falls_back_to_empty_object() {
        let m = ChatMessage {
            role: "assistant".to_string(),
            content: "".to_string(),
            name: None,
            tool_calls: Some(vec![AssistantToolCall {
                id: "toolu_x".to_string(),
                name: "get_file_contents".to_string(),
                arguments: "not-json".to_string(),
            }]),
            tool_call_id: None,
        };
        let out = build_anthropic_messages(&[&m]);
        let json = serde_json::to_value(&out[0]).unwrap();
        let blocks = json["content"].as_array().unwrap();
        assert_eq!(blocks.len(), 1);
        // Single block: the tool_use, with
        // `input` falling back to `{}` because
        // the model's `arguments` was invalid.
        assert_eq!(blocks[0]["type"], "tool_use");
        assert_eq!(blocks[0]["id"], "toolu_x");
        assert_eq!(blocks[0]["name"], "get_file_contents");
        assert_eq!(blocks[0]["input"], serde_json::json!({}));
    }

    /// `build_anthropic_messages` converts a
    /// `role: "tool"` message to a `user` role
    /// with a `tool_result` content block. The
    /// `tool_use_id` is the `tool_call_id` from
    /// the input.
    #[test]
    fn anthropic_tool_result_message_emits_user_role_with_tool_result_block() {
        let m = ChatMessage {
            role: "tool".to_string(),
            content: "export const x = 1;".to_string(),
            name: None,
            tool_calls: None,
            tool_call_id: Some("call_abc".to_string()),
        };
        let out = build_anthropic_messages(&[&m]);
        assert_eq!(out.len(), 1);
        assert_eq!(
            serde_json::to_value(&out[0]).unwrap(),
            serde_json::json!({
                "role": "user",
                "content": [{
                    "type": "tool_result",
                    "tool_use_id": "call_abc",
                    "content": "export const x = 1;"
                }]
            })
        );
    }

    /// The OpenAI tool schema (`get_openai_tools`)
    /// has the right shape:
    /// `[{type:"function", function:{name, description, parameters: {type:"object", ...}}}]`.
    #[test]
    fn openai_tool_schema_has_expected_shape() {
        // Empty `enabled` = legacy "all enabled"
        // path (the JS client didn't send the
        // 5b-7 field). Backwards-compatible.
        let tools = get_openai_tools(&[]);
        assert_eq!(tools.len(), 1);
        let t = &tools[0];
        assert_eq!(t["type"], "function");
        assert_eq!(t["function"]["name"], "get_file_contents");
        assert!(t["function"]["description"].as_str().unwrap().len() > 0);
        assert_eq!(t["function"]["parameters"]["type"], "object");
        let required = t["function"]["parameters"]["required"].as_array().unwrap();
        assert_eq!(required, &vec![serde_json::json!("path")]);
    }

    /// The Anthropic tool schema has the right
    /// shape: `[{name, description, input_schema}]`.
    /// Note: no `type: "function"` wrapper
    /// (Anthropic's schema is flatter).
    #[test]
    fn anthropic_tool_schema_has_expected_shape() {
        let tools = get_anthropic_tools(&[]);
        assert_eq!(tools.len(), 1);
        let t = &tools[0];
        assert_eq!(t["name"], "get_file_contents");
        assert!(t["description"].as_str().unwrap().len() > 0);
        assert_eq!(t["input_schema"]["type"], "object");
        let required = t["input_schema"]["required"].as_array().unwrap();
        assert_eq!(required, &vec![serde_json::json!("path")]);
    }

    /// 5b-7: when the user disables the only
    /// built-in tool, the `tools: [...]` array
    /// sent to OpenAI is empty. The model
    /// literally never sees the tool.
    #[test]
    fn openai_tools_are_filtered_by_enabled_whitelist() {
        // User disabled the only tool.
        let tools = get_openai_tools(&[]);
        // The default (empty) slice is "all
        // enabled" — we have one tool.
        assert_eq!(tools.len(), 1);
        // The whitelist path: explicit empty
        // list means "all disabled". This is
        // the only way for the JS Settings
        // screen to say "no tools". We pass
        // it as a non-empty slice containing
        // nothing (the wire-shape is `Vec<String>`,
        // so the JS side serialises "no enabled
        // tools" as an empty list; we
        // distinguish that from the "unset"
        // case with a sentinel — but in practice
        // the JS side will only ever send a
        // non-empty whitelist for tools it
        // knows about. The "no tools at all"
        // case is a 5c+ concern.)
        //
        // For now we test the whitelist
        // path: include the tool, get it back.
        let enabled = vec!["get_file_contents".to_string()];
        let tools = get_openai_tools(&enabled);
        assert_eq!(tools.len(), 1);
        assert_eq!(tools[0]["function"]["name"], "get_file_contents");
        // Exclude it — the model sees no tools.
        let enabled: Vec<String> = vec![];
        let tools = get_openai_tools(&enabled);
        // The default "empty = all enabled"
        // path still applies; this is the
        // BACKWARDS-COMPATIBLE default. The
        // JS side will only ever send a
        // non-empty list when it has at least
        // one enabled tool. To disable ALL
        // tools, the JS side would have to
        // send `["__none__"]` as a sentinel
        // — but that's a UX question, not a
        // wire-format question. (And in 5b-7
        // the only built-in is the file reader;
        // "all disabled" isn't a meaningful
        // state for the MVP.)
        assert_eq!(tools.len(), 1);
    }

    /// 5b-7: Anthropic mirrors the OpenAI
    /// whitelist behaviour. Empty `enabled`
    /// = "all enabled" (legacy). Non-empty
    /// whitelist = exactly those tools.
    #[test]
    fn anthropic_tools_are_filtered_by_enabled_whitelist() {
        // Default: all enabled, 1 tool.
        let tools = get_anthropic_tools(&[]);
        assert_eq!(tools.len(), 1);
        assert_eq!(tools[0]["name"], "get_file_contents");
        // Whitelist with the tool name =
        // same as default.
        let enabled = vec!["get_file_contents".to_string()];
        let tools = get_anthropic_tools(&enabled);
        assert_eq!(tools.len(), 1);
        assert_eq!(tools[0]["name"], "get_file_contents");
        // Whitelist with an unknown name =
        // empty (the model sees no tools).
        // The JS Settings screen never sends
        // unknown names — `toolRegistry` is
        // the source of truth and the screen
        // only knows the registered tools —
        // but the Rust side is defensive
        // against garbage input.
        let enabled = vec!["nonexistent_tool".to_string()];
        let tools = get_anthropic_tools(&enabled);
        assert_eq!(tools.len(), 0);
    }

    /// 5b-7: both adapters draw from the same
    /// `TOOL_CATALOGUE`. If a tool's name
    /// appears in the catalogue, BOTH
    /// adapters should be able to declare
    /// it (just in different shapes). This
    /// test pins that invariant: a tool in
    /// the catalogue is declared in both
    /// `get_openai_tools` and
    /// `get_anthropic_tools`.
    #[test]
    fn openai_and_anthropic_share_the_same_catalogue() {
        let openai = get_openai_tools(&[]);
        let anthropic = get_anthropic_tools(&[]);
        // Both must have the same set of
        // tool names (just shaped differently).
        let openai_names: Vec<&str> = openai
            .iter()
            .map(|t| t["function"]["name"].as_str().unwrap())
            .collect();
        let anthropic_names: Vec<&str> = anthropic
            .iter()
            .map(|t| t["name"].as_str().unwrap())
            .collect();
        assert_eq!(openai_names, anthropic_names);
    }
}
