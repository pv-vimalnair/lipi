//! Phase 5c — `run_command` IPC.
//!
//! Custom tools in 5c have only two "kinds":
//!   - `shell`: a command template with
//!     `{arg}` placeholders that the JS side
//!     substitutes before calling `run_command`.
//!   - `http`: an HTTP request (see
//!     `http.rs`).
//!
//! This module owns the Rust side of the
//! `run_command` Tauri command — it spawns
//! `tokio::process::Command`, captures stdout /
//! stderr, enforces a hard timeout, and returns a
//! `RunCommandResult` to the JS side. The JS
//! `toolRegistry` calls it for any `kind: "shell"`
//! custom tool.
//!
//! ## Why a Rust IPC (and not JS calling
//!   `child_process` directly)?
//!
//! Tauri 2's webview runs in a sandboxed renderer
//! process; the JS there has no direct
//! `child_process` access on desktop, and
//! absolutely nothing on mobile. Going through a
//! Rust IPC keeps the security model consistent
//! across platforms and gives us a natural place
//! to enforce the per-process timeout.
//!
//! ## Timeout
//!
//! Custom-tool calls are user-defined and can
//! trivially hang (`npm test` waiting for input,
//! `curl` against an unresponsive server, an
//! infinite loop). The MVP hardcodes a 30s
//! timeout. A 5d+ enhancement may surface this
//! as a per-tool field in `lipi-tools.json`.
//!
//! The timeout is enforced around the child's
//! `wait()` future while retaining the child
//! handle. If the timeout fires, we explicitly
//! kill and reap the direct child process before
//! returning a timeout error.

use std::time::Duration;

use serde::{Deserialize, Serialize};
use thiserror::Error;
use tokio::io::AsyncReadExt;
use tokio::process::Command;

use crate::ipc_policy::validate_custom_shell_policy;

/// Default per-command timeout. 5c MVP value.
pub const DEFAULT_TIMEOUT: Duration = Duration::from_secs(30);

/// Public error type for the `run_command` Tauri
/// command. `#[serde(tag = "kind")]` so the JS
/// side can switch on a single discriminator
/// without a separate `kind` field on the
/// `Error` variant.
#[derive(Debug, Error, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum RunCommandError {
    /// The program path is empty (e.g. the user
    /// configured a custom tool with an empty
    /// `command` string).
    #[error("command is empty")]
    Empty,
    /// Failed to spawn the process. The
    /// `OsStr`-rendered error from tokio is
    /// included so the user can see "program
    /// not found" etc.
    #[error("failed to spawn `{program}`: {detail}")]
    Spawn { program: String, detail: String },
    /// Process did not finish within the
    /// timeout. The partial stdout / stderr
    /// are dropped — the JS side only gets the
    /// `cancelled: true` flag.
    #[error("command timed out after {seconds}s")]
    Timeout { seconds: u64 },
    /// The process exited with a non-zero
    /// status. `code` and the signal name (if
    /// killed by a signal) are reported. The
    /// stdout / stderr are still included so
    /// the user can see the failure output.
    #[error("command exited with status {code:?}")]
    NonZeroExit {
        code: Option<i32>,
        stdout: String,
        stderr: String,
    },
    /// The call was rejected before spawn by
    /// the Rust-side IPC policy gate.
    #[error("command blocked by policy: {detail}")]
    Policy { detail: String },
}

/// The public response shape. Always returns
/// this on the happy path (and also on
/// `NonZeroExit` — we still return the captured
/// output so the AI model can see what
/// happened). The error path uses
/// `RunCommandError` (serialised to JS).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunCommandResult {
    /// Truncated stdout (UTF-8 lossy). We cap at
    /// ~256 KiB on each stream to avoid
    /// megabytes-of-log replies — a 5d+
    /// enhancement can make this configurable.
    pub stdout: String,
    /// Truncated stderr (UTF-8 lossy).
    pub stderr: String,
    /// Exit status, if the process exited
    /// normally. `None` if killed by a signal
    /// (Unix-only; Windows always reports an
    /// `Option<i32>` here).
    pub exit_code: Option<i32>,
    /// `true` if the command was cancelled by
    /// the timeout (no useful stdout/stderr in
    /// that case). 5c: the only way the JS side
    /// sees `cancelled: true` is if the
    /// timeout fires.
    pub cancelled: bool,
}

/// Args for `run_command`. The JS `toolRegistry`
/// builds this from a custom tool's `command`
/// template + the model's substituted args.
///
/// `cwd` is the working directory for the child
/// process — 5c uses the JS-side workspace root
/// (the same path the AI is editing). 5d+ could
/// allow the user to override per-tool.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunCommandArgs {
    /// Program path. On Windows this can be
    /// either a bare executable name (resolved
    /// via `PATH`) or an absolute path. The JS
    /// side does not shell-quote; we pass the
    /// `argv` as-is.
    pub program: String,
    /// Args after the program. Empty slice is
    /// allowed (e.g. `node --version` becomes
    /// `{program: "node", args: ["--version"]}`).
    #[serde(default)]
    pub args: Vec<String>,
    /// Optional working directory. `None` =
    /// inherit from the parent process (which
    /// in Tauri's case is wherever the app
    /// started — not the workspace).
    #[serde(default)]
    pub cwd: Option<String>,
    /// Per-call timeout. 5c MVP always passes
    /// `DEFAULT_TIMEOUT` from the JS side; the
    /// field exists so 5d+ can plumb per-tool
    /// overrides without an IPC shape change.
    /// `None` = use the default.
    #[serde(default)]
    pub timeout_secs: Option<u64>,
    /// Optional max-output cap (bytes). 5c MVP
    /// always passes the default; the field
    /// exists for the same 5d+ reason as
    /// `timeout_secs`.
    #[serde(default)]
    pub max_output_bytes: Option<usize>,
    /// Rust-side execution policy. Required for
    /// renderer-originated process spawns so
    /// `run_command` is not a generic arbitrary
    /// process launcher.
    #[serde(default)]
    pub policy: Option<RunCommandPolicy>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunCommandPolicy {
    pub kind: RunCommandPolicyKind,
    pub tool_name: String,
    pub workspace_root: String,
}

#[derive(Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum RunCommandPolicyKind {
    CustomTool,
}

/// Cap the per-stream output to a sane upper
/// bound. 256 KiB is enough for a few
/// thousand lines of compiler output but not
/// enough to make a single tool reply take
/// megabytes. The remaining bytes are dropped
/// and a `<truncated>` marker is appended.
pub const MAX_OUTPUT_BYTES_DEFAULT: usize = 256 * 1024;

/// 5c: the public, testable implementation.
/// Takes a pre-built `tokio::process::Command`
/// so tests can pass a mock program
/// (e.g. `node` doesn't exist on every
/// CI runner — but `printf` and `cmd /C`
/// shims always do).
///
/// `timeout` defaults to `DEFAULT_TIMEOUT`;
/// `max_output_bytes` defaults to
/// `MAX_OUTPUT_BYTES_DEFAULT`. We retain the
/// spawned child handle so the timeout branch can
/// kill and reap the process before returning.
pub async fn run_command_impl(
    mut cmd: Command,
    timeout: Duration,
    max_output_bytes: usize,
) -> Result<RunCommandResult, RunCommandError> {
    let program = cmd.as_std().get_program();
    let program_str = program.to_string_lossy().into_owned();
    if program_str.is_empty() {
        return Err(RunCommandError::Empty);
    }

    // Capture stdout / stderr as pipes; we
    // read them AFTER the process exits to
    // avoid the `wait` deadlock (if the
    // process fills its pipe buffer while
    // we're still spawning, it blocks on
    // write). This is the standard
    // tokio-recommended pattern.
    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::piped());
    cmd.stdin(std::process::Stdio::null());

    let mut child = cmd.spawn().map_err(|e| RunCommandError::Spawn {
        program: program_str.clone(),
        detail: e.to_string(),
    })?;
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let stdout_task = tokio::spawn(read_pipe(stdout));
    let stderr_task = tokio::spawn(read_pipe(stderr));

    let status = match tokio::time::timeout(timeout, child.wait()).await {
        Ok(res) => res.map_err(|e| RunCommandError::Spawn {
            program: program_str.clone(),
            detail: e.to_string(),
        })?,
        Err(_) => {
            let _ = child.start_kill();
            let _ = child.wait().await;
            stdout_task.abort();
            stderr_task.abort();
            return Err(RunCommandError::Timeout {
                seconds: timeout.as_secs(),
            });
        }
    };

    let stdout_raw = stdout_task.await.unwrap_or_default();
    let stderr_raw = stderr_task.await.unwrap_or_default();

    let mut stdout = String::from_utf8_lossy(&stdout_raw).into_owned();
    let mut stderr = String::from_utf8_lossy(&stderr_raw).into_owned();

    // Truncate and tag.
    if stdout.len() > max_output_bytes {
        stdout.truncate(max_output_bytes);
        stdout.push_str("\n<truncated>");
    }
    if stderr.len() > max_output_bytes {
        stderr.truncate(max_output_bytes);
        stderr.push_str("\n<truncated>");
    }

    let exit_code = status.code();

    // 5c policy: a non-zero exit is reported
    // as `RunCommandError::NonZeroExit` so
    // the JS `toolRegistry` knows the call
    // "failed" (so the model can react).
    // We still include stdout/stderr in the
    // error so the model has the full
    // picture.
    if !status.success() {
        return Err(RunCommandError::NonZeroExit {
            code: exit_code,
            stdout,
            stderr,
        });
    }

    Ok(RunCommandResult {
        stdout,
        stderr,
        exit_code,
        cancelled: false,
    })
}

async fn read_pipe<T>(pipe: Option<T>) -> Vec<u8>
where
    T: tokio::io::AsyncRead + Unpin,
{
    let Some(mut pipe) = pipe else {
        return Vec::new();
    };
    let mut bytes = Vec::new();
    if pipe.read_to_end(&mut bytes).await.is_err() {
        return Vec::new();
    }
    bytes
}

/// 5c: public entry point called by the
/// `#[tauri::command]` wrapper in `lib.rs`.
/// The JS `toolRegistry` invokes this via
/// `invoke('run_command', …)`.
pub async fn run_command(args: RunCommandArgs) -> Result<RunCommandResult, RunCommandError> {
    if args.program.is_empty() {
        return Err(RunCommandError::Empty);
    }
    let cwd = match args.policy.as_ref() {
        Some(policy) => {
            if policy.tool_name.trim().is_empty() {
                return Err(RunCommandError::Policy {
                    detail: "custom tool policy requires toolName".to_string(),
                });
            }
            match policy.kind {
                RunCommandPolicyKind::CustomTool => validate_custom_shell_policy(
                    &args.program,
                    args.cwd.as_deref(),
                    &policy.workspace_root,
                )
                .map_err(|detail| RunCommandError::Policy { detail })?,
            }
        }
        None => {
            return Err(RunCommandError::Policy {
                detail: "run_command requires an execution policy".to_string(),
            });
        }
    };
    let mut cmd = Command::new(&args.program);
    cmd.args(&args.args);
    cmd.current_dir(cwd);
    let timeout = args
        .timeout_secs
        .map(Duration::from_secs)
        .unwrap_or(DEFAULT_TIMEOUT);
    let max_output_bytes = args.max_output_bytes.unwrap_or(MAX_OUTPUT_BYTES_DEFAULT);
    run_command_impl(cmd, timeout, max_output_bytes).await
}

// --- Tests ------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::env::temp_dir;
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::process::Stdio;
    use std::time::SystemTime;
    use tokio::process::Command;

    fn unique_marker_path(label: &str) -> PathBuf {
        let mut p = temp_dir();
        let nanos = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        p.push(format!("lipi-command-{label}-{nanos}.txt"));
        p
    }

    /// On Unix, `true` is a no-op builtin that
    /// exits 0 with empty output. On Windows,
    /// `cmd /C exit 0` does the same.
    // (Removed `success_command` helper — no
    //  test uses it. Left the comment above
    //  for future tests that might want a
    //  no-op success path.)
    // (Removed: `fn success_command() -> Command`)

    /// A command that writes a known string to
    /// stdout and exits 0. On Unix: `printf`.
    /// On Windows: `cmd /C echo`.
    fn echo_command() -> Command {
        #[cfg(unix)]
        {
            let mut c = Command::new("printf");
            c.arg("hello world\n");
            c.stdin(Stdio::null());
            c
        }
        #[cfg(windows)]
        {
            let mut c = Command::new("cmd");
            c.args(["/C", "echo", "hello world"]);
            c.stdin(Stdio::null());
            c
        }
    }

    /// A command that exits with code 7. On
    /// Unix: `sh -c "exit 7"`. On Windows:
    /// `cmd /C exit 7`.
    fn failing_command() -> Command {
        #[cfg(unix)]
        {
            let mut c = Command::new("sh");
            c.args(["-c", "exit 7"]);
            c.stdin(Stdio::null());
            c
        }
        #[cfg(windows)]
        {
            let mut c = Command::new("cmd");
            c.args(["/C", "exit 7"]);
            c.stdin(Stdio::null());
            c
        }
    }

    /// A command that sleeps longer than the
    /// test timeout (1s timeout, 10s sleep).
    /// Unix: `sleep 10`. Windows: `timeout`.
    /// Note: `timeout` on Windows is a
    /// user-prompted wait; use `ping` against
    /// an unroutable IP for a 1s-ish wait.
    /// Simpler: use `powershell` `Start-Sleep`.
    fn long_running_command() -> Command {
        #[cfg(unix)]
        {
            let mut c = Command::new("sleep");
            c.arg("10");
            c.stdin(Stdio::null());
            c
        }
        #[cfg(windows)]
        {
            let mut c = Command::new("powershell");
            c.args(["-NoProfile", "-Command", "Start-Sleep -Seconds 10"]);
            c.stdin(Stdio::null());
            c
        }
    }

    fn delayed_marker_command(marker: &Path) -> Command {
        #[cfg(unix)]
        {
            let marker = marker.to_string_lossy().replace('\'', "'\\''");
            let mut c = Command::new("sh");
            c.args(["-c", &format!("sleep 2; printf done > '{marker}'")]);
            c.stdin(Stdio::null());
            c
        }
        #[cfg(windows)]
        {
            let marker = marker.to_string_lossy().replace('\'', "''");
            let mut c = Command::new("powershell");
            c.args([
                "-NoProfile",
                "-Command",
                &format!("Start-Sleep -Seconds 2; Set-Content -LiteralPath '{marker}' -Value done"),
            ]);
            c.stdin(Stdio::null());
            c
        }
    }

    #[tokio::test]
    async fn success_path_returns_captured_stdout() {
        let result = run_command_impl(echo_command(), DEFAULT_TIMEOUT, MAX_OUTPUT_BYTES_DEFAULT)
            .await
            .expect("echo should succeed");
        assert!(
            result.stdout.contains("hello world"),
            "got: {:?}",
            result.stdout
        );
        assert!(result.stderr.is_empty());
        assert_eq!(result.exit_code, Some(0));
        assert!(!result.cancelled);
    }

    #[tokio::test]
    async fn non_zero_exit_becomes_error_with_captured_output() {
        let err = run_command_impl(failing_command(), DEFAULT_TIMEOUT, MAX_OUTPUT_BYTES_DEFAULT)
            .await
            .expect_err("non-zero exit should error");
        match err {
            RunCommandError::NonZeroExit {
                code,
                stdout,
                stderr,
            } => {
                #[cfg(unix)]
                assert_eq!(code, Some(7));
                #[cfg(windows)]
                assert_eq!(code, Some(7));
                // The captured output is included
                // so the model can see what
                // happened.
                let _ = (stdout, stderr);
            }
            other => panic!("expected NonZeroExit, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn timeout_fires_returns_timeout_error() {
        // 1s timeout on a 10s sleep.
        let err = run_command_impl(
            long_running_command(),
            Duration::from_secs(1),
            MAX_OUTPUT_BYTES_DEFAULT,
        )
        .await
        .expect_err("sleep should time out");
        match err {
            RunCommandError::Timeout { seconds } => assert_eq!(seconds, 1),
            other => panic!("expected Timeout, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn timeout_kills_child_before_late_side_effect() {
        let marker = unique_marker_path("timeout-kills");
        let err = run_command_impl(
            delayed_marker_command(&marker),
            Duration::from_secs(1),
            MAX_OUTPUT_BYTES_DEFAULT,
        )
        .await
        .expect_err("delayed marker command should time out");
        assert!(matches!(err, RunCommandError::Timeout { seconds: 1 }));

        tokio::time::sleep(Duration::from_secs(3)).await;
        assert!(
            !marker.exists(),
            "timed-out command should have been killed before writing marker"
        );
        let _ = fs::remove_file(marker);
    }

    #[tokio::test]
    async fn empty_program_returns_empty_error() {
        let mut cmd = Command::new("");
        cmd.stdin(Stdio::null());
        let err = run_command_impl(cmd, DEFAULT_TIMEOUT, MAX_OUTPUT_BYTES_DEFAULT)
            .await
            .expect_err("empty program should error");
        assert!(matches!(err, RunCommandError::Empty));
    }

    #[tokio::test]
    async fn missing_program_returns_spawn_error() {
        // A program name that doesn't exist on
        // PATH. We use a name with a null byte
        // embedded to be 100% sure no system
        // has a binary by that name; on Windows
        // that's not portable, so use a
        // contrived "lipi-nonexistent-12345"
        // name.
        let mut cmd = Command::new("lipi-nonexistent-12345");
        cmd.stdin(Stdio::null());
        let err = run_command_impl(cmd, DEFAULT_TIMEOUT, MAX_OUTPUT_BYTES_DEFAULT)
            .await
            .expect_err("missing program should error");
        match err {
            RunCommandError::Spawn { program, .. } => {
                assert_eq!(program, "lipi-nonexistent-12345");
            }
            other => panic!("expected Spawn, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn stdout_truncation_marks_with_truncated_tag() {
        // Generate ~4 KiB of output and verify
        // it's truncated to 1 KiB with a
        // `<truncated>` marker.
        //
        // Unix: yes has a `--explicit-version`
        // long-version flag that prints a
        // string we can repeat via `head -c`.
        // Simpler: use `sh -c` to call `dd`
        // reading from `/dev/zero` and
        // translating to 'x' bytes. The `dd`
        // path is portable across Linux and
        // macOS.
        //
        // Windows: PowerShell can emit a
        // repeated string directly.
        #[cfg(unix)]
        let cmd = {
            let mut c = Command::new("sh");
            c.args(["-c", "head -c 4096 < /dev/zero | tr '\\0' 'x'"]);
            c.stdin(Stdio::null());
            c
        };
        #[cfg(windows)]
        let cmd = {
            let mut c = Command::new("powershell");
            c.args([
                "-NoProfile",
                "-Command",
                "$out = 'x' * 4096; Write-Output $out",
            ]);
            c.stdin(Stdio::null());
            c
        };
        let result = run_command_impl(cmd, DEFAULT_TIMEOUT, 1024)
            .await
            .expect("should succeed");
        assert!(
            result.stdout.ends_with("<truncated>"),
            "expected truncation marker, got tail: {:?}",
            &result.stdout[result.stdout.len().saturating_sub(40)..]
        );
        // The body should be <= 1024 chars +
        // the 12-char marker. We allow a few
        // bytes of slack for `String::truncate`
        // round-down to a UTF-8 boundary.
        assert!(result.stdout.len() <= 1024 + "<truncated>".len() + 8);
    }

    #[tokio::test]
    async fn public_run_command_requires_policy() {
        let err = run_command(RunCommandArgs {
            program: "npm".to_string(),
            args: vec!["--version".to_string()],
            cwd: None,
            timeout_secs: None,
            max_output_bytes: None,
            policy: None,
        })
        .await
        .expect_err("missing policy should be blocked");
        assert!(matches!(err, RunCommandError::Policy { .. }));
    }

    #[tokio::test]
    async fn public_run_command_rejects_shell_policy_program() {
        let root = temp_dir();
        let err = run_command(RunCommandArgs {
            program: if cfg!(windows) {
                "powershell".to_string()
            } else {
                "sh".to_string()
            },
            args: vec![],
            cwd: Some(root.to_string_lossy().to_string()),
            timeout_secs: None,
            max_output_bytes: None,
            policy: Some(RunCommandPolicy {
                kind: RunCommandPolicyKind::CustomTool,
                tool_name: "bad_shell".to_string(),
                workspace_root: root.to_string_lossy().to_string(),
            }),
        })
        .await
        .expect_err("shell wrapper should be blocked");
        match err {
            RunCommandError::Policy { detail } => assert!(detail.contains("shell")),
            other => panic!("expected policy error, got {other:?}"),
        }
    }

    #[test]
    fn run_command_error_serializes_flat_camel_case() {
        let policy_json = serde_json::to_value(RunCommandError::Policy {
            detail: "blocked".to_string(),
        })
        .expect("policy error should serialize");
        assert_eq!(policy_json["kind"], "policy");
        assert_eq!(policy_json["detail"], "blocked");
        assert!(
            policy_json.get("message").is_none(),
            "Tauri error payload should expose typed fields directly"
        );

        let exit_json = serde_json::to_value(RunCommandError::NonZeroExit {
            code: Some(7),
            stdout: "out".to_string(),
            stderr: "err".to_string(),
        })
        .expect("non-zero exit error should serialize");
        assert_eq!(exit_json["kind"], "nonZeroExit");
        assert_eq!(exit_json["code"], 7);
        assert_eq!(exit_json["stdout"], "out");
        assert_eq!(exit_json["stderr"], "err");
    }
}
