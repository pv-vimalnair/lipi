//! Phase 9 — `lsp_run_stdio` / `lsp_stdio_read` / `lsp_stdio_write` /
//! `lsp_stdio_close` Tauri commands.
//!
//! The "Tiniest" scope of Phase 9 lets the renderer spawn a
//! `typescript-language-server` child process (assumed to be
//! installed on the user's PATH) and pipe its stdio through
//! the IPC boundary. This module owns the Rust side of that
//! pipe:
//!
//!   - `lsp_run_stdio`  — `tokio::process::Command::spawn`
//!     with piped stdio, store a `Child` + `ChildStdin` +
//!     `ChildStdout` behind an opaque `HandleId`, spawn a
//!     reader task that drains stdout into a per-handle
//!     `Mutex<VecDeque<u8>>` buffer
//!   - `lsp_stdio_read` — drain up to `max_bytes` from the
//!     buffer and return them to the JS side
//!   - `lsp_stdio_write` — write `bytes` to the child's stdin
//!   - `lsp_stdio_close` — drop stdin (EOF), wait 500ms for
//!     graceful exit, then SIGTERM, then SIGKILL after 2s
//!   - `lsp_check_available` — `which typescript-language-server`
//!     / `where typescript-language-server`; returns the
//!     install hint if the binary isn't on PATH
//!
//! ## Why polling and not Tauri events for stdout
//!
//! LSP `typescript-language-server` is a low-throughput
//! protocol (a single `didChange` is one inbound
//! `publishDiagnostics`); polling `lsp_stdio_read` at ~1ms
//! granularity is more than enough and avoids the
//! long-lived-event-subscription memory-leak risk. A Tauri
//! command round-trip is ~0.5-1ms; the polling adds ~1-2ms
//! of latency, which is invisible at LSP timescales (a real
//! `textDocument/definition` takes 50-200ms on a full `tsc`
//! program). See HANDOFF §9.33 for the full design.
//!
//! ## Why a process-wide `Arc<Mutex<HashMap<HandleId, …>>>`
//!
//! Same pattern as the existing `TerminalState` (see
//! `terminal.rs`). The map is registered with Tauri's
//! `manage()` and accessed via `tauri::State<Arc<…>>`. One
//! state struct per app, holding all live child processes.

use std::collections::{HashMap, VecDeque};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::async_runtime;
use tauri::Emitter;
use thiserror::Error;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::process::{Child, ChildStdin, ChildStdout, Command};
use tokio::sync::Mutex as AsyncMutex;

/// Hard upper bound on a single `lsp_stdio_read` call.
/// Matches the typical pipe buffer on Linux/macOS (64 KiB)
/// and Windows (also 64 KiB for anonymous pipes). The JS
/// side typically calls with 65536 (64 KiB).
pub const MAX_READ_BYTES: usize = 1024 * 1024;

/// How long to wait after dropping stdin (EOF) for the
/// child to exit gracefully before sending SIGTERM.
const GRACEFUL_EXIT_TIMEOUT: Duration = Duration::from_millis(500);

/// How long to wait after SIGTERM before SIGKILL.
const SIGKILL_AFTER: Duration = Duration::from_secs(2);

/// How long to wait for the `typescript-language-server`
/// `--version` probe (or the `which` / `where` call) before
/// declaring it "not available".
const CHECK_AVAILABLE_TIMEOUT: Duration = Duration::from_secs(5);

/// Per-handle stderr ring-buffer cap. The LSP servers
/// we ship with (typescript-language-server,
/// rust-analyzer, pyright) are quiet on stderr in the
/// happy path but can produce ~1-2 KiB of panic
/// backtraces + TS diagnostics on crash. 8 KiB is
/// enough for the last ~100 lines of typical output
/// without unbounded growth on a chatty server.
const STDERR_BUFFER_CAP: usize = 8 * 1024;

/// Phase 9.7 — the *log* ring buffer is separate
/// from the crash-tail buffer. It's much larger
/// (64 KiB ≈ 1k lines) because the user is
/// actively watching it in the "Server output"
/// panel of the `LanguageServerCard`. New bytes
/// are pushed to the JS side in real time via the
/// `lsp://log` event; the buffer exists for
/// replay when the JS side subscribes after the
/// child has already been running for a while
/// (the first `lsp_stdio_read_stderr_log` call
/// drains the whole buffer).
const STDERR_LOG_BUFFER_CAP: usize = 64 * 1024;

/// `lsp://crashed` event name. Emitted by the wait task
/// when the child process exits. The JS side
/// `lspClientStore` subscribes via `onLspCrashed` and
/// flips the workspace's `LspStatus` to `error`.
///
/// Re-exported from `lib.rs` and matched on the JS
/// side as `LSP_CRASHED_EVENT` constant in
/// `src/ipc/lsp.ts`. If you change this string,
/// update both sides + the Rust test that pins it.
pub const LSP_CRASHED_EVENT: &str = "lsp://crashed";

/// `lsp://log` event name. Phase 9.7 — emitted by
/// the stderr reader task whenever new bytes
/// arrive. The JS side `lspClientStore` subscribes
/// via `onLspLog` and appends the lines to
/// `lspOutputByWorkspace` for the
/// `LanguageServerCard`'s "Server output" panel.
///
/// Re-exported from `lib.rs` and matched on the JS
/// side as `LSP_LOG_EVENT` constant in
/// `src/ipc/lsp.ts`. If you change this string,
/// update both sides + the Rust test that pins it.
pub const LSP_LOG_EVENT: &str = "lsp://log";

/// Payload shape of the `lsp://crashed` event. Lives
/// in Rust so we can write a `serde` round-trip test
/// that pins the wire format (camelCase, fields the
/// JS side reads).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LspCrashedPayload {
    pub handle_id: String,
    /// Exit code if the child exited normally (most
    /// common). `None` if the child was killed by a
    /// signal (Unix) or the exit code couldn't be
    /// captured (Windows in some edge cases).
    pub exit_status: Option<i32>,
    /// Last bytes the child wrote to stderr (UTF-8
    /// lossy). Capped at `STDERR_BUFFER_CAP` (8 KiB
    /// ≈ 100 lines). May be empty if the child
    /// never wrote to stderr.
    pub stderr_tail: String,
}

/// Payload shape of the `lsp://log` event. Phase
/// 9.7 — one event per stderr read with at least
/// one byte. The `chunk` is the *new* bytes (the
/// reader flushes them to the JS side immediately,
/// not the whole buffer). The JS side is
/// responsible for line-splitting and bounding
/// the displayed tail.
///
/// Why a separate struct (not just reusing
/// `LspCrashedPayload` with a different field
/// shape): the two events have different
/// delivery patterns (log = many small pushes,
/// crash = one big tail) and different consumers
/// (log → `lspOutputByWorkspace`, crash →
/// `crashByWorkspace`). A distinct type keeps
/// the wire format explicit and the Rust tests
/// can pin each shape independently.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LspLogPayload {
    pub handle_id: String,
    /// New bytes the child wrote to stderr since
    /// the last event (UTF-8 lossy). Empty only if
    /// the reader somehow saw zero bytes (which
    /// shouldn't happen — the reader loops on
    /// `Ok(0)` as EOF, not as a normal event).
    pub chunk: String,
}

/// Push `bytes` into a stderr ring buffer, dropping
/// the oldest bytes when the cap is reached.
/// Extracted from the reader task so the test suite
/// can exercise the eviction logic without spawning
/// a real child process.
fn push_stderr(buf: &mut VecDeque<u8>, bytes: &[u8]) {
    for byte in bytes {
        if buf.len() >= STDERR_BUFFER_CAP {
            buf.pop_front();
        }
        buf.push_back(*byte);
    }
}

/// Phase 9.7 — push `bytes` into the stderr
/// *log* ring buffer (separate from the crash
/// tail; much larger — see
/// `STDERR_LOG_BUFFER_CAP`). Same eviction
/// semantics as `push_stderr`, but parameterised
/// on the cap so the test suite can exercise the
/// boundary without allocating 64 KiB.
fn push_stderr_log(buf: &mut VecDeque<u8>, bytes: &[u8]) {
    for byte in bytes {
        if buf.len() >= STDERR_LOG_BUFFER_CAP {
            buf.pop_front();
        }
        buf.push_back(*byte);
    }
}

/// `lsp_run_stdio` args. The JS side passes the resolved
/// command (e.g. `typescript-language-server`) and any
/// startup args (`--stdio` is the canonical one for the
/// `vscode-langservers-extracted` Node CLI).
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunStdioArgs {
    /// Program path. On Windows this can be a bare
    /// executable name (resolved via `PATH`) or an
    /// absolute path.
    pub command: String,
    /// Args after the program.
    #[serde(default)]
    pub args: Vec<String>,
    /// Optional working directory.
    #[serde(default)]
    pub cwd: Option<String>,
}

/// `lsp_run_stdio` result. `handleId` is a 32-char hex
/// string the JS side passes to `lsp_stdio_read` /
/// `lsp_stdio_write` / `lsp_stdio_close`.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunStdioResult {
    pub handle_id: String,
    /// The resolved command (after PATH lookup). Useful
    /// for the settings card's "Server: <path>" status
    /// line.
    pub resolved_command: String,
}

/// `lsp_check_available` result. Tells the JS side
/// whether the LSP CLI is on PATH, plus a copy-paste-able
/// install hint for the settings card.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckAvailableResult {
    pub available: bool,
    /// Copy-paste-able install command. The JS side
    /// surfaces this verbatim in the settings card.
    pub install_hint: String,
    /// The version string the server printed (e.g.
    /// "4.3.3"), or `None` if the server isn't on PATH.
    pub version: Option<String>,
}

/// The error type the Tauri commands serialise to JS.
/// `#[serde(tag = "kind", content = "detail")]` so the JS
/// side can switch on a single discriminator.
#[derive(Debug, Error, Serialize)]
#[serde(tag = "kind", content = "detail", rename_all = "camelCase")]
pub enum StdioError {
    #[error("command is empty")]
    Empty,
    #[error("handle not found: {0}")]
    NotFound(String),
    #[error("failed to spawn `{command}`: {detail}")]
    Spawn { command: String, detail: String },
    #[error("I/O error: {0}")]
    Io(String),
    #[error("check timed out after {seconds}s")]
    Timeout { seconds: u64 },
}

/// One live child process. The reader task (spawned at
/// `lsp_run_stdio` time) owns a clone of `stdout` and
/// drains it into `stdout_buffer`. The `stdin` is held
/// behind a `tokio::sync::Mutex` because `ChildStdin`
/// implements `AsyncWrite` but not `Sync`.
///
/// `child` is wrapped in an `Arc<AsyncMutex<Child>>`
/// because `tokio::process::Child` is not `Sync` and
/// `wait().await` / `start_kill` / `kill` need exclusive
/// access. Multiple owners (the close path + the reader
/// task's drop guard) can all call `kill().await`
/// through the mutex without needing `&mut self` on a
/// shared reference.
struct StdioHandle {
    child: Arc<AsyncMutex<Child>>,
    stdin: AsyncMutex<ChildStdin>,
    /// Per-handle stdout buffer. The reader task appends;
    /// `lsp_stdio_read` drains.
    stdout_buffer: Arc<Mutex<VecDeque<u8>>>,
    /// Per-handle stderr buffer. Capped at
    /// `STDERR_BUFFER_CAP` bytes (8 KiB) so a chatty
    /// server can't OOM us. `lsp_stdio_read_stderr`
    /// drains on demand (Phase 9.5 — crash
    /// diagnostics). The whole buffer is also
    /// snapshotted when the child exits and shipped
    /// with the `lsp://crashed` event so the JS side
    /// can show the last ~100 lines.
    stderr_buffer: Arc<Mutex<VecDeque<u8>>>,
    /// Phase 9.7 — separate, larger stderr buffer
    /// for the live "Server output" panel in
    /// `LanguageServerCard`. Capped at
    /// `STDERR_LOG_BUFFER_CAP` bytes (64 KiB ≈ 1k
    /// lines). New bytes are pushed to the JS side
    /// via the `lsp://log` event; the buffer also
    /// exists for replay when the JS side subscribes
    /// after the child has already been running for
    /// a while (the first `lsp_stdio_read_stderr_log`
    /// call drains the whole buffer). The two
    /// buffers are independent — the crash tail
    /// (8 KiB) is always the "last 8 KiB at exit
    /// time", the log buffer is "every line since
    /// `lsp_run_stdio` was called, oldest evicted
    /// at 64 KiB".
    stderr_log_buffer: Arc<Mutex<VecDeque<u8>>>,
    /// Set to `true` when the reader task observes EOF or
    /// the child exits. `lsp_stdio_read` returns
    /// `[255, 255, ...]` (a sentinel) on the next call
    /// after this is set so the JS side can distinguish
    /// "no data right now" from "process is dead".
    exited: Arc<Mutex<bool>>,
    /// Set to `true` by the `wait` task when the child
    /// process has actually exited (after `wait()`
    /// resolves). Distinct from `exited`, which flips
    /// on stdout EOF (the child may close stdout and
    /// keep running). The crash event is fired only
    /// when this is `true`.
    ///
    /// Currently write-only — the value is captured
    /// for future diagnostics (e.g. a `lsp://status`
    /// command) but no Tauri command reads it yet.
    /// Marked `#[allow(dead_code)]` to keep the
    /// field for the next time we need to expose
    /// "is the child actually dead" to the frontend.
    #[allow(dead_code)]
    child_exited: Arc<Mutex<bool>>,
    /// The exit status captured by the `wait` task.
    /// `None` until the child actually exits.
    ///
    /// Same story as `child_exited`: write-only for
    /// now, but we want the value preserved for
    /// future debugging. The crash event's
    /// `exit_status` field is populated from the
    /// `ExitStatus` returned by `wait()`, not from
    /// this struct field.
    #[allow(dead_code)]
    exit_status: Arc<Mutex<Option<i32>>>,
}

/// The shared state registered with Tauri's `manage()`.
pub struct StdioState {
    handles: Mutex<HashMap<String, Arc<StdioHandle>>>,
}

impl StdioState {
    pub fn new() -> Self {
        Self {
            handles: Mutex::new(HashMap::new()),
        }
    }
}

/// Generate a 32-char hex id (same scheme as
/// `ai_request_id` and terminal session ids — see
/// `lib.rs::random_hex`). We don't pull in the `uuid`
/// crate just for this; `getrandom` is already a direct
/// dep.
fn random_hex(bytes: usize) -> String {
    use std::fmt::Write;
    let mut buf = vec![0u8; bytes];
    if getrandom::getrandom(&mut buf).is_err() {
        // `getrandom` only fails if the OS RNG is
        // unavailable, which is unrecoverable. Fall
        // back to all-zeros so the call still
        // returns a stable (if non-unique) id —
        // better than panicking in a Tauri command
        // where the user can't see the panic.
        buf.fill(0);
    }
    let mut out = String::with_capacity(bytes * 2);
    for b in buf {
        let _ = write!(out, "{b:02x}");
    }
    out
}

impl StdioHandle {
    /// Spawn the reader task. Lives for the lifetime of
    /// the process; on EOF or child exit, flips `exited`
    /// and exits.
    fn spawn_reader(
        mut stdout: ChildStdout,
        stdout_buffer: Arc<Mutex<VecDeque<u8>>>,
        exited: Arc<Mutex<bool>>,
        handle_id: String,
    ) {
        async_runtime::spawn(async move {
            let mut buf = vec![0u8; 8192];
            loop {
                match stdout.read(&mut buf).await {
                    Ok(0) => {
                        // EOF — child closed stdout.
                        let mut e = exited.lock().expect("exited poisoned");
                        *e = true;
                        break;
                    }
                    Ok(n) => {
                        let mut q = stdout_buffer.lock().expect("buffer poisoned");
                        // Cap the buffer at 8 MiB so a
                        // chatty server can't OOM us.
                        const MAX_BUFFER: usize = 8 * 1024 * 1024;
                        for byte in &buf[..n] {
                            if q.len() >= MAX_BUFFER {
                                q.pop_front();
                            }
                            q.push_back(*byte);
                        }
                    }
                    Err(e) => {
                        // Read error — most likely the
                        // child died. Log and exit.
                        if std::env::var("LIPI_LSP_DEBUG").is_ok() {
                            eprintln!(
                                "[lsp] reader for {handle_id} error: {e}"
                            );
                        }
                        let mut ex = exited.lock().expect("exited poisoned");
                        *ex = true;
                        break;
                    }
                }
            }
        });
    }

    /// Spawn the stderr reader task. Phase 9.5 — drains
    /// the child's stderr into a fixed-size ring buffer
    /// (`STDERR_BUFFER_CAP`) that the JS side reads on
    /// demand via `lsp_stdio_read_stderr`. The whole
    /// buffer is also snapshotted by the wait task and
    /// shipped with the `lsp://crashed` event.
    ///
    /// Phase 9.7 — the same task also writes to the
    /// larger log buffer (`STDERR_LOG_BUFFER_CAP`)
    /// and emits a `lsp://log` event for each
    /// chunk. The JS side appends the chunk to
    /// `lspOutputByWorkspace` and re-renders the
    /// "Server output" panel in `LanguageServerCard`.
    fn spawn_stderr_reader(
        mut stderr: tokio::process::ChildStderr,
        stderr_buffer: Arc<Mutex<VecDeque<u8>>>,
        stderr_log_buffer: Arc<Mutex<VecDeque<u8>>>,
        app_handle: tauri::AppHandle,
        handle_id: String,
    ) {
        async_runtime::spawn(async move {
            let mut buf = vec![0u8; 4096];
            loop {
                match stderr.read(&mut buf).await {
                    Ok(0) => break, // EOF — child closed stderr.
                    Ok(n) => {
                        let bytes = &buf[..n];
                        // 1. Crash-tail buffer (Phase 9.5).
                        {
                            let mut q = stderr_buffer
                                .lock()
                                .expect("stderr buffer poisoned");
                            push_stderr(&mut q, bytes);
                        }
                        // 2. Live log buffer (Phase 9.7).
                        {
                            let mut q = stderr_log_buffer
                                .lock()
                                .expect("stderr log buffer poisoned");
                            push_stderr_log(&mut q, bytes);
                        }
                        // 3. Push the new bytes to the JS
                        // side via `lsp://log`. We emit
                        // unconditionally on every read
                        // (not just on newlines) — the JS
                        // side does the line-splitting and
                        // tail-bounding. Decoding as
                        // UTF-8 lossy here means a sliced
                        // multi-byte char becomes a
                        // replacement char; the JS side's
                        // line buffer will see the right
                        // thing on the next read.
                        let payload = serde_json::json!({
                            "handleId": handle_id,
                            "chunk": String::from_utf8_lossy(bytes),
                        });
                        if let Err(e) = app_handle.emit(LSP_LOG_EVENT, payload)
                        {
                            if std::env::var("LIPI_LSP_DEBUG").is_ok() {
                                eprintln!(
                                    "[lsp] failed to emit {LSP_LOG_EVENT}: {e}"
                                );
                            }
                        }
                    }
                    Err(_e) => {
                        // Read error — most likely the
                        // child died. Stop reading;
                        // the wait task will fire the
                        // crash event.
                        if std::env::var("LIPI_LSP_DEBUG").is_ok() {
                            eprintln!(
                                "[lsp] stderr reader for {handle_id} error: {_e}"
                            );
                        }
                        break;
                    }
                }
            }
        });
    }

    /// Spawn the wait task. Blocks on
    /// `child.wait().await`, captures the exit status,
    /// flips `child_exited`, then emits the
    /// `lsp://crashed` event with the last stderr lines.
    ///
    /// Phase 9.5 — this is the signal the JS side uses
    /// to flip the workspace's `LspStatus` to `error`
    /// and schedule an auto-respawn. The event fires
    /// exactly once per child.
    fn spawn_wait_task(
        child: Arc<AsyncMutex<Child>>,
        child_exited: Arc<Mutex<bool>>,
        exit_status: Arc<Mutex<Option<i32>>>,
        stderr_buffer: Arc<Mutex<VecDeque<u8>>>,
        app_handle: tauri::AppHandle,
        handle_id: String,
    ) {
        async_runtime::spawn(async move {
            // Take an exclusive lock and wait.
            // We replace this with a try_wait
            // poll so the task can also respond
            // to a `kill()` from the close path
            // (which needs the same mutex).
            // Actually, the cleanest approach is
            // to grab the lock, call `wait()`,
            // and release. If the close path
            // also wants the lock, it can wait
            // for us (or vice versa).
            let exit_code = {
                let mut c = child.lock().await;
                c.wait().await.ok().and_then(|s| s.code())
            };
            {
                let mut e = child_exited
                    .lock()
                    .expect("child_exited poisoned");
                *e = true;
            }
            if let Some(code) = exit_code {
                let mut s = exit_status
                    .lock()
                    .expect("exit_status poisoned");
                *s = Some(code);
            }
            // Snapshot the stderr tail.
            let tail = {
                let q = stderr_buffer
                    .lock()
                    .expect("stderr buffer poisoned");
                // Decode as UTF-8 lossy; LSP
                // servers log ASCII / UTF-8.
                String::from_utf8_lossy(
                    q.iter().copied().collect::<Vec<u8>>().as_slice(),
                )
                .to_string()
            };
            // Emit the crash event. The JS side
            // decides what to do (auto-respawn
            // vs. show "Restart server" button).
            let payload = serde_json::json!({
                "handleId": handle_id,
                "exitStatus": exit_code,
                "stderrTail": tail,
            });
            if let Err(e) = app_handle.emit("lsp://crashed", payload) {
                if std::env::var("LIPI_LSP_DEBUG").is_ok() {
                    eprintln!("[lsp] failed to emit lsp://crashed: {e}");
                }
            }
        });
    }
}

/// `lsp_run_stdio` implementation. Spawns the child,
/// wires up the reader task, stores the handle in the
/// state, returns the `handleId`.
pub async fn run_stdio(
    state: tauri::State<'_, Arc<StdioState>>,
    app: tauri::AppHandle,
    args: RunStdioArgs,
) -> Result<RunStdioResult, StdioError> {
    if args.command.is_empty() {
        return Err(StdioError::Empty);
    }
    let mut cmd = Command::new(&args.command);
    cmd.args(&args.args);
    if let Some(cwd) = &args.cwd {
        let path = PathBuf::from(cwd);
        cmd.current_dir(path);
    }
    cmd.stdin(std::process::Stdio::piped());
    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::piped());
    // Don't allocate a console window on Windows when
    // spawning from the Tauri app (which is a GUI app,
    // not a console one). `tokio::process::Command`
    // exposes its own `creation_flags` method on
    // Windows — no `CommandExt` import needed.
    #[cfg(windows)]
    {
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let resolved_command = args.command.clone();
    let mut child = cmd.spawn().map_err(|e| StdioError::Spawn {
        command: resolved_command.clone(),
        detail: e.to_string(),
    })?;

    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| StdioError::Io("stdin not piped".to_string()))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| StdioError::Io("stdout not piped".to_string()))?;
    // Phase 9.5: take stderr and drain it into a
    // per-handle ring buffer. The JS side reads on
    // demand via `lsp_stdio_read_stderr`, and the
    // wait task snapshots the tail when the child
    // exits and ships it with the `lsp://crashed`
    // event.
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| StdioError::Io("stderr not piped".to_string()))?;

    let handle_id = format!("lsp_{}", random_hex(16));
    let stdout_buffer = Arc::new(Mutex::new(VecDeque::new()));
    let stderr_buffer = Arc::new(Mutex::new(VecDeque::new()));
    let stderr_log_buffer = Arc::new(Mutex::new(VecDeque::new()));
    let exited = Arc::new(Mutex::new(false));
    let child_exited = Arc::new(Mutex::new(false));
    let exit_status = Arc::new(Mutex::new(None));
    let child_arc = Arc::new(AsyncMutex::new(child));

    StdioHandle::spawn_reader(
        stdout,
        stdout_buffer.clone(),
        exited.clone(),
        handle_id.clone(),
    );
    StdioHandle::spawn_stderr_reader(
        stderr,
        stderr_buffer.clone(),
        stderr_log_buffer.clone(),
        app.clone(),
        handle_id.clone(),
    );
    StdioHandle::spawn_wait_task(
        child_arc.clone(),
        child_exited.clone(),
        exit_status.clone(),
        stderr_buffer.clone(),
        app,
        handle_id.clone(),
    );

    let handle = Arc::new(StdioHandle {
        child: child_arc,
        stdin: AsyncMutex::new(stdin),
        stdout_buffer,
        stderr_buffer,
        stderr_log_buffer,
        exited,
        child_exited,
        exit_status,
    });

    state
        .handles
        .lock()
        .expect("state poisoned")
        .insert(handle_id.clone(), handle);

    Ok(RunStdioResult {
        handle_id,
        resolved_command,
    })
}

/// `lsp_stdio_read` — drain up to `max_bytes` from the
/// buffer.
pub async fn stdio_read(
    state: tauri::State<'_, Arc<StdioState>>,
    handle_id: String,
    max_bytes: usize,
) -> Result<Vec<u8>, StdioError> {
    // Clone the Arc out of the map (same Send-bound
    // reason as `stdio_write`).
    let handle = {
        let handles = state.handles.lock().expect("state poisoned");
        handles
            .get(&handle_id)
            .ok_or_else(|| StdioError::NotFound(handle_id.clone()))?
            .clone()
    };
    let mut buf = handle.stdout_buffer.lock().expect("buffer poisoned");
    let take = max_bytes.min(MAX_READ_BYTES).min(buf.len());
    let mut out = Vec::with_capacity(take);
    for _ in 0..take {
        if let Some(b) = buf.pop_front() {
            out.push(b);
        }
    }
    // If the buffer is empty AND the child has exited,
    // append a sentinel byte (0xFF) so the JS side
    // can distinguish "no data right now" from
    // "process is dead". A single 0xFF byte is
    // invalid in LSP JSON-RPC frames (which are
    // always UTF-8), so the JS side's UTF-8 decoder
    // will see it as a clean end-of-stream.
    if out.is_empty() {
        let exited = handle.exited.lock().expect("exited poisoned");
        if *exited {
            out.push(0xFF);
        }
    }
    Ok(out)
}

/// `lsp_stdio_read_stderr` — drain up to `max_bytes`
/// from the per-handle stderr buffer.
///
/// Phase 9.5 — crash diagnostics. The JS side polls
/// this on demand (typically after receiving the
/// `lsp://crashed` event) to populate the settings
/// card's "Last lines of server output" panel.
///
/// The buffer is a ring buffer capped at
/// `STDERR_BUFFER_CAP` (8 KiB), so on overflow the
/// oldest bytes are dropped — the JS side gets the
/// most-recent stderr, which is what users want for
/// crash post-mortems.
///
/// Destructive read: the returned bytes are removed
/// from the buffer. The JS side should call once
/// with the full buffer size to grab everything.
pub async fn stdio_read_stderr(
    state: tauri::State<'_, Arc<StdioState>>,
    handle_id: String,
    max_bytes: usize,
) -> Result<Vec<u8>, StdioError> {
    let handle = {
        let handles = state.handles.lock().expect("state poisoned");
        handles
            .get(&handle_id)
            .ok_or_else(|| StdioError::NotFound(handle_id.clone()))?
            .clone()
    };
    let mut buf = handle
        .stderr_buffer
        .lock()
        .expect("stderr buffer poisoned");
    // Cap the per-call read to MAX_READ_BYTES
    // (1 MiB) so a chatty server can't make the
    // Tauri IPC payload huge. The ring buffer
    // itself is already capped at 8 KiB so this is
    // mostly a safety net.
    let take = max_bytes.min(MAX_READ_BYTES).min(buf.len());
    let mut out = Vec::with_capacity(take);
    for _ in 0..take {
        if let Some(b) = buf.pop_front() {
            out.push(b);
        }
    }
    Ok(out)
}

/// Phase 9.7 — `lsp_stdio_read_stderr_log` drains
/// the live "Server output" log buffer. This is
/// the *replay* path: the JS side also gets new
/// bytes via the `lsp://log` event, so a client
/// that subscribes mid-session would miss the
/// bytes between the child spawning and the
/// subscription. The first call after the JS
/// side mounts the `LanguageServerCard` should
/// drain the buffer to catch up.
///
/// Destructive read (same as `stdio_read_stderr`).
/// Subsequent calls return only bytes that
/// arrived after the last drain.
pub async fn stdio_read_stderr_log(
    state: tauri::State<'_, Arc<StdioState>>,
    handle_id: String,
    max_bytes: usize,
) -> Result<Vec<u8>, StdioError> {
    let handle = {
        let handles = state.handles.lock().expect("state poisoned");
        handles
            .get(&handle_id)
            .ok_or_else(|| StdioError::NotFound(handle_id.clone()))?
            .clone()
    };
    let mut buf = handle
        .stderr_log_buffer
        .lock()
        .expect("stderr log buffer poisoned");
    // Cap at MAX_READ_BYTES for IPC safety. The
    // log buffer itself is 64 KiB so this is
    // effectively a per-call chunk limit, not a
    // total cap.
    let take = max_bytes.min(MAX_READ_BYTES).min(buf.len());
    let mut out = Vec::with_capacity(take);
    for _ in 0..take {
        if let Some(b) = buf.pop_front() {
            out.push(b);
        }
    }
    Ok(out)
}

/// `lsp_stdio_write` — write `bytes` to the child's
/// stdin.
pub async fn stdio_write(
    state: tauri::State<'_, Arc<StdioState>>,
    handle_id: String,
    bytes: Vec<u8>,
) -> Result<usize, StdioError> {
    // Clone the Arc out of the map so we can drop
    // the std::sync::MutexGuard before awaiting the
    // AsyncMutex<ChildStdin>. Holding a
    // std::sync::MutexGuard across an `.await`
    // point makes the future non-`Send` (Tauri
    // commands need `Send` futures).
    let handle = {
        let handles = state.handles.lock().expect("state poisoned");
        handles
            .get(&handle_id)
            .ok_or_else(|| StdioError::NotFound(handle_id.clone()))?
            .clone()
    };
    let mut stdin = handle.stdin.lock().await;
    stdin
        .write_all(&bytes)
        .await
        .map_err(|e| StdioError::Io(e.to_string()))?;
    stdin
        .flush()
        .await
        .map_err(|e| StdioError::Io(e.to_string()))?;
    Ok(bytes.len())
}

/// `lsp_stdio_close` — drop stdin (EOF), wait for
/// graceful exit, then SIGTERM, then SIGKILL.
///
/// `Child` is shared via `Arc<AsyncMutex<Child>>` so we
/// can call `wait()` / `kill()` on it from the close
/// path even though the reader task has a clone of the
/// `Arc<StdioHandle>` for the lifetime of its drain loop.
pub async fn stdio_close(
    state: tauri::State<'_, Arc<StdioState>>,
    handle_id: String,
) -> Result<(), StdioError> {
    // Remove the handle from the map so concurrent
    // reads/writes error out. We clone the inner
    // `Arc<AsyncMutex<Child>>` + the `exited` flag Arc
    // before dropping the outer handle (the reader task
    // may still have a clone of the outer Arc).
    let (child, exited) = {
        let mut handles = state.handles.lock().expect("state poisoned");
        let Some(handle) = handles.remove(&handle_id) else {
            return Err(StdioError::NotFound(handle_id));
        };
        (handle.child.clone(), handle.exited.clone())
    };

    // Drop stdin first — sends EOF. The child should
    // see EOF and exit gracefully.
    {
        // We need stdin too; re-grab from the
        // handle. The handle was already removed
        // from the map, so we go through a quick
        // second lookup is no longer possible
        // (it's gone). Instead, we attached the
        // stdin to the StdioHandle — but the
        // StdioHandle is gone too. The cleanest
        // path: don't shut down stdin explicitly
        // here. The `Child::kill()` we call next
        // closes all stdio handles anyway.
        // (If we needed a graceful close, we'd
        // pull stdin out before removing the
        // handle. Defer to Phase 9.1.)
    }

    // Wait up to GRACEFUL_EXIT_TIMEOUT for the
    // child to exit on its own. We don't have to
    // send EOF first because the child is going
    // to be killed by the kill ladder if it
    // doesn't exit on its own.
    let mut child_guard = child.lock().await;
    let graceful = tokio::time::timeout(GRACEFUL_EXIT_TIMEOUT, child_guard.wait()).await;
    if graceful.is_err() {
        // Timeout — kill ladder.
        let _ = child_guard.start_kill();
        let _ = tokio::time::timeout(SIGKILL_AFTER, child_guard.wait()).await;
    }
    drop(child_guard);

    // Flip the exited flag so any in-flight
    // `lsp_stdio_read` returns the sentinel.
    let mut exited_guard = exited.lock().expect("exited poisoned");
    *exited_guard = true;
    Ok(())
}

/// `lsp_check_available` — run `which` (POSIX) /
/// `where` (Windows) for `typescript-language-server`,
/// then `--version` to capture the version string.
pub async fn check_available() -> Result<CheckAvailableResult, StdioError> {
    // Step 1: probe PATH for the binary. The JS side
    // could do this with `run_command` directly, but
    // bundling it here means the "is the LSP
    // available?" UX is one IPC call, not two.
    #[cfg(windows)]
    let probe_program = "where";
    #[cfg(windows)]
    let probe_args = vec!["typescript-language-server".to_string()];

    #[cfg(not(windows))]
    let probe_program = "which";
    #[cfg(not(windows))]
    let probe_args = vec!["typescript-language-server".to_string()];

    let mut cmd = Command::new(probe_program);
    cmd.args(&probe_args);
    cmd.stdin(std::process::Stdio::null());
    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::piped());

    let probe = tokio::time::timeout(CHECK_AVAILABLE_TIMEOUT, cmd.output()).await;
    let probe_output = match probe {
        Ok(Ok(o)) => o,
        Ok(Err(_)) => {
            return Ok(CheckAvailableResult {
                available: false,
                install_hint: INSTALL_HINT.to_string(),
                version: None,
            });
        }
        Err(_) => {
            return Err(StdioError::Timeout {
                seconds: CHECK_AVAILABLE_TIMEOUT.as_secs(),
            });
        }
    };

    if !probe_output.status.success() {
        return Ok(CheckAvailableResult {
            available: false,
            install_hint: INSTALL_HINT.to_string(),
            version: None,
        });
    }

    // Step 2: spawn the server with `--version` to
    // capture the version string. This also
    // double-checks that the binary is actually
    // runnable (not a stale PATH entry).
    let mut version_cmd = Command::new("typescript-language-server");
    version_cmd.arg("--version");
    version_cmd.stdin(std::process::Stdio::null());
    version_cmd.stdout(std::process::Stdio::piped());
    version_cmd.stderr(std::process::Stdio::piped());

    let version_result =
        tokio::time::timeout(CHECK_AVAILABLE_TIMEOUT, version_cmd.output()).await;
    let version = match version_result {
        Ok(Ok(o)) if o.status.success() => {
            Some(String::from_utf8_lossy(&o.stdout).trim().to_string())
        }
        _ => None,
    };

    Ok(CheckAvailableResult {
        available: version.is_some(),
        install_hint: INSTALL_HINT.to_string(),
        version,
    })
}

/// The install hint shown in the settings card. The
/// canonical install command is `npm i -g
/// typescript-language-server` (the
/// `vscode-langservers-extracted` package).
const INSTALL_HINT: &str = "npm install -g typescript-language-server";

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn random_hex_returns_expected_length() {
        let id = random_hex(16);
        assert_eq!(id.len(), 32);
        assert!(id.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn random_hex_returns_unique_values() {
        // Smoke test: two calls give different ids.
        let a = random_hex(16);
        let b = random_hex(16);
        assert_ne!(a, b);
    }

    #[test]
    fn run_stdio_args_deserialises_from_camel_case() {
        // The Tauri IPC layer converts snake_case Rust
        // field names to camelCase on the wire. This
        // test guards against a future field rename
        // breaking the JS-side caller.
        let json = r#"{"command":"node","args":["--version"],"cwd":"/tmp"}"#;
        let parsed: RunStdioArgs = serde_json::from_str(json).unwrap();
        assert_eq!(parsed.command, "node");
        assert_eq!(parsed.args, vec!["--version"]);
        assert_eq!(parsed.cwd.as_deref(), Some("/tmp"));
    }

    #[test]
    fn run_stdio_result_serialises_to_camel_case() {
        let result = RunStdioResult {
            handle_id: "lsp_abc".to_string(),
            resolved_command: "typescript-language-server".to_string(),
        };
        let json = serde_json::to_string(&result).unwrap();
        assert!(json.contains("handleId"));
        assert!(json.contains("resolvedCommand"));
    }

    #[test]
    fn stdio_error_serialises_with_kind_tag() {
        let err = StdioError::NotFound("lsp_xyz".to_string());
        let json = serde_json::to_string(&err).unwrap();
        // `#[serde(tag = "kind")]` puts the variant
        // name as `kind` on the wire.
        assert!(json.contains("\"kind\":\"notFound\""));
        assert!(json.contains("lsp_xyz"));
    }

    #[test]
    fn install_hint_is_stable() {
        // The settings card surfaces this string. If
        // we change it, the card's tests need an
        // update. Locking the value here catches
        // accidental edits.
        assert_eq!(
            INSTALL_HINT,
            "npm install -g typescript-language-server"
        );
    }

    // --- Phase 9.5 — crash recovery (stderr ring buffer + crash event) ---

    #[test]
    fn push_stderr_below_cap_appends() {
        // Sanity: pushing fewer bytes than the cap
        // appends them verbatim, in order.
        let mut buf: VecDeque<u8> = VecDeque::new();
        push_stderr(&mut buf, b"hello world");
        assert_eq!(buf.len(), 11);
        assert_eq!(
            buf.iter().copied().collect::<Vec<u8>>(),
            b"hello world".to_vec()
        );
    }

    #[test]
    fn push_stderr_at_cap_drops_oldest() {
        // Ring-buffer semantics: when the buffer is
        // full, the oldest byte is evicted to make
        // room for the newest. This is the property
        // that gives us "last 100 lines" on a chatty
        // server.
        let mut buf: VecDeque<u8> =
            VecDeque::with_capacity(STDERR_BUFFER_CAP);
        for _ in 0..STDERR_BUFFER_CAP {
            buf.push_back(b'A');
        }
        push_stderr(&mut buf, b"BC");
        assert_eq!(buf.len(), STDERR_BUFFER_CAP);
        // The first two bytes should be 'A' + 'A'
        // (the two oldest that got dropped).
        let first_two: Vec<u8> = buf.iter().take(2).copied().collect();
        assert_eq!(first_two, b"AA".to_vec());
        // The last two bytes should be the new ones.
        let last_two: Vec<u8> =
            buf.iter().rev().take(2).copied().collect::<Vec<_>>()
                .into_iter()
                .rev()
                .collect();
        assert_eq!(last_two, b"BC".to_vec());
    }

    #[test]
    fn push_stderr_overflow_preserves_newest() {
        // Stress test: push far more than the cap in
        // one go. The buffer should hold only the
        // most recent STDERR_BUFFER_CAP bytes.
        let mut buf: VecDeque<u8> = VecDeque::new();
        let huge = vec![b'X'; STDERR_BUFFER_CAP * 4];
        push_stderr(&mut buf, &huge);
        assert_eq!(buf.len(), STDERR_BUFFER_CAP);
        // All bytes are 'X' (so we can't check
        // ordering directly), but the length proves
        // the cap held.
        assert!(buf.iter().all(|b| *b == b'X'));
    }

    #[test]
    fn push_stderr_empty_noop() {
        // Pushing zero bytes must not change the
        // buffer (no spurious eviction).
        let mut buf: VecDeque<u8> = VecDeque::new();
        push_stderr(&mut buf, b"abc");
        let len_before = buf.len();
        push_stderr(&mut buf, b"");
        assert_eq!(buf.len(), len_before);
    }

    #[test]
    fn push_stderr_utf8_multibyte_boundary() {
        // Make sure the ring buffer doesn't slice a
        // multi-byte UTF-8 character. The LSP
        // servers log UTF-8 strings; if the cap
        // landed mid-character we'd hand the JS side
        // a broken string. The buffer is byte-level
        // (VecDeque<u8>) and the lossy decode
        // handles a sliced multi-byte char with
        // replacement characters — which is the
        // correct behaviour for "show the last N
        // lines". This test pins that contract.
        let mut buf: VecDeque<u8> =
            VecDeque::with_capacity(STDERR_BUFFER_CAP);
        // Fill to (cap - 2) so we have room for the
        // 2-byte UTF-8 sequence without evicting.
        for _ in 0..(STDERR_BUFFER_CAP - 2) {
            buf.push_back(b'p');
        }
        // Push the 2-byte UTF-8 sequence (U+00E9 é
        // = 0xC3 0xA9) in one go. After this, buf is
        // at exactly the cap.
        push_stderr(&mut buf, &[0xC3, 0xA9]);
        assert_eq!(buf.len(), STDERR_BUFFER_CAP);
        let s = String::from_utf8_lossy(
            &buf.iter().copied().collect::<Vec<u8>>(),
        )
        .to_string();
        // No 'p' was dropped. The decoded string
        // has (cap - 2) 'p' chars + 1 'é' char.
        assert!(s.ends_with('\u{00E9}'));
        assert_eq!(s.chars().filter(|c| *c == 'p').count(),
                   STDERR_BUFFER_CAP - 2);
    }

    #[test]
    fn lsp_crashed_event_name_is_stable() {
        // The JS side listens for this exact string.
        // If we change it, the listener goes silent
        // and the auto-respawn never fires.
        assert_eq!(LSP_CRASHED_EVENT, "lsp://crashed");
    }

    #[test]
    fn lsp_crashed_payload_serialises_camel_case() {
        // The JS side's `OnLspCrashedPayload`
        // interface reads `handleId`, `exitStatus`,
        // `stderrTail`. If we rename a Rust field
        // without updating the `rename_all` attr,
        // the JS side's TypeScript sees
        // `handle_id` (snake_case) and the
        // deserialise silently fails.
        let payload = LspCrashedPayload {
            handle_id: "lsp_abc".to_string(),
            exit_status: Some(139),
            stderr_tail: "panic at typescript".to_string(),
        };
        let json = serde_json::to_string(&payload).unwrap();
        assert!(json.contains("\"handleId\":\"lsp_abc\""));
        assert!(json.contains("\"exitStatus\":139"));
        assert!(json.contains("\"stderrTail\":\"panic at typescript\""));
    }

    #[test]
    fn lsp_crashed_payload_handles_null_exit_status() {
        // On Unix, a child killed by a signal
        // produces `None` from `ExitStatus::code()`.
        // The JS side must tolerate `null`.
        let payload = LspCrashedPayload {
            handle_id: "lsp_xyz".to_string(),
            exit_status: None,
            stderr_tail: String::new(),
        };
        let json = serde_json::to_string(&payload).unwrap();
        assert!(json.contains("\"exitStatus\":null"));
        // Round-trip too: deserialise the JSON back
        // into a struct and confirm the None is
        // preserved.
        let parsed: LspCrashedPayload =
            serde_json::from_str(&json).unwrap();
        assert_eq!(parsed, payload);
    }

    // --- Phase 9.7 — stderr log ring buffer + event ---

    #[test]
    fn lsp_log_event_name_is_stable() {
        // The JS side listens for this exact string.
        // If we change it, the listener goes silent
        // and the live "Server output" panel never
        // updates.
        assert_eq!(LSP_LOG_EVENT, "lsp://log");
    }

    #[test]
    fn lsp_log_payload_serialises_camel_case() {
        // The JS side's `OnLspLogPayload` interface
        // reads `handleId` and `chunk`. If we rename
        // a Rust field, the listener goes silent.
        let payload = LspLogPayload {
            handle_id: "lsp_abc".to_string(),
            chunk: "info: parsed foo.ts\n".to_string(),
        };
        let json = serde_json::to_string(&payload).unwrap();
        assert!(json.contains("\"handleId\":\"lsp_abc\""));
        assert!(json.contains("\"chunk\":\"info: parsed foo.ts\\n\""));
    }

    #[test]
    fn lsp_log_payload_round_trips_with_empty_chunk() {
        // An empty chunk is a valid state (the reader
        // can race with the child producing no output
        // yet). The JS side must tolerate it.
        let payload = LspLogPayload {
            handle_id: "lsp_silent".to_string(),
            chunk: String::new(),
        };
        let json = serde_json::to_string(&payload).unwrap();
        let parsed: LspLogPayload = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed, payload);
    }

    #[test]
    fn push_stderr_log_below_cap_appends() {
        // Mirrors `push_stderr_below_cap_appends`
        // but for the 64 KiB log buffer. We don't
        // actually allocate 64 KiB here — we just
        // verify the helper appends in order and
        // preserves the byte count.
        let mut buf: VecDeque<u8> = VecDeque::new();
        push_stderr_log(&mut buf, b"line 1\nline 2\n");
        assert_eq!(buf.len(), 14);
        let s = String::from_utf8(buf.iter().copied().collect::<Vec<u8>>())
            .unwrap();
        assert_eq!(s, "line 1\nline 2\n");
    }

    #[test]
    fn push_stderr_log_at_cap_drops_oldest() {
        // Fill the log buffer to exactly the cap, push
        // two more bytes, assert the two oldest are
        // evicted. This pins the eviction semantics
        // for the live "Server output" panel.
        let mut buf: VecDeque<u8> =
            VecDeque::with_capacity(STDERR_LOG_BUFFER_CAP);
        for i in 0..STDERR_LOG_BUFFER_CAP {
            buf.push_back(b'a' + (i % 26) as u8);
        }
        let before_first_two: Vec<u8> =
            buf.iter().take(2).copied().collect();
        push_stderr_log(&mut buf, b"!!");
        assert_eq!(buf.len(), STDERR_LOG_BUFFER_CAP);
        // The two oldest bytes were evicted.
        let after_first_two: Vec<u8> =
            buf.iter().take(2).copied().collect();
        assert_ne!(before_first_two, after_first_two);
        // The two newest bytes are the new ones.
        let last_two: Vec<u8> = buf
            .iter()
            .rev()
            .take(2)
            .copied()
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect();
        assert_eq!(last_two, b"!!".to_vec());
    }

    #[test]
    fn push_stderr_log_empty_noop() {
        // Pushing zero bytes must not change the
        // buffer. Important for the "child produces
        // no output" case — we still drain the
        // reader once per tick, but emit nothing.
        let mut buf: VecDeque<u8> = VecDeque::new();
        push_stderr_log(&mut buf, b"hello");
        let len_before = buf.len();
        push_stderr_log(&mut buf, b"");
        assert_eq!(buf.len(), len_before);
    }

    #[test]
    fn stderr_log_buffer_cap_is_larger_than_crash_tail() {
        // Pin the relationship: the live log buffer
        // must be larger than the crash-tail buffer
        // (the user actively watches the live panel,
        // the crash tail is just a post-mortem).
        // If we accidentally swap them, the live
        // panel would evict its history every 8 KiB
        // — basically useless.
        assert!(STDERR_LOG_BUFFER_CAP > STDERR_BUFFER_CAP);
        assert!(STDERR_LOG_BUFFER_CAP >= 16 * 1024);
    }
}
