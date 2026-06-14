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
use tauri_plugin_deep_link::DeepLinkExt;

mod fs;
mod fs_watcher;
mod workspace_search;
use fs::{
    read_dir, read_file, write_file, create_file, delete_entry, rename_entry,
    path_exists, FsEntry, FsError, FileContent,
};
use fs_watcher::{fs_unwatch, fs_watch};
use workspace_search::workspace_search;

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

// Phase 2: offline-license signing + verification (the
// first step of the "Lipi to Paid Public Launch" roadmap —
// see HANDOFF §6 "Next:" and §9.24). The licensing module
// is desktop-only (the design doc explicitly defers mobile
// licensing to a later phase — the Apple Keychain
// "shared keychain group" + receipt validation is a non-
// trivial follow-up).
//
// The 4 IPC commands (`license_get_status`,
// `license_activate`, `license_deactivate`,
// `license_get_machine_fingerprint`) are gated
// `#[cfg(not(mobile))]` so the iOS / Android builds don't
// compile the licensing module. See
// `docs/plans/prod-p2-licensing-design.md` for the full
// design and the threat model.
// Phase 2: offline-license signing + verification (the
// first step of the "Lipi to Paid Public Launch" roadmap —
// see HANDOFF §6 "Next:" and §9.24). The licensing module
// is desktop-only (the design doc explicitly defers mobile
// licensing to a later phase — the Apple Keychain
// "shared keychain group" + receipt validation is a non-
// trivial follow-up).
//
// The 4 IPC commands (`license_get_status`,
// `license_activate`, `license_deactivate`,
// `license_get_machine_fingerprint`) are gated
// `#[cfg(not(mobile))]` so the iOS / Android builds don't
// compile the licensing module. See
// `docs/plans/prod-p2-licensing-design.md` for the full
// design and the threat model.
//
// The `pub` keyword on the module (vs. the `pub use` of
// the individual items) is for Phase 3's `sign_license`
// CLI binary (`src-tauri/src/bin/sign_license.rs`), which
// needs to access `licensing::sign_payload` and
// `licensing::LicensePayload` directly. The CLI is gated
// `#[cfg(not(mobile))]` too, so the `pub mod` is also
// gated — the mobile build doesn't see the licensing
// module at all.
#[cfg(not(mobile))]
pub mod licensing;
#[cfg(not(mobile))]
pub use licensing::{
    license_activate, license_deactivate, license_get_machine_fingerprint, license_get_status,
    LicenseStatus,
};

// Phase 3: the IAP (in-app purchase) receipt
// adapter stub. See `src-tauri/src/iap.rs` for the
// full design and `docs/plans/prod-p3-subscription-ux-design.md`
// for the rationale. Desktop-only (mobile IAP is a
// separate phase). The v1 stub returns
// `Invalid { reason: "iap-not-yet-implemented: ..." }`
// for any input; Phase 4 fills in the real receipt
// validation. The UI can be built and tested now
// against the stub.
#[cfg(not(mobile))]
mod iap;
#[cfg(not(mobile))]
mod iap_apple;
#[cfg(not(mobile))]
mod iap_keypair;
#[cfg(not(mobile))]
mod iap_microsoft;
#[cfg(not(mobile))]
mod iap_oauth;
#[cfg(not(mobile))]
pub use iap::iap_redeem;
#[cfg(not(mobile))]
pub use iap::iap_refresh_license;
#[cfg(not(mobile))]
pub use licensing::license_get_kid;

// Phase 5: the updater endpoint health check. See
// `src-tauri/src/updater_health.rs` for the full
// design and `docs/plans/prod-p5-release-pipeline-design.md`
// for the rationale. Desktop-only (mobile apps have
// their own updater). The frontend's About screen
// calls the `updater_health_check` Tauri command on
// mount to display "Updater: ✓ reachable" or
// "Updater: ✗ unreachable — …".
#[cfg(not(mobile))]
mod updater_health;
#[cfg(not(mobile))]
pub use updater_health::updater_health_check;

// Phase 5: the `rotate_updater_key` CLI library.
// See `src-tauri/src/rotate_updater_key.rs` for
// the pure logic (argument parsing, pubkey
// validation, JSON patching) and
// `src-tauri/src/bin/rotate_updater_key.rs` for the
// thin I/O wrapper. `pub` so the binary can import
// it. Desktop-only (the CLI is for the project
// lead's dev machine, not end users).
#[cfg(not(mobile))]
pub mod rotate_updater_key;

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

// M2c (on-device STT). See HANDOFF §9.7. The model
// lifecycle (list / install / remove / set_active /
// is_available) is in `stt.rs`; the mic capture + whisper
// inference is in `stt_capture.rs`. Both modules are
// compiled in both the stub and the real (`m2c-native`)
// builds — the feature flag only swaps the implementation
// of `install_model` / `remove_model` / `set_active_model`
// and the `start_listening` / `stop_listening` capture
// loop.
mod stt;
pub use stt::{
    is_available as stt_is_available_rs, is_model_installed as stt_is_model_installed_rs,
    list_installed_models as stt_list_installed_models_rs, list_models as stt_list_models_rs,
    model_by_id as stt_model_by_id_rs, read_active_model_id as stt_read_active_model_id_rs,
    write_active_model_id as stt_write_active_model_id_rs, install_model as stt_install_model_rs,
    remove_model as stt_remove_model_rs, set_active_model as stt_set_active_model_rs,
    SttError, SttModelDescriptor, STT_EVENT_DOWNLOAD_PROGRESS, STT_EVENT_ERROR,
    STT_EVENT_TRANSCRIPT,
};

mod stt_capture;
pub use stt_capture::{
    start_listening as stt_start_listening_rs, stop_listening as stt_stop_listening_rs,
    ListenOptions, TranscriptEvent, WHISPER_SAMPLE_RATE_HZ, WHISPER_SAMPLES_PER_MS,
};

// M2c mobile: a tiny compile-time capability
// surface. Reports which STT providers the current
// build's OS can support. The JS side reads the
// payload once at startup and the Command Palette's
// `isEnabled` predicates use it synchronously to
// show / grey-out the "Use browser speech engine"
// command. See `voice_platform.rs` for the full
// design and `docs/decisions/0046-m2c-mobile-shim.md`
// for the ADR.
mod voice_platform;
pub use voice_platform::get_capabilities as voice_platform_get_capabilities_rs;

// Phase J: workspace starter templates. The Welcome
// screen's "Template gallery" hands this module a
// `template_id` and a destination dir; we expand
// the template's inlined files into that dir
// atomically (staging + rename). See `templates.rs`
// for the full design and the unit tests.
mod templates;
pub use templates::{apply as templates_apply, ApplyResult as TemplatesApplyResult, TemplateError as TemplatesError};
mod native_dictation;
pub use native_dictation::get_native_dictation_contract;

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
/// The `open_devtools()` method is `#[cfg]`-gated by the
/// upstream Tauri crate — it only exists in `debug` builds
/// OR when the `devtools` cargo feature is enabled. Since
/// this is a dev-only tool, we gate the call site with
/// `#[cfg(debug_assertions)]` instead of enabling the
/// feature in production (no need to ship devtools in
/// release binaries). In release builds the command
/// remains registered (so the JS-side `invoke` doesn't
/// throw "command not found") but it just returns Ok.
///
/// No-op on platforms that don't support devtools (e.g.
/// Android — see the `@tauri-apps/api` `WebviewConfig.devtools`
/// doc for the full matrix). On Windows the devtools
/// inspector is part of WebView2; on macOS it's the
/// Safari Web Inspector; on Linux it depends on the
/// webkit2gtk build.
#[tauri::command]
fn open_devtools(window: tauri::WebviewWindow) -> Result<(), String> {
    #[cfg(debug_assertions)]
    {
        window.open_devtools();
    }
    let _ = window; // silence unused warning in release builds
    Ok(())
}

// --- Phase J: workspace templates -----------------------------------------
//
// The Welcome screen's "Template gallery" hands us a
// template id and a destination directory. The Rust side
// expands the template's inlined file list into `dest`
// atomically. See `templates.rs` for the full design,
// the per-template file lists, and the unit tests.
//
// The destination must be an empty directory — we
// refuse to write into a non-empty one (avoids
// clobbering existing files). The JS `useApplyTemplate`
// flow is responsible for creating a fresh subdir
// before calling this.

#[tauri::command]
fn apply_template(
    template_id: String,
    dest_dir: String,
) -> Result<TemplatesApplyResult, TemplatesError> {
    templates_apply(&template_id, std::path::Path::new(&dest_dir))
}

// --- Phase M5: haptics ----------------------------------------------------
//
// The JS-side `useHaptics` hook calls this command
// with one of three intensities. On desktop the
// command is a no-op (desktops don't have a haptic
// engine, and emitting a console warning per call
// would spam the dev console). On mobile (iOS /
// Android) the real implementation lands with the
// iOS Swift / Android Kotlin plugins — see
// HANDOFF §9.13. The `#[cfg(mobile)]` split means
// the desktop binary stays the same and the mobile
// binary has the placeholder for the future
// Swift / Kotlin bridge.

/// The three haptic intensities the UI calls. Mirrors
/// the iOS `UIImpactFeedbackGenerator` / Android
/// `HapticFeedbackConstants` scale.
#[derive(Debug, Serialize, Deserialize, Clone, Copy)]
#[serde(rename_all = "lowercase")]
enum HapticIntensity {
    Light,
    Medium,
    Heavy,
}

#[tauri::command]
fn haptic(intensity: HapticIntensity) -> Result<(), String> {
    // Mobile: defer to the Swift / Kotlin plugin
    // (deferred — see HANDOFF §9.13).
    //
    // Desktop: explicit no-op. We intentionally do
    // NOT log here — `useHaptics` is called on every
    // tab switch, voice start, and undo, and a log
    // per call would be unbearable.
    #[cfg(mobile)]
    {
        let _ = intensity;
        // Future: forward to the plugin's mobile
        // bridge. Until the Swift / Kotlin plugins
        // land, mobile is also a no-op (and a no-op
        // on mobile isn't great UX, but it's no
        // worse than the current state — the v1
        // build doesn't even support the mobile
        // targets).
    }
    #[cfg(not(mobile))]
    {
        let _ = intensity;
    }
    Ok(())
}

/// Phase I: the user's home, Documents, and Desktop
/// directories. Returned as strings (display form on each
/// platform) so the JS-side deep-link path validator can
/// check that an incoming `app://lipi.open?path=...` URL
/// points at a user-owned location. We expand `~` /
/// `%USERPROFILE%` to the absolute, canonical paths
/// (resolving symlinks where the platform can) so a
/// comparison like `path.startsWith(home)` is reliable.
/// If a dir is missing (e.g. a Linux user with no
/// `~/Desktop`), its field is `None` — the JS side
/// treats that as "this root is unavailable" and falls
/// back to the home-only rule.
#[derive(Debug, Serialize)]
struct UserDirs {
    home: String,
    documents: Option<String>,
    desktop: Option<String>,
}

/// Expand `~` and resolve symlinks. Uses
/// `std::fs::canonicalize` to follow symlinks and return
/// the platform-canonical absolute path (with `\\?\`
/// prefix on Windows stripped, so the path looks like
/// `C:\Users\foo` and not `\\?\C:\Users\foo`).
fn expand_dir(p: &std::path::Path) -> Option<String> {
    let canonical = std::fs::canonicalize(p).ok()?;
    let s = canonical.to_string_lossy().to_string();
    // Strip the Windows extended-length prefix.
    let stripped = s.strip_prefix(r"\\?\").unwrap_or(&s);
    Some(stripped.to_string())
}

#[tauri::command]
fn get_user_dirs() -> UserDirs {
    // `$HOME` on Unix, `%USERPROFILE%` on Windows. We
    // prefer the env var so we don't depend on `dirs`
    // crate (it would add a dep for one constant).
    let home_raw = if cfg!(target_os = "windows") {
        std::env::var_os("USERPROFILE")
    } else {
        std::env::var_os("HOME")
    };
    let home_path = home_raw
        .as_ref()
        .map(std::path::PathBuf::from)
        .unwrap_or_default();
    let home = expand_dir(&home_path).unwrap_or_default();

    // Documents / Desktop: platform-specific well-known
    // names. We try the canonical names first, then fall
    // back to the locale variants on Windows
    // (`Documents` vs `My Documents`).
    let documents_candidates: &[&str] = if cfg!(target_os = "windows") {
        &["Documents"]
    } else {
        &["Documents"]
    };
    let desktop_candidates: &[&str] = if cfg!(target_os = "windows") {
        &["Desktop"]
    } else {
        &["Desktop"]
    };

    let documents = documents_candidates
        .iter()
        .map(|name| home_path.join(name))
        .find_map(|p| expand_dir(&p));
    let desktop = desktop_candidates
        .iter()
        .map(|name| home_path.join(name))
        .find_map(|p| expand_dir(&p));

    UserDirs {
        home,
        documents,
        desktop,
    }
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

#[tauri::command]
fn fs_create_file(path: String) -> Result<(), FsError> {
    create_file(std::path::Path::new(&path))
}

#[tauri::command]
fn fs_delete_entry(path: String) -> Result<(), FsError> {
    delete_entry(std::path::Path::new(&path))
}

#[tauri::command]
fn fs_rename_entry(from: String, to: String) -> Result<(), FsError> {
    rename_entry(std::path::Path::new(&from), std::path::Path::new(&to))
}

/// Phase 7: cheap path-exists check for `tsConfigStore` (and any
/// other "should I bother reading this file?" caller). Returns
/// `true` for any path the OS can stat — files, directories,
/// symlinks. `false` for missing paths and paths we can't read
/// (a permission-denied is treated as "doesn't exist" because the
/// call site just wants a yes/no).
#[tauri::command]
fn fs_path_exists(path: String) -> bool {
    path_exists(std::path::Path::new(&path))
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

// --- Phase M2c desktop: on-device STT (model lifecycle) ----

/// The M2c IPC surface. We expose eight commands
/// covering the model lifecycle and the start/stop of
/// a capture session. The commands are deliberately
/// thin: each one delegates to the relevant function in
/// `stt.rs` or `stt_capture.rs` after resolving the
/// `AppHandle`'s data dir. The commands themselves
/// contain no business logic.
///
/// Naming convention: the JS wrapper in
/// `src/ipc/stt.ts` calls them via `invoke('stt_…', …)`.
/// The Rust side uses `snake_case` per Tauri convention;
/// serde's `#[serde(rename_all = "camelCase")]` is NOT
/// needed because these are command names, not struct
/// fields.
///
/// Event names (`stt://download-progress`,
/// `stt://transcript`, `stt://error`) are re-exported
/// from `stt.rs` and used both by the capture module
/// and by the IPC layer for subscription.

/// Return the curated list of STT models. The JS
/// settings panel renders a card per model. No state.
/// No async. No I/O.
#[tauri::command]
fn stt_list_models() -> Vec<SttModelDescriptor> {
    stt_list_models_rs()
}

/// Return the ids of models that are currently
/// installed on disk. With `m2c-native` off (the dev
/// build), this is the full curated list (the stub
/// reports every model as installed); with the
/// feature on, this is the subset of the curated list
/// for which a non-empty file exists at the expected
/// path.
#[tauri::command]
fn stt_list_installed_models(app: AppHandle) -> Result<Vec<String>, SttError> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| SttError::Io { message: e.to_string() })?;
    Ok(stt_list_installed_models_rs(&data_dir))
}

/// Returns `true` if the user has a model configured
/// as active. The JS `useVoiceCapture` short-circuits
/// the `'ondevice'` branch to "provider not configured"
/// if this returns `false`.
#[tauri::command]
fn stt_is_available(app: AppHandle) -> Result<bool, SttError> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| SttError::Io { message: e.to_string() })?;
    Ok(stt_is_available_rs(&data_dir))
}

/// Install (download) a model by id. Emits
/// `stt://download-progress` events with throttled
/// frequency (4 Hz). The JS side shows a progress
/// bar; the model becomes selectable as "active" on
/// completion. With `m2c-native` off, this is a
/// no-op that emits a single `done: true` event
/// (the JS side updates the UI as if the download
/// completed).
#[tauri::command]
async fn stt_install_model(app: AppHandle, id: String) -> Result<(), SttError> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| SttError::Io { message: e.to_string() })?;
    stt_install_model_rs(&app, &data_dir, &id).await
}

/// Remove a model by id. Idempotent. If the removed
/// model was the active one, the active preference
/// is cleared. The JS settings panel calls this
/// from the model card's "Delete" button.
#[tauri::command]
async fn stt_remove_model(app: AppHandle, id: String) -> Result<(), SttError> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| SttError::Io { message: e.to_string() })?;
    stt_remove_model_rs(&app, &data_dir, &id).await
}

/// Set the active model by id. Validates that the id
/// is in the curated list AND (with `m2c-native` on)
/// that the file is on disk. The JS settings panel
/// calls this from the radio-button click.
#[tauri::command]
async fn stt_set_active_model(app: AppHandle, id: String) -> Result<(), SttError> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| SttError::Io { message: e.to_string() })?;
    stt_set_active_model_rs(&app, &data_dir, &id).await
}

/// Start a capture session. Returns the `sessionId`.
/// The JS side subscribes to `stt://transcript` /
/// `stt://error` events BEFORE calling this (the
/// transcript is emitted within milliseconds of
/// `stop_listening` in the real path; the stub
/// emits a fake one 200 ms after `start_listening`).
///
/// `opts` is optional in the JS IPC layer (we use
/// `Option<ListenArgs>` and unwrap to defaults).
#[tauri::command]
async fn stt_start_listening(
    app: AppHandle,
    opts: Option<stt_listen_args_js::ListenArgs>,
) -> Result<String, SttError> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| SttError::Io { message: e.to_string() })?;
    let listen_opts = opts
        .map(|o| ListenOptions {
            language: o.language,
            max_duration_ms: o.max_duration_ms,
        })
        .unwrap_or_default();
    stt_start_listening_rs(app, &data_dir, listen_opts).await
}

/// Stop a capture session. The `sessionId` is the
/// value returned by `stt_start_listening`. Idempotent
/// (calling stop on an unknown session returns `Ok(())`).
/// After this call, the next `stt://transcript` event
/// for this session will be the last (if any).
#[tauri::command]
async fn stt_stop_listening(
    app: AppHandle,
    session_id: String,
) -> Result<(), SttError> {
    stt_stop_listening_rs(&app, &session_id).await
}

/// M2c mobile: report which STT backends the
/// current build can support, so the JS side can
/// show / grey-out the "Use browser speech engine"
/// Command Palette command on Linux (where WebKitGTK
/// doesn't ship `SpeechRecognition`) and surface it
/// on Windows / macOS / iOS.
///
/// The returned shape is `VoicePlatformCapabilities`
/// (serialised as `camelCase`):
///   - `ondevice`:         M2c desktop Whisper path
///   - `webSpeech`:        WebView's `SpeechRecognition`
///   - `nativeDictation`:  Future iOS / Android plugin
///   - `osFamily`:         The coarse OS family
///
/// Pure compile-time decision; no I/O, no async, no
/// state. The JS side hydrates the
/// `voiceCapabilitiesStore` once at app startup
/// (next to `setupVoicePreferencesPersistence()`).
/// See `docs/decisions/0046-m2c-mobile-shim.md` for
/// the ADR and the deferred Swift / Kotlin plugin
/// notes.
#[tauri::command]
fn voice_platform_get_capabilities() -> voice_platform::VoicePlatformCapabilities {
    voice_platform_get_capabilities_rs()
}

/// `stt_start_listening`'s IPC arg shape. The Rust
/// `ListenOptions` struct stays private to the
/// `stt_capture` module; the JS side talks to this
/// camelCase shape and we translate. Mirrors the
/// `ChatRequestArgs` pattern in 5b-1.
mod stt_listen_args_js {
    use serde::Deserialize;
    #[derive(Debug, Clone, Default, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct ListenArgs {
        /// BCP-47 language tag, e.g. "en".
        pub language: Option<String>,
        /// Hard cap on session audio length.
        pub max_duration_ms: Option<u32>,
    }
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
    // Phase I: when the OS hands the app an `app://lipi.open?path=...`
    // URL (cold start, warm activation, or a second-instance launch on
    // Windows / Linux), the deep-link plugin fires a `deep-link://new-url`
    // event. We re-emit it as `lipi://deep-link` so the frontend doesn't
    // have to depend on the plugin's internal event name (which could
    // change between plugin versions). The frontend parses the URL
    // shape and validates the path against the user's home / Documents
    // / Desktop before opening the workspace.
    //
    // Registering the listener inside `setup` (rather than at builder
    // time) is required because the plugin's `on_open_url` API needs
    // an `AppHandle`, which is only available once the runtime is up.
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_deep_link::init())
        .setup(|app| {
            let handle_for_emit = app.handle().clone();
            app.handle().clone().deep_link().on_open_url(move |event| {
                for url in event.urls() {
                    let s: String = url.into();
                    let _ = handle_for_emit.emit("lipi://deep-link", s);
                }
            });
            // On Linux + Windows dev builds, the scheme isn't registered
            // by the OS unless we ask the plugin to do it at runtime.
            // Production MSI / .deb / .dmg installers register the scheme
            // themselves; the dev-build fallback is `register_all()`.
            #[cfg(any(target_os = "linux", all(debug_assertions, target_os = "windows")))]
            {
                let _ = app.deep_link().register_all();
            }
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
        });

    builder
        .invoke_handler(tauri::generate_handler![
            get_app_version,
            open_devtools,
            fs_read_dir,
            fs_read_file,
            fs_write_file,
            fs_pick_folder,
            fs_create_file,
            fs_delete_entry,
            fs_rename_entry,
            fs_path_exists,
            fs_watch,
            fs_unwatch,
            workspace_search,
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
            stt_list_models,
            stt_list_installed_models,
            stt_is_available,
            stt_install_model,
            stt_remove_model,
            stt_set_active_model,
            stt_start_listening,
            stt_stop_listening,
            voice_platform_get_capabilities,
            get_user_dirs,
            apply_template,
            haptic,
            get_native_dictation_contract,
            #[cfg(not(mobile))]
            license_get_status,
            #[cfg(not(mobile))]
            license_activate,
            #[cfg(not(mobile))]
            license_deactivate,
            #[cfg(not(mobile))]
            license_get_machine_fingerprint,
            #[cfg(not(mobile))]
            iap_redeem,
            #[cfg(not(mobile))]
            updater_health_check,
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
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
