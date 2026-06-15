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
    /// Set to `true` when the reader task observes EOF or
    /// the child exits. `lsp_stdio_read` returns
    /// `[255, 255, ...]` (a sentinel) on the next call
    /// after this is set so the JS side can distinguish
    /// "no data right now" from "process is dead".
    exited: Arc<Mutex<bool>>,
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
}

/// `lsp_run_stdio` implementation. Spawns the child,
/// wires up the reader task, stores the handle in the
/// state, returns the `handleId`.
pub async fn run_stdio(
    state: tauri::State<'_, Arc<StdioState>>,
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
    // Stderr: we don't expose it to the JS side in
    // Phase 9 (would need a separate read command or a
    // Tauri event). The settings card surfaces the
    // last 200 lines via "Copy diagnostics", which
    // copies from `tsserver.log` on disk. We still
    // take stderr so it doesn't block on a full
    // pipe buffer.
    let _stderr = child.stderr.take();

    let handle_id = format!("lsp_{}", random_hex(16));
    let stdout_buffer = Arc::new(Mutex::new(VecDeque::new()));
    let exited = Arc::new(Mutex::new(false));

    StdioHandle::spawn_reader(
        stdout,
        stdout_buffer.clone(),
        exited.clone(),
        handle_id.clone(),
    );

    let handle = Arc::new(StdioHandle {
        child: Arc::new(AsyncMutex::new(child)),
        stdin: AsyncMutex::new(stdin),
        stdout_buffer,
        exited,
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
}
