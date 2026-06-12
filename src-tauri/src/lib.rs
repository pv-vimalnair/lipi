//! Lipi — Rust core.
//!
//! Phase 1b: window, frontend mount, updater plugin, `get_app_version`.
//! Phase 2a: virtual filesystem commands (read_dir, read_file,
//!           write_file, pick_folder) — see `fs.rs` for the impls.
//! Phase 3a: read-only git (open, status, current_branch) — see `git.rs`.
//! Phase 3b: git module is `pub use`d for integration tests
//!           (`tests/git_status_smoke.rs`); the IPC commands stay
//!           private to this crate.
//! Phase 3c-1: added `git_diff` and `git_discard` Tauri commands,
//!           and a real `ahead_behind` walk via gix-revwalk.
//! Phase 4a: added embedded-terminal pipe (`src/terminal.rs` +
//!           portable-pty + 4 Tauri commands: `terminal_open`,
//!           `terminal_write`, `terminal_resize`, `terminal_close`).
//!           No UI yet — xterm.js lands in 4b.
//!
//! Future modules behind this same shell:
//!
//!   M2  src/voice/       — on-device STT + Wispr client
//!
//! See HANDOFF.md §6 (How to continue) for the phase order.

use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_dialog::DialogExt;

mod fs;
use fs::{read_dir, read_file, write_file, FsEntry, FsError, FileContent};

mod menu;

mod git;
pub use git::{
    commit, diff, discard, open_repo, stage_all, status, validate_commit_message,
    ChangeKind, ChangedFile, CommitResult, FileDiff, GitError, RepoHandle, RepoStatus,
};
use git::current_branch;

mod terminal;
pub use terminal::{
    default_shell as terminal_default_shell, open as terminal_open_rs, resize as terminal_resize_rs,
    write as terminal_write_rs, close as terminal_close_rs, EventSink, OpenOptions, OpenResult,
    TerminalError, TerminalState,
};

mod secrets;
pub use secrets::{delete_api_key as secrets_delete_rs, get_api_key as secrets_get_api_key_rs, has_api_key as secrets_has_rs, set_api_key as secrets_set_rs, SecretError};

mod ai;
pub use ai::{get_configured_providers as ai_get_configured_providers_rs, list_providers as ai_list_providers_rs, provider_by_id, ProviderInfo};

mod chat;
pub use chat::{stream_chat_anthropic, stream_chat_openai, ChatDelta, ChatError, ChatMessage};

mod custom_tool;
pub use custom_tool::{
    custom_tool_to_anthropic, custom_tool_to_openai, merge_tool_list,
    merge_tool_list_anthropic, CustomToolArg, CustomToolSpec,
};

mod command;
pub use command::{run_command as run_command_rs, RunCommandArgs, RunCommandError, RunCommandResult};

mod http;
pub use http::{http_request as http_request_rs, HttpRequestArgs, HttpRequestError, HttpRequestResult};

mod lipi_tools;
pub use lipi_tools::{
    lipi_tools_path as lipi_tools_path_rs, read_lipi_tools as read_lipi_tools_rs,
    write_lipi_tools as write_lipi_tools_rs, LipiToolArgSpec, LipiToolEntry, LipiToolKind,
    LipiToolsError, LipiToolsFile, LIPI_TOOLS_FILENAME,
};

mod cancel;

#[derive(Debug, Serialize)]
struct AppVersion {
    product_name: &'static str,
    version: &'static str,
}

/// Returns the app's product name and version. Used by the frontend
/// settings screen and by the updater dialog. Trivially proves the
/// IPC bridge is alive.
#[tauri::command]
fn get_app_version() -> AppVersion {
    AppVersion {
        product_name: env!("CARGO_PKG_NAME"),
        version: env!("CARGO_PKG_VERSION"),
    }
}

/// F.4: open the WebView developer tools. The Tauri 2 JS
/// webview API does not expose this directly (it's a Rust
/// `WebviewWindow::open_devtools()` method on the runtime),
/// so we wrap it in a one-line IPC. Called from the
/// View > Toggle Developer Tools menu item, routed through
/// `useMenuEvents`.
///
/// No-op on platforms that don't support devtools (e.g.
/// Android — see the `@tauri-apps/api` `WebviewConfig.devtools`
/// doc for the full matrix). On Windows the devtools
/// inspector is part of WebView2; on macOS it's the
/// Safari Web Inspector; on Linux it depends on the
/// webkit2gtk build.
#[tauri::command]
fn open_devtools(window: tauri::WebviewWindow) -> Result<(), String> {
    window.open_devtools();
    Ok(())
}

// --- Phase 2a: virtual filesystem commands ---------------------------------

#[tauri::command]
fn fs_read_dir(path: String) -> Result<Vec<FsEntry>, FsError> {
    read_dir(std::path::Path::new(&path))
}

#[tauri::command]
fn fs_read_file(path: String) -> Result<FileContent, FsError> {
    read_file(std::path::Path::new(&path))
}

#[tauri::command]
fn fs_write_file(path: String, content: String) -> Result<(), FsError> {
    write_file(std::path::Path::new(&path), &content)
}

// --- Phase 5c: custom tool shell executor ---------------------------------
//
// The JS `toolRegistry` calls this for any
// `kind: "shell"` custom tool. The 5c MVP
// hardcodes the timeout (`DEFAULT_TIMEOUT`)
// and output cap (`MAX_OUTPUT_BYTES_DEFAULT`)
// in `command.rs`; per-tool overrides are a
// 5d+ enhancement.

#[tauri::command]
async fn run_command(args: RunCommandArgs) -> Result<RunCommandResult, RunCommandError> {
    run_command_rs(args).await
}

#[tauri::command]
async fn http_request(
    args: HttpRequestArgs,
) -> Result<HttpRequestResult, HttpRequestError> {
    http_request_rs(args).await
}

// --- Phase 5c: workspace-local lipi-tools.json storage -----------------
//
// The user's custom tools live in a JSON file
// at the root of the open workspace
// (`<workspace>/lipi-tools.json`). The JS
// `customToolsStore` is the source of truth at
// runtime; the Rust side just provides
// read/write primitives. The JS side supplies
// the workspace root on every call (no global
// state — the workspace can change between
// requests, and we'd rather not cache it on
// the Rust side in 5c).

/// 5c: read the workspace-local
/// `lipi-tools.json`. If the file doesn't
/// exist, returns the empty file (not an
/// error) — this is the "first run" path
/// for the user. The JS store calls this
/// on workspace open + on every
/// "refresh" action.
#[tauri::command]
fn read_lipi_tools(workspace_root: String) -> Result<LipiToolsFile, LipiToolsError> {
    let path = std::path::Path::new(&workspace_root);
    match read_lipi_tools_rs(path) {
        Ok(file) => Ok(file),
        Err(LipiToolsError::NotFound { .. }) => Ok(LipiToolsFile::empty()),
        Err(e) => Err(e),
    }
}

/// 5c: write the workspace-local
/// `lipi-tools.json`. Validates the
/// in-memory representation before
/// touching disk (rejects duplicate
/// tool names, unsupported version,
/// etc.). The JS store calls this on
/// every add / edit / delete action —
/// the in-memory list is the source of
/// truth, the file is just a
/// persistence layer.
#[tauri::command]
fn write_lipi_tools(
    workspace_root: String,
    file: LipiToolsFile,
) -> Result<(), LipiToolsError> {
    let path = std::path::Path::new(&workspace_root);
    write_lipi_tools_rs(path, &file)
}

/// Open the native folder picker. The dialog runs on a blocking
/// channel because `pick_folder` is sync by spec (we want the
/// frontend `await` to be the only wait).
#[tauri::command]
async fn fs_pick_folder(app: tauri::AppHandle) -> Result<Option<String>, FsError> {
    let (tx, rx) = std::sync::mpsc::channel::<Option<PathBuf>>();
    app.dialog().file().pick_folder(move |selected| {
        let result = selected.and_then(|fp| fp.into_path().ok());
        let _ = tx.send(result);
    });
    let chosen = tokio::task::spawn_blocking(move || rx.recv().ok().flatten())
        .await
        .map_err(|e| FsError::Io(e.to_string()))?;
    Ok(chosen.map(|p| p.display().to_string()))
}

// --- Phase 3a: git (read-only) -------------------------------------------

#[tauri::command]
fn git_open(path: String) -> Result<RepoHandle, GitError> {
    open_repo(std::path::Path::new(&path))
}

#[tauri::command]
fn git_status(repo_id: String) -> Result<RepoStatus, GitError> {
    let handle = RepoHandle { workdir: repo_id };
    status(&handle)
}

#[tauri::command]
fn git_current_branch(repo_id: String) -> Result<Option<String>, GitError> {
    let handle = RepoHandle { workdir: repo_id };
    current_branch(&handle)
}

// --- Phase 3c-1: git (diff + discard) -------------------------------------

/// Compute a per-file diff between HEAD and the worktree. The `path`
/// is the absolute worktree path (matching `ChangedFile.path`). Used
/// by the 3c-2 side panel to render a Monaco DiffEditor.
#[tauri::command]
fn git_diff(repo_id: String, path: String) -> Result<FileDiff, GitError> {
    let handle = RepoHandle { workdir: repo_id };
    diff(&handle, std::path::Path::new(&path))
}

/// Discard unstaged worktree changes to a single file by writing
/// HEAD's blob back to the worktree (or deleting the file if it
/// doesn't exist in HEAD — i.e. an untracked / staged-add file).
/// On success the caller is expected to call `git_status` to refresh.
#[tauri::command]
fn git_discard(repo_id: String, path: String) -> Result<(), GitError> {
    let handle = RepoHandle { workdir: repo_id };
    discard(&handle, std::path::Path::new(&path))
}

// --- Phase M4: voice-driven commit ---------------------------------------
//
// Used by the AI composer's "commit by voice" flow.
// The voice command parser (in
// `src/voice/commitGrammar.ts`) produces a commit
// message; this IPC writes it to the repo's history
// after staging all worktree changes. We use the
// repo's configured `user.name` / `user.email`
// (which the user set when they initialised the
// repo) — we never accept an arbitrary author
// identity from the JS side; voice can't tell us
// who the user is.

/// Stage all worktree changes. Used internally by
/// `git_commit`; also exposed as a separate command
/// for the future "stage by voice" flow that doesn't
/// commit (e.g. "stage everything but don't commit
/// yet"). The 5c MCP tooling will probably want
/// this too.
#[tauri::command]
fn git_stage_all(repo_id: String) -> Result<(), GitError> {
    let handle = RepoHandle { workdir: repo_id };
    stage_all(&handle)
}

/// Commit the staged changes with the given
/// message. Internally calls `git_stage_all` first,
/// then `git commit -m <message> --no-verify`. The
/// `--no-verify` flag is intentional — the voice
/// command IS the user's explicit intent, and we
/// don't want a `pre-commit` hook to silently
/// block the commit and leave the user wondering
/// what went wrong. (M5 may add a "skip hooks"
/// toggle in the Settings panel for users who
/// have hook-driven commit workflows.)
///
/// Returns the new commit's SHA + short SHA. The
/// JS side surfaces a "Created commit <short> via
/// voice" toast and the SHA is used in M4's
/// follow-up feature: the next AI chat message can
/// be pre-seeded with "Look at the changes in
/// commit <short>".
#[tauri::command]
fn git_commit(repo_id: String, message: String) -> Result<CommitResult, GitError> {
    // Validate early so the JS side gets a typed
    // error path (the store's setError renders the
    // message in red and shows a "dismiss" button).
    validate_commit_message(&message)?;
    let handle = RepoHandle { workdir: repo_id };
    commit(&handle, &message)
}

// --- Phase 4a: embedded terminal (pipe only, no UI) ------------

/// Event names emitted by the terminal pipe. The JS side
/// subscribes to both via `listen('terminal://output', ...)`
/// and `listen('terminal://exit', ...)`.
const TERMINAL_EVENT_OUTPUT: &str = "terminal://output";
const TERMINAL_EVENT_EXIT: &str = "terminal://exit";

/// Payload of `terminal://output`. `sessionId` matches the id
/// returned by `terminal_open`. `data` is a raw byte array
/// (terminals emit non-UTF-8 escape sequences; the JS side
/// feeds these straight to xterm.js's `write(Uint8Array)`).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct OutputPayload {
    session_id: String,
    data: Vec<u8>,
}

/// Payload of `terminal://exit`. `exitCode` is the integer
/// returned by the shell process (0 on success, non-zero on
/// error). `None` is reserved for the case where the child
/// was killed by a signal — portable-pty's `ExitStatus`
/// always returns a code on the platforms we ship to, so
/// this is mainly future-proofing.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ExitPayload {
    session_id: String,
    exit_code: Option<i32>,
}

/// `EventSink` impl backed by `AppHandle::emit`. Each emit is
/// fire-and-forget; we don't await subscribers. Tauri's event
/// channel is MPSC internally and the emit path is
/// non-blocking from our side.
struct TauriEventSink {
    app: AppHandle,
}

impl EventSink for TauriEventSink {
    fn emit_output(&self, session_id: &str, data: Vec<u8>) {
        let payload = OutputPayload {
            session_id: session_id.to_string(),
            data,
        };
        if let Err(e) = self.app.emit(TERMINAL_EVENT_OUTPUT, &payload) {
            log::warn!("failed to emit terminal output: {e}");
        }
    }
    fn emit_exit(&self, session_id: &str, exit_code: Option<i32>) {
        let payload = ExitPayload {
            session_id: session_id.to_string(),
            exit_code,
        };
        if let Err(e) = self.app.emit(TERMINAL_EVENT_EXIT, &payload) {
            log::warn!("failed to emit terminal exit: {e}");
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TerminalOpenArgs {
    rows: Option<u16>,
    cols: Option<u16>,
    shell: Option<String>,
}

/// Open a new terminal session. Spawns the user's default
/// shell (or the override in `args.shell`) inside a PTY of
/// the requested size and starts the reader thread. The
/// caller receives the new `sessionId` and should subscribe
/// to `terminal://output` / `terminal://exit` BEFORE the first
/// write (events for the shell's prompt may arrive
/// milliseconds after `open` returns).
#[tauri::command]
fn terminal_open(
    app: AppHandle,
    state: tauri::State<'_, Arc<TerminalState>>,
    args: TerminalOpenArgs,
) -> Result<OpenResult, TerminalError> {
    let sink: Arc<dyn EventSink> = Arc::new(TauriEventSink { app });
    let opts = OpenOptions {
        shell: args.shell,
        rows: args.rows.unwrap_or(24),
        cols: args.cols.unwrap_or(80),
    };
    terminal_open_rs(state.inner(), opts, sink)
}

/// Write a chunk of bytes to the session's stdin. The bytes
/// are written raw — the JS side (xterm.js) is the source of
/// truth for terminal encoding semantics (line endings, ^C,
/// escape sequences, etc.).
#[tauri::command]
fn terminal_write(
    state: tauri::State<'_, Arc<TerminalState>>,
    session_id: String,
    data: Vec<u8>,
) -> Result<(), TerminalError> {
    terminal_write_rs(state.inner(), &session_id, &data)
}

/// Resize the PTY. The shell receives the appropriate
/// "window changed" signal (SIGWINCH on Unix, ConPTY
/// equivalent on Windows) and well-behaved shells re-flow.
#[tauri::command]
fn terminal_resize(
    state: tauri::State<'_, Arc<TerminalState>>,
    session_id: String,
    rows: u16,
    cols: u16,
) -> Result<(), TerminalError> {
    terminal_resize_rs(state.inner(), &session_id, rows, cols)
}

/// Close the session. Idempotent.
#[tauri::command]
fn terminal_close(
    state: tauri::State<'_, Arc<TerminalState>>,
    session_id: String,
) -> Result<(), TerminalError> {
    terminal_close_rs(state.inner(), &session_id)
}

/// Returns the platform's default shell path. Used by the
/// settings screen to show the user "Terminal: cmd.exe" or
/// "Terminal: /bin/zsh" so they know which shell they'll
/// get when they open a new terminal.
#[tauri::command]
fn terminal_default_shell_cmd() -> String {
    terminal_default_shell()
}

// --- Phase 5a: secrets + AI provider registry ----------------------------

/// Save (or overwrite) an AI provider API key in the OS
/// keychain. The key never enters the JS bundle — the
/// frontend hands the raw value to the Rust side via
/// this command, which immediately writes it to the
/// keychain and returns. The frontend clears its input
/// field on success.
#[tauri::command]
fn secrets_set_api_key(provider: String, key: String) -> Result<(), SecretError> {
    secrets_set_rs(&provider, &key)
}

/// Returns `true` if the given provider has a key in the
/// keychain. Used by the Settings screen to render the
/// "Configured" / "Not configured" badge. The actual key
/// value is never returned to the JS side.
#[tauri::command]
fn secrets_has_api_key(provider: String) -> Result<bool, SecretError> {
    secrets_has_rs(&provider)
}

/// Delete the API key for the given provider. Idempotent.
#[tauri::command]
fn secrets_delete_api_key(provider: String) -> Result<(), SecretError> {
    secrets_delete_rs(&provider)
}

/// M2b: returns the raw API key for the given provider.
///
/// Unlike the AI providers (whose keys are read by the Rust
/// AI proxy and never enter the JS side per Decision #17),
/// the Wispr Flow WebSocket must be opened from the WebView
/// (the audio is captured in JS, the WebSocket API lives
/// in the browser). The key still lives in the OS keychain
/// and is NEVER persisted to localStorage or sent to any
/// server other than `platform-api.wisprflow.ai`. It is
/// fetched from Rust, held in a local variable for the
/// duration of the WebSocket call, and dropped on
/// `stop()` / unmount.
///
/// Returns `None` if the provider has no key in the
/// keychain. Throws `SecretError` on keychain errors.
///
/// Threat model:
///   - The key is exposed to the JS side, but only in the
///     same trust boundary as the AI proxy: Lipi itself,
///     running in the user's own WebView.
///   - The key is NOT logged, NOT sent to any URL other
///     than the Wispr WebSocket endpoint, and NOT held in
///     any global state.
///   - The keychain entry is still authoritative; this
///     command is a "give me the secret one time" call.
#[tauri::command]
fn secrets_get_api_key(provider: String) -> Result<Option<String>, SecretError> {
    secrets_get_api_key_rs(&provider)
}

/// Returns the static list of supported AI providers.
/// The frontend renders one Settings card per entry.
/// See `ai.rs::ProviderInfo` for the shape.
#[tauri::command]
fn ai_list_providers() -> Vec<ProviderInfo> {
    ai_list_providers_rs()
}

/// Returns the ids of providers that currently have a
/// key in the keychain. Used by the AI panel to render
/// the "configured" / "not configured" state without
/// three separate `secrets_has_api_key` round-trips.
#[tauri::command]
fn ai_get_configured_providers() -> Vec<String> {
    ai_get_configured_providers_rs()
        .into_iter()
        .map(|s| s.to_string())
        .collect()
}

// --- Phase 5b-1: streaming chat command ----------------------------------
//
// The actual SSE parsing and HTTP work lives in
// `chat.rs`. This module is the Tauri-command
// wrapper: it reads the API key from the
// keychain, generates a `requestId`, spawns a
// tokio task that calls `stream_chat_openai`,
// and emits `ai://chunk` / `ai://done` /
// `ai://error` events tagged with that
// `requestId`. The JS side demuxes by
// `requestId` (same pattern as 4a's terminal).

/// Event names emitted by the chat pipeline. The
/// JS side subscribes once at app startup (in the
/// `aiStore` we add in 5b-3) and demuxes by
/// `requestId`.
const AI_EVENT_CHUNK: &str = "ai://chunk";
const AI_EVENT_DONE: &str = "ai://done";
const AI_EVENT_ERROR: &str = "ai://error";

/// The request body that crosses the IPC
/// boundary from JS → Rust. Matches the
/// `OpenAiRequest` shape in `chat.rs` (camelCase).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChatRequestArgs {
    /// One of `"openai"`, `"anthropic"`, `"openrouter"`.
    /// We use this to look up the base URL and the
    /// keychain entry. Unknown providers cause
    /// `ChatError::UnknownProvider`.
    provider: String,
    /// Model id (e.g. `"gpt-4o-mini"`). Optional —
    /// we default to the provider's `default_model`
    /// from `ai_list_providers` if absent.
    model: Option<String>,
    /// Chat thread. The JS side assembles this
    /// from the in-memory `aiStore.messages` plus
    /// the new user message; we don't persist
    /// history on the Rust side (5b-3 keeps the
    /// source of truth in the store).
    messages: Vec<ChatMessage>,
    /// 5b-7: per-tool enable/disable whitelist.
    /// The JS Settings screen collects this from
    /// the user and passes it on every chat-stream
    /// request (it's a snapshot of the current
    /// state of `toolSettingsStore`). Empty slice
    /// = "all tools enabled" (backwards-compat
    /// default for clients that pre-date 5b-7).
    /// The Rust side uses this to filter the
    /// `tools: [...]` array sent to the provider —
    /// a disabled tool is invisible to the model.
    /// The JS-side executor also refuses to run
    /// any tool in this list, but that's a
    /// belt-and-braces check (the model shouldn't
    /// have asked for a disabled tool in the first
    /// place; this handles the "user toggled off
    /// mid-stream" race).
    #[serde(default)]
    enabled_tool_names: Vec<String>,
    /// 5c: per-request custom tool list. The JS
    /// `customToolsStore` is the source of truth at
    /// runtime; we just pass the snapshot across the
    /// IPC boundary so the Rust side can declare them
    /// to the model. Empty slice = no custom tools.
    /// The `customToolsStore` writes/reads the
    /// `lipi-tools.json` file separately (the
    /// `read_lipi_tools` / `write_lipi_tools` Tauri
    /// commands — see 5c-11). This field is a
    /// denormalised snapshot of the current contents
    /// of that file (or whatever subset the user
    /// actually wants to send to the model — a 5d+
    /// enhancement could let the user toggle
    /// individual custom tools on/off like 5b-7
    /// does for built-ins).
    #[serde(default)]
    custom_tools: Vec<CustomToolSpec>,
}

/// Payload of `ai://chunk`. The JS side reads
/// `payload.kind` (one of `"delta"` / `"done"` /
/// `"error"`) and the variant-specific fields.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
enum ChatEventPayload {
    Delta { text: String },
    /// 5b-4: a complete tool call (function name +
    /// assembled JSON argument). The model has
    /// decided to invoke a named function. The JS
    /// store appends this to the current
    /// streaming assistant message's
    /// `toolCalls` array. Execution and
    /// follow-up is a future phase; 5b-4 is
    /// just the streaming + storage surface.
    ToolCall {
        /// Provider-assigned id (OpenAI `call_…`,
        /// Anthropic `toolu_…`).
        id: String,
        /// Function name, e.g. `get_weather`.
        name: String,
        /// Concatenated JSON argument string.
        /// May be `""` for no-arg tools, or
        /// invalid JSON if the model
        /// hallucinated.
        input: String,
    },
    Done {
        cancelled: bool,
        /// Anthropic only (5b-2). One of
        /// `"end_turn" | "max_tokens" | "stop_sequence" | "tool_use"`.
        /// `None` for OpenAI / OpenRouter and for
        /// user-cancelled completions.
        /// `tool_use` indicates the model finished
        /// its turn by emitting one or more tool
        /// calls; the corresponding `ToolCall`
        /// chunks will have arrived BEFORE this
        /// `Done` (5b-4).
        #[serde(skip_serializing_if = "Option::is_none", default)]
        stop_reason: Option<String>,
    },
    Error { error_kind: String, message: String },
}

impl From<ChatDelta> for ChatEventPayload {
    fn from(d: ChatDelta) -> Self {
        match d {
            ChatDelta::Delta { text } => ChatEventPayload::Delta { text },
            ChatDelta::ToolCall { id, name, input } => {
                ChatEventPayload::ToolCall { id, name, input }
            }
            ChatDelta::Done { cancelled, stop_reason } => ChatEventPayload::Done {
                cancelled,
                stop_reason,
            },
            ChatDelta::Error { error_kind, message } => {
                ChatEventPayload::Error { error_kind, message }
            }
        }
    }
}

/// Open a streaming chat completion. Returns the
/// `requestId` synchronously so the JS side can
/// subscribe to `ai://chunk` / `ai://done` /
/// `ai://error` BEFORE the first chunk arrives
/// (the provider's first event can come back in
/// <50ms; the JS subscription must be in place
/// first, or the chunk is lost).
///
/// The 5b-2 surface is:
///   - three providers: `openai`, `openrouter`,
///     `anthropic`. Dispatch is by provider id
///     in `provider_by_id(...)`. The two
///     OpenAI-compatible providers share the
///     OpenAI adapter (base-URL swap). Anthropic
///     uses its own adapter.
///   - cancellation: the `cancel::register()`
///     function stores an `Arc<AtomicBool>` in
///     the process-wide registry under
///     `request_id`. `ai_cancel_stream(...)`
///     flips the flag; the reader task checks
///     it between SSE events.
///   - no retry, no backoff (5c territory).
///
/// Errors that happen before the first chunk
/// are emitted as `ai://error` so the JS side
/// can show an inline error. Errors that
/// happen during streaming are emitted as
/// `ChatDelta::Error` chunks (which the JS
/// store demuxes into the same error UI).
#[tauri::command]
async fn ai_chat_stream(
    app: AppHandle,
    args: ChatRequestArgs,
) -> Result<String, ChatError> {
    // Look up the provider. Unknown provider
    // id → `ChatError::UnknownProvider`. The JS
    // side pre-validates with `ai_list_providers`
    // so this branch is defensive.
    let provider = provider_by_id(&args.provider)
        .ok_or_else(|| ChatError::UnknownProvider(args.provider.clone()))?;

    // Read the API key from the keychain. We
    // never log it; we never return it.
    let api_key = secrets::get_api_key(&args.provider)
        .map_err(|_| ChatError::MissingApiKey(args.provider.clone()))?
        .ok_or_else(|| ChatError::MissingApiKey(args.provider.clone()))?;

    // Pick the model: explicit arg wins, else
    // the provider's default.
    let model = args
        .model
        .unwrap_or_else(|| provider.default_model.to_string());

    // Generate the requestId. We use the same
    // scheme as the terminal session ids: 16
    // random bytes → 32-char hex string. This
    // is what the JS side uses to demux events.
    let request_id = format!("ai_{}", random_hex(16));

    // Register the cancellation token in the
    // process-wide registry. The task holds
    // the `CancelGuard` for the duration of
    // the stream; when the task exits, the
    // guard drops and the entry is removed.
    // We also clone `request_id` so we can
    // still return it from this function
    // after the spawned task takes
    // ownership of its own copy.
    let (cancel, cancel_guard) = cancel::register(&request_id);
    let request_id_for_spawn = request_id.clone();

    // Clone the AppHandle into the spawned
    // task. The task emits events tagged with
    // `request_id`; the JS side subscribes
    // BEFORE this `spawn` returns.
    let app_handle = app.clone();
    let provider_id = args.provider.clone();
    let messages = args.messages.clone();
    // 5b-7: per-tool whitelist. Pass it into
    // the adapter so the `tools: [...]` array
    // sent to the provider is filtered. A
    // request that the JS side submitted
    // without this field will get the
    // "empty slice = all enabled" default.
    let enabled_tool_names = args.enabled_tool_names.clone();
    // 5c: pass custom tools through to the
    // adapter. The JS side is the source of
    // truth — this is just a denormalised
    // snapshot of `customToolsStore` for the
    // current request. Empty slice = no
    // custom tools (backwards-compat for
    // pre-5c clients, just like
    // `enabled_tool_names`).
    let custom_tools = args.custom_tools.clone();

    // Shared state for the final `ai://done`
    // emit. The `on_chunk` closure may see
    // a `Done` chunk with a `stop_reason`
    // (Anthropic) or a bare `Done` (OpenAI).
    // We capture the most recent `Done`
    // payload here so the `ai://done` event
    // carries the same `stop_reason`.
    let done_state = Arc::new(Mutex::new(DoneState::default()));

    tokio::spawn(async move {
        let app = app_handle;
        let request_id = request_id_for_spawn;
        let _cancel_guard = cancel_guard; // hold for task lifetime

        // The `on_chunk` closure emits
        // `ai://chunk` events. For `Done`
        // chunks, it ALSO records the
        // payload in `done_state` so the
        // task's final `ai://done` emit
        // can carry the same `stop_reason`.
        let app_for_chunk = app.clone();
        let request_id_for_chunk = request_id.clone();
        let done_state_for_chunk = done_state.clone();
        let on_chunk = move |delta: ChatDelta| {
            // If this is a Done chunk, capture
            // the payload before emitting.
            if let ChatDelta::Done { cancelled, stop_reason } = &delta {
                let mut state = done_state_for_chunk.lock().expect("done state poisoned");
                state.cancelled = *cancelled;
                state.stop_reason = stop_reason.clone();
            }
            let payload: ChatEventPayload = delta.into();
            let _ = app_for_chunk.emit(AI_EVENT_CHUNK, ChunkEnvelope {
                request_id: request_id_for_chunk.clone(),
                payload,
            });
        };

        // Dispatch by provider. The OpenAI
        // adapter handles both `openai` and
        // `openrouter` (the only difference is
        // the base URL, which is already in
        // `provider.openai_compatible_base_url`).
        //
        // We pre-resolve the base URL OUTSIDE
        // the match arms so the arms don't
        // need `?` (which would force the
        // async block to return `Result<…,
        // ChatError>` and complicate the
        // final `ai://done` emit).
        let openai_base = provider.openai_compatible_base_url.map(str::to_string);
        let anthropic_base = provider.anthropic_compatible_base_url.map(str::to_string);
        let stream_result: Result<(), ChatError> = match provider_id.as_str() {
            "openai" | "openrouter" => match openai_base {
                Some(base_url) => {
                    stream_chat_openai(
                        &api_key,
                        &base_url,
                        &model,
                        &messages,
                        &enabled_tool_names,
                        &custom_tools,
                        on_chunk,
                        cancel,
                    )
                    .await
                }
                None => Err(ChatError::UnknownProvider(provider_id.clone())),
            },
            "anthropic" => match anthropic_base {
                Some(base_url) => {
                    stream_chat_anthropic(
                        &api_key,
                        &base_url,
                        &model,
                        &messages,
                        &enabled_tool_names,
                        &custom_tools,
                        on_chunk,
                        cancel,
                    )
                    .await
                }
                None => Err(ChatError::UnknownProvider(provider_id.clone())),
            },
            // `provider_by_id` should have
            // caught this, but be defensive.
            _ => Err(ChatError::UnknownProvider(provider_id.clone())),
        };

        if let Err(e) = stream_result {
            let _ = app.emit(AI_EVENT_ERROR, ErrorEnvelope {
                request_id: request_id.clone(),
                kind: "transport".to_string(),
                message: format!("chat_stream failed: {e}"),
            });
        }

        // Final `ai://done` event. We pull the
        // captured `cancelled` / `stop_reason`
        // from `done_state`. If the reader
        // task never emitted a `Done` chunk
        // (e.g. an early transport error),
        // we emit a `cancelled: false,
        // stop_reason: None` envelope — the
        // JS store just needs to know the
        // stream is over.
        let final_state = {
            let s = done_state.lock().expect("done state poisoned");
            (s.cancelled, s.stop_reason.clone())
        };
        let (cancelled, stop_reason) = final_state;
        let _ = app.emit(AI_EVENT_DONE, DoneEnvelope {
            request_id,
            cancelled,
            stop_reason,
        });
    });

    // Return the requestId synchronously.
    Ok(request_id)
}

/// Captured from the last `ChatDelta::Done` chunk
/// emitted by the reader task. Used to enrich the
/// final `ai://done` event with the same
/// `cancelled` / `stop_reason` the JS side saw
/// inline in the last `ai://chunk` event.
#[derive(Default, Clone)]
struct DoneState {
    cancelled: bool,
    stop_reason: Option<String>,
}

/// `ai://chunk` event payload. The `payload`
/// field is the variant-specific delta / tool
/// call / done / error data. The JS side does
/// `e.payload.payload.kind` to get the variant
/// (5b-4 added `ToolCall`).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ChunkEnvelope {
    request_id: String,
    payload: ChatEventPayload,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DoneEnvelope {
    request_id: String,
    cancelled: bool,
    /// Anthropic only (5b-2). See `ChatEventPayload::Done`.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    stop_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ErrorEnvelope {
    request_id: String,
    kind: String,
    message: String,
}

/// Cancel an in-flight chat stream. The JS side
/// calls this when the user clicks the "Stop"
/// button in the AI panel composer.
///
/// The command looks up the `Arc<AtomicBool>` for
/// the given `requestId` in the process-wide
/// registry and sets it to `true`. The reader
/// task checks the flag between SSE events and
/// bails out, emitting a `Done { cancelled: true
/// }` chunk and a `ai://done` event.
///
/// Returns:
///   - `Ok(true)` if the request was found and
///     the flag was set
///   - `Ok(false)` if the request was unknown
///     (already finished, never existed, or
///     registered under a different id). The JS
///     side treats this as a no-op — the user
///     clicked Stop on a stream that's already
///     over.
///
/// We do NOT remove the entry from the registry
/// here. The reader task's `CancelGuard` will
/// remove it when the task exits (the next SSE
/// event check or the natural `Done` flow). This
/// avoids a race where we remove the entry
/// before the task observes the flag and tries
/// to look it up for one final `ai://done` emit.
#[tauri::command]
async fn ai_cancel_stream(request_id: String) -> Result<bool, String> {
    match cancel::lookup(&request_id) {
        Some(flag) => {
            flag.store(true, std::sync::atomic::Ordering::Relaxed);
            Ok(true)
        }
        None => Ok(false),
    }
}

/// Generate a hex string of `n` random bytes.
/// Used for the chat `requestId`. We do NOT
/// use a UUID crate to avoid adding a dep;
/// 32 hex chars (16 bytes) is enough entropy
/// for request correlation. The terminal
/// session-id code in `terminal.rs` does the
/// same thing via `getrandom`; we re-implement
/// here to keep `chat.rs` self-contained.
fn random_hex(n: usize) -> String {
    use std::fmt::Write;
    let mut bytes = vec![0u8; n];
    if getrandom::getrandom(&mut bytes).is_err() {
        // If the OS RNG fails (extremely rare),
        // fall back to a counter. This is
        // only used in tests or on a broken
        // /dev/urandom, and the request id is
        // not security-critical.
        for (i, b) in bytes.iter_mut().enumerate() {
            *b = i as u8;
        }
    }
    let mut s = String::with_capacity(n * 2);
    for b in bytes {
        let _ = write!(s, "{b:02x}");
    }
    s
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_dialog::init());

    builder
        .invoke_handler(tauri::generate_handler![
            get_app_version,
            open_devtools,
            fs_read_dir,
            fs_read_file,
            fs_write_file,
            fs_pick_folder,
            git_open,
            git_status,
            git_current_branch,
            git_diff,
            git_discard,
            git_stage_all,
            git_commit,
            terminal_open,
            terminal_write,
            terminal_resize,
            terminal_close,
            terminal_default_shell_cmd,
            secrets_set_api_key,
            secrets_has_api_key,
            secrets_get_api_key,
            secrets_delete_api_key,
            ai_list_providers,
            ai_get_configured_providers,
            ai_chat_stream,
            ai_cancel_stream,
            run_command,
            http_request,
            read_lipi_tools,
            write_lipi_tools,
        ])
        .manage(Arc::new(TerminalState::new()))
        .menu(|app| menu::build_main_menu(app))
        .on_menu_event(|app, event| {
            // F.4: forward the menu item id to the frontend as a
            // `lipi://menu` event. The frontend dispatches by
            // command id (matches the Command Palette's `id` field),
            // so all the actual action logic lives in
            // `src/shared/commands/commands.ts`.
            menu::dispatch(app, event.id().0.clone());
        })
        .setup(|app| {
            // Confirm the main window is present, log readiness.
            if let Some(window) = app.get_webview_window("main") {
                log::info!(
                    "Lipi shell ready: '{}' v{}",
                    env!("CARGO_PKG_NAME"),
                    env!("CARGO_PKG_VERSION"),
                );
                let _ = window.set_title(&format!("Lipi {}", env!("CARGO_PKG_VERSION")));
            } else {
                log::error!("Main window 'main' not found on startup");
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
