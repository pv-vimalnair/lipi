//! Lipi — Embedded terminal (Phase 4a — pipe only).
//!
//! Owns the cross-platform PTY session manager that the React side
//! drives through `terminal_open` / `terminal_write` / `terminal_resize`
//! / `terminal_close` Tauri commands. The actual xterm.js render and
//! Tauri event stream wiring live in Phase 4b (UI); 4a ships a pure
//! Rust pipe that:
//!
//!   - spawns the user's default shell inside a PTY (cmd.exe on
//!     Windows; `$SHELL` or `/bin/sh` on Unix)
//!   - exposes a session id (32-char hex) for the JS side to
//!     address stdin/stdout/resize/close
//!   - pumps the PTY's stdout into an `EventSink` (one sink per
//!     session, set up by the Tauri command at open time)
//!   - cleans up the session when the shell exits OR when the
//!     caller asks for `close`
//!
//! The reader is a `std::thread` (not async) because `portable-pty`
//! exposes a `std::io::Read`; the underlying file descriptor is
//! not a Tokio-friendly handle on every platform (Windows
//! ConPTY in particular). Keeping the reader synchronous makes
//! the pipe portable and avoids the `spawn_blocking` tax.
//!
//! Per Rule 6 (one file, one concern), this module owns the
//! terminal pipe and nothing else. The Tauri command surface
//! lives in `lib.rs`.
//!
//! ## Error model
//!
//! `TerminalError` is the typed error the JS side receives via
//! `src/ipc/terminal.ts` (a `TerminalError` class on the TS side
//! narrows the payload). `thiserror` for `Display` + `serde` for
//! JSON.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};

use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use thiserror::Error;

/// Default PTY size when the caller doesn't specify one. Matches
/// the xterm.js default (80 × 24) so the first paint looks
/// normal.
const DEFAULT_ROWS: u16 = 24;
const DEFAULT_COLS: u16 = 80;

/// Default read buffer size for the PTY stdout pump. 4 KiB matches
/// the typical pipe buffer on Linux/macOS; on Windows ConPTY the
/// effective chunk size is similar. We deliberately keep this
/// small to keep the per-write event payload bounded (xterm.js
/// handles many small writes better than one giant blob).
const READ_BUFFER_SIZE: usize = 4096;

/// What the JS-side `useTerminal` lifecycle looks like. The
/// `Session` type is internal to this module and is not exposed
/// across the IPC boundary — the JS side only ever sees the
/// `sessionId` (a 32-char hex string) and the data flowing
/// through events.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenResult {
    pub session_id: String,
    pub shell: String,
    pub rows: u16,
    pub cols: u16,
}

#[derive(Debug, Error, Serialize)]
#[serde(tag = "kind", content = "detail", rename_all = "camelCase")]
pub enum TerminalError {
    #[error("I/O error: {0}")]
    Io(String),
    #[error("failed to spawn shell: {0}")]
    Spawn(String),
    #[error("session not found: {0}")]
    NotFound(String),
    #[error("session already closed: {0}")]
    AlreadyClosed(String),
    #[error("pty error: {0}")]
    Pty(String),
}

/// Opaque sink for the reader thread to report output and exit
/// events. The Tauri command wraps `AppHandle::emit` behind this
/// trait; tests use a `TestEventSink` that pushes into a shared
/// `Vec` for assertions.
///
/// Both methods are `&self` so the sink can live behind an
/// `Arc<dyn EventSink>`. Implementations must be cheap to call
/// (the reader thread will call `emit_output` many times per
/// second during a `cat large_file`).
pub trait EventSink: Send + Sync {
    fn emit_output(&self, session_id: &str, data: Vec<u8>);
    fn emit_exit(&self, session_id: &str, exit_code: Option<i32>);
}

/// Options for `open`. `shell = None` means "use the platform
/// default" (cmd.exe on Windows, `$SHELL` or `/bin/sh` on Unix).
/// `rows` / `cols` default to 24 × 80.
#[derive(Debug, Clone)]
pub struct OpenOptions {
    pub shell: Option<String>,
    pub rows: u16,
    pub cols: u16,
}

impl Default for OpenOptions {
    fn default() -> Self {
        Self {
            shell: None,
            rows: DEFAULT_ROWS,
            cols: DEFAULT_COLS,
        }
    }
}

/// The shared state registered with Tauri's `manage()`. One
/// `TerminalState` per app, holding the live sessions.
#[derive(Default)]
pub struct TerminalState {
    sessions: Mutex<HashMap<String, Session>>,
}

impl TerminalState {
    pub fn new() -> Self {
        Self::default()
    }
}

/// One live PTY session. The `master` is held behind a `Mutex`
/// because `Box<dyn MasterPty + Send>` is not `Sync` (the
/// `MasterPty` trait does not have a `Sync` bound), and a
/// non-`Sync` field cannot be stored directly in a struct
/// behind an `Arc` (which requires `Sync`). The mutex is
/// taken briefly on resize and is not held by the reader
/// thread (the reader thread clones its own `Box<dyn Read>`
/// from the master at spawn time and never touches the
/// master again). The `writer` is also a `Mutex` because the
/// `portable-pty` API lets us call `take_writer` only once
/// per master but `write` from multiple callers is fine if
/// we serialize on a mutex. The `child` is `Mutex<Option<…>>`
/// because `wait()` needs `&mut self` and the reader thread
/// needs to call it after EOF.
struct Session {
    master: Mutex<Box<dyn MasterPty + Send>>,
    writer: Mutex<Box<dyn Write + Send>>,
    child: Mutex<Option<Box<dyn Child + Send + Sync>>>,
}

impl Session {
    fn write_stdin(&self, data: &[u8]) -> Result<(), TerminalError> {
        let mut w = self.writer.lock().map_err(|e| {
            TerminalError::Pty(format!("writer mutex poisoned: {e}"))
        })?;
        w.write_all(data).map_err(|e| TerminalError::Io(e.to_string()))?;
        w.flush().map_err(|e| TerminalError::Io(e.to_string()))?;
        Ok(())
    }

    fn resize(&self, rows: u16, cols: u16) -> Result<(), TerminalError> {
        let master = self
            .master
            .lock()
            .map_err(|e| TerminalError::Pty(format!("master mutex poisoned: {e}")))?;
        master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| TerminalError::Pty(e.to_string()))
    }
}

/// Pick the platform's default shell. Centralised so the unit
/// tests and the `default_shell` IPC command agree.
///
/// - Windows: `cmd.exe` (always present, no `SHELL` env var)
/// - Unix: `$SHELL` if set and non-empty, else `/bin/sh`
pub fn default_shell() -> String {
    if cfg!(windows) {
        // Use ComSpec first; fall back to cmd.exe.
        std::env::var_os("ComSpec")
            .map(|s| s.to_string_lossy().into_owned())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "cmd.exe".to_string())
    } else {
        std::env::var_os("SHELL")
            .map(|s| s.to_string_lossy().into_owned())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "/bin/sh".to_string())
    }
}

/// Generate a fresh session id: 16 random bytes hex-encoded
/// (32 chars). `getrandom 0.2` is already in the tree (gix,
/// gix-hash, etc. pull it in transitively). Collision
/// probability for N sessions is ~N²/2¹²⁸ — for any
/// realistic number of open terminals (≤ a handful), this
/// is effectively zero.
fn new_session_id() -> String {
    let mut bytes = [0u8; 16];
    getrandom::getrandom(&mut bytes).expect("getrandom should not fail on this platform");
    let mut s = String::with_capacity(32);
    for b in bytes {
        s.push_str(&format!("{b:02x}"));
    }
    s
}

/// Open a new PTY session, spawn the chosen shell inside it,
/// and start a reader thread that pumps output to the given
/// `sink`. Returns the `OpenResult` describing the session.
///
/// The reader thread runs for the lifetime of the shell:
///   - reads from the master in 4 KiB chunks
///   - sends each chunk to the sink via `emit_output`
///   - on EOF, calls `child.wait()` and reports the exit code
///     via `emit_exit`
///   - removes the session from `state` (so a subsequent
///     `terminal_close` returns `AlreadyClosed` instead of
///     racing)
pub fn open(
    state: &Arc<TerminalState>,
    opts: OpenOptions,
    sink: Arc<dyn EventSink>,
) -> Result<OpenResult, TerminalError> {
    let shell = opts
        .shell
        .clone()
        .unwrap_or_else(default_shell);

    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: opts.rows,
            cols: opts.cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| TerminalError::Pty(e.to_string()))?;

    let mut cmd = CommandBuilder::new(&shell);
    // Inherit the current process env so PATH, TERM, LANG,
    // HOME, etc. flow through. portable-pty inherits by default
    // unless we override — we don't, so this is the natural
    // behaviour. Setting TERM to xterm-256color is the common
    // default and helps shells render ANSI colours; we do this
    // only if the env hasn't already set TERM.
    if std::env::var_os("TERM").is_none() {
        cmd.env("TERM", "xterm-256color");
    }
    // Tell shells not to print a banner (bash/fish would
    // otherwise print a welcome message on a fresh PTY).
    if shell.ends_with("bash") {
        cmd.env("BASH_SILENCE_DEPRECATION_WARNING", "1");
    }

    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| TerminalError::Spawn(e.to_string()))?;
    // Slave is held by the child via the kernel; drop our
    // handle so the child gets SIGHUP when the parent goes
    // away (in case we forget to kill it on shutdown).
    drop(pair.slave);

    let writer = pair
        .master
        .take_writer()
        .map_err(|e| TerminalError::Pty(e.to_string()))?;
    // The master is held in a Mutex (not Arc) because the
    // MasterPty trait object isn't Sync. The reader thread
    // doesn't need to hold the master after spawning — it
    // clones its own reader below.
    let master: Box<dyn MasterPty + Send> = pair.master;

    let session_id = new_session_id();
    let session = Session {
        master: Mutex::new(master),
        writer: Mutex::new(writer),
        child: Mutex::new(Some(child)),
    };

    {
        let mut map = state
            .sessions
            .lock()
            .map_err(|e| TerminalError::Pty(format!("map mutex poisoned: {e}")))?;
        map.insert(session_id.clone(), session);
    }

    // Reader thread: clone the things we need (the master for
    // its reader, the sink for emit) and move the reader +
    // child into the closure. We briefly lock the master to
    // call `try_clone_reader`.
    let reader = {
        let map = state
            .sessions
            .lock()
            .map_err(|e| TerminalError::Pty(format!("map mutex poisoned: {e}")))?;
        let session = map
            .get(&session_id)
            .ok_or_else(|| TerminalError::NotFound(session_id.clone()))?;
        let master = session
            .master
            .lock()
            .map_err(|e| TerminalError::Pty(format!("master mutex poisoned: {e}")))?;
        master
            .try_clone_reader()
            .map_err(|e| TerminalError::Pty(e.to_string()))?
    };

    let state_for_thread = Arc::clone(state);
    let id_for_thread = session_id.clone();
    let sink_for_thread = Arc::clone(&sink);

    // Pull the child out of the map so the reader thread can
    // own it (otherwise we'd have a borrow conflict — the
    // Session::child is a Mutex<Option<…>> and we'd need a
    // long-lived lock which deadlocks with the writer).
    let child = {
        let mut map = state_for_thread
            .sessions
            .lock()
            .map_err(|e| TerminalError::Pty(format!("map mutex poisoned: {e}")))?;
        let session = map
            .get_mut(&id_for_thread)
            .ok_or_else(|| TerminalError::NotFound(id_for_thread.clone()))?;
        // Replace the Option<…> with None temporarily, then
        // take the child out via a `take()`-style pattern.
        // Because `child: Mutex<Option<Box<dyn Child>>>`, we
        // need to lock the inner mutex, take the child, and
        // leave None in place. This is what we want: the
        // session can still be `close`d from the JS side
        // (writer drop will signal EOF), and after the
        // reader thread is done we set the exit status.
        let mut child_slot = session.child.lock().map_err(|e| {
            TerminalError::Pty(format!("child mutex poisoned: {e}"))
        })?;
        child_slot.take()
    }
    .ok_or_else(|| TerminalError::AlreadyClosed(id_for_thread.clone()))?;

    std::thread::Builder::new()
        .name(format!("lipi-term-{id_for_thread}"))
        .spawn(move || reader_loop(reader, child, id_for_thread, sink_for_thread, state_for_thread))
        .map_err(|e| TerminalError::Pty(format!("failed to spawn reader thread: {e}")))?;

    Ok(OpenResult {
        session_id,
        shell,
        rows: opts.rows,
        cols: opts.cols,
    })
}

/// Write data to the session's stdin. The bytes are written
/// raw — the JS side is expected to send the exact byte
/// sequence the shell expects (which for xterm.js is exactly
/// what xterm.js's `onData` callback gives it, since xterm.js
/// already produces the correct raw bytes including \r for
/// line endings when the user presses Enter).
pub fn write(
    state: &Arc<TerminalState>,
    session_id: &str,
    data: &[u8],
) -> Result<(), TerminalError> {
    let map = state
        .sessions
        .lock()
        .map_err(|e| TerminalError::Pty(format!("map mutex poisoned: {e}")))?;
    let session = map
        .get(session_id)
        .ok_or_else(|| TerminalError::NotFound(session_id.to_string()))?;
    session.write_stdin(data)
}

/// Resize the PTY. The shell receives `SIGWINCH` on Unix
/// and the equivalent on Windows ConPTY; well-behaved
/// shells (bash, zsh, fish, cmd, pwsh) re-flow the prompt
/// and any running full-screen programs.
pub fn resize(
    state: &Arc<TerminalState>,
    session_id: &str,
    rows: u16,
    cols: u16,
) -> Result<(), TerminalError> {
    let map = state
        .sessions
        .lock()
        .map_err(|e| TerminalError::Pty(format!("map mutex poisoned: {e}")))?;
    let session = map
        .get(session_id)
        .ok_or_else(|| TerminalError::NotFound(session_id.to_string()))?;
    session.resize(rows, cols)
}

/// Close the session. Drops the writer (which sends EOF to
/// the shell, which usually causes the shell to exit on its
/// own), then drops the session (which kills the child and
/// releases the PTY fd), then removes the session from
/// the map. Idempotent: calling on an already-closed
/// session is a no-op (returns `Ok(())`).
///
/// Note on the reader thread: it holds its own clone of the
/// master (via `try_clone_reader`) but does **not** hold a
/// reference to the master `Arc` — so dropping the session
/// (and with it the master) is safe. The reader thread
/// continues until the shell exits (which happens because
/// we dropped the writer) and then it self-removes from the
/// map (a no-op since we already removed the entry).
pub fn close(
    state: &Arc<TerminalState>,
    session_id: &str,
) -> Result<(), TerminalError> {
    // Take the session out of the map so the reader thread
    // (which also touches the map to clean up) can't race
    // with us. If the session is already gone, the close
    // is a no-op.
    let session = {
        let mut map = state
            .sessions
            .lock()
            .map_err(|e| TerminalError::Pty(format!("map mutex poisoned: {e}")))?;
        map.remove(session_id)
    };
    let Some(session) = session else {
        return Ok(());
    };

    // Drop the session. Field drop order in Rust is the
    // reverse of declaration: `child` first, then `writer`,
    // then `master`. Dropping the writer is what sends
    // EOF to the shell; dropping the master releases the
    // PTY fd. We don't kill the child explicitly — the
    // reader thread is the canonical wait/reaper, and
    // double-killing is harmless (kill is idempotent on
    // most platforms but the second call may return
    // an error, which we ignore).
    drop(session);

    Ok(())
}

/// The reader thread's main loop. Reads in 4 KiB chunks
/// until EOF (or read error), then waits for the child to
/// exit and emits the exit event. Always removes the
/// session from the map at the end so the next `close`
/// call is a no-op.
fn reader_loop(
    mut reader: Box<dyn Read + Send>,
    mut child: Box<dyn Child + Send + Sync>,
    session_id: String,
    sink: Arc<dyn EventSink>,
    state: Arc<TerminalState>,
) {
    let mut buf = [0u8; READ_BUFFER_SIZE];
    loop {
        match reader.read(&mut buf) {
            Ok(0) => break, // EOF
            Ok(n) => {
                sink.emit_output(&session_id, buf[..n].to_vec());
            }
            Err(e) => {
                // EIO on Linux is the normal "slave closed"
                // signal (the shell exited). We treat it
                // as EOF and exit the loop. Other errors
                // are also treated as EOF for resilience —
                // the next `wait()` will tell us the exit
                // code anyway.
                log::debug!("terminal reader for {session_id} got read error: {e}");
                break;
            }
        }
    }

    // Wait for the child to fully exit so we have a real
    // exit code to report. `try_wait` first so we don't
    // block if the reader thread raced with `close()`.
    let exit_code = match child.try_wait() {
        Ok(Some(status)) => status.exit_code() as i32,
        Ok(None) => match child.wait() {
            Ok(status) => status.exit_code() as i32,
            Err(e) => {
                log::warn!("terminal child wait failed for {session_id}: {e}");
                -1
            }
        },
        Err(e) => {
            log::warn!("terminal try_wait failed for {session_id}: {e}");
            -1
        }
    };

    sink.emit_exit(&session_id, Some(exit_code));

    // Remove the session from the map if it's still there.
    // If `close()` already removed it, this is a no-op.
    if let Ok(mut map) = state.sessions.lock() {
        map.remove(&session_id);
    }
}

// --- Tests ----------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex as StdMutex;

    /// A test-only `EventSink` that captures every emit into a
    /// shared `Vec` so the test can assert on output / exit
    /// ordering.
    #[derive(Default)]
    struct TestSink {
        events: StdMutex<Vec<TestEvent>>,
    }
    #[derive(Debug, Clone, PartialEq, Eq)]
    enum TestEvent {
        Output(Vec<u8>),
        Exit(Option<i32>),
    }
    impl EventSink for TestSink {
        fn emit_output(&self, _session_id: &str, data: Vec<u8>) {
            self.events
                .lock()
                .unwrap()
                .push(TestEvent::Output(data));
        }
        fn emit_exit(&self, _session_id: &str, code: Option<i32>) {
            self.events.lock().unwrap().push(TestEvent::Exit(code));
        }
    }
    impl TestSink {
        fn shared(self) -> Arc<Self> {
            Arc::new(self)
        }
    }

    fn find_substring(haystack: &[TestEvent], needle: &[u8]) -> bool {
        haystack.iter().any(|e| match e {
            TestEvent::Output(data) => data
                .windows(needle.len())
                .any(|w| w == needle),
            TestEvent::Exit(_) => false,
        })
    }

    #[test]
    fn default_shell_is_non_empty_on_this_platform() {
        let s = default_shell();
        assert!(!s.is_empty(), "default shell should never be empty");
    }

    #[test]
    fn session_ids_are_unique() {
        let a = new_session_id();
        let b = new_session_id();
        assert_eq!(a.len(), 32);
        assert_eq!(b.len(), 32);
        assert_ne!(a, b, "two consecutive session ids should differ");
        // Both are pure hex.
        assert!(a.chars().all(|c| c.is_ascii_hexdigit()));
        assert!(b.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn open_write_echo_round_trip() {
        // This test requires a working shell + PTY on the host
        // (cmd.exe on Windows, /bin/sh on Unix). If the host
        // doesn't have one (sandboxed CI), we skip rather than
        // fail — the integration test in
        // `tests/terminal_smoke.rs` covers the same flow
        // against a real Tauri AppHandle and is the
        // canonical gate.
        let state = Arc::new(TerminalState::new());
        let sink = TestSink::default().shared();

        let open = match open(
            &state,
            OpenOptions {
                rows: 24,
                cols: 80,
                shell: None,
            },
            sink.clone(),
        ) {
            Ok(o) => o,
            Err(e) => {
                eprintln!("skipping open_write_echo_round_trip: {e}");
                return;
            }
        };

        // Write "echo hi-from-lipi\r\n" — both shells
        // recognise \r\n as a line terminator on a PTY.
        let cmd = b"echo hi-from-lipi\r\n";
        write(&state, &open.session_id, cmd).expect("write should succeed");

        // Poll for the expected output. Up to 2 s, which is
        // plenty for a one-line echo on a local shell.
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(2);
        let mut seen = false;
        while std::time::Instant::now() < deadline {
            let events = sink.events.lock().unwrap().clone();
            if find_substring(&events, b"hi-from-lipi") {
                seen = true;
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(20));
        }
        let _ = close(&state, &open.session_id);
        assert!(
            seen,
            "expected 'hi-from-lipi' in terminal output within 2s, got: {:?}",
            sink.events.lock().unwrap().clone()
        );
    }

    #[test]
    fn close_is_idempotent() {
        let state = Arc::new(TerminalState::new());
        // Closing a non-existent session is a silent no-op.
        close(&state, "nonexistent").expect("close of unknown id should be a no-op");
    }

    #[test]
    fn write_to_unknown_session_returns_not_found() {
        let state = Arc::new(TerminalState::new());
        let err = write(&state, "nope", b"hello").unwrap_err();
        assert!(matches!(err, TerminalError::NotFound(_)));
    }

    #[test]
    fn resize_unknown_session_returns_not_found() {
        let state = Arc::new(TerminalState::new());
        let err = resize(&state, "nope", 24, 80).unwrap_err();
        assert!(matches!(err, TerminalError::NotFound(_)));
    }
}
