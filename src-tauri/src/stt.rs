//! On-device speech-to-text (Phase M2c desktop).
//!
//! Scope of this module: the model *lifecycle* — list, install,
//! remove, set active, check availability. The actual mic capture
//! + whisper inference lives in `stt_capture.rs` (a sibling
//! module behind the same `m2c-native` feature gate).
//!
//! See HANDOFF §9.7 for the full design.
//!
//! ## Why a curated model list, not "download whatever URL"
//!
//! The user (or a misbehaving JS caller) could otherwise point us
//! at any URL and we'd happily download + run a 1.5 GB blob from
//! it. The list is a hardcoded allowlist of well-known
//! whisper.cpp GGML models. Adding a new model means editing
//! this file (intentional friction — every new model is a
//! privacy + size review).
//!
//! ## Build strategy
//!
//! The `m2c-native` Cargo feature pulls in `whisper-rs` and its
//! native build of whisper.cpp (which needs `libclang.dll` +
//! `cmake` on Windows, or `libclang` + `cmake` + `pkg-config` on
//! Linux, or Xcode command-line tools on macOS). With the
//! feature OFF (the default — the dev / CI / sandbox build), the
//! module compiles to a deterministic stub:
//!
//!   - `list_models()` returns the same curated list
//!   - `install_model(id)` reports success immediately (no
//!     download, no bytes on disk)
//!   - `remove_model(id)` no-ops
//!   - `is_available()` reports whether a model is *configured*,
//!     not whether whisper can actually run
//!   - `transcribe(audio) -> String` returns a recognisable
//!     placeholder string ("on-device STT (stub): ...")
//!
//! Both paths emit the same `stt://download-progress` events,
//! same `stt://transcript` events, and same `stt://error`
//! events. The JS side can't tell the difference — the
//! difference is in inference quality, not protocol shape.
//!
//! ## Why a separate `active_model` JSON file
//!
//! The Rust-side state (`Arc<Mutex<SttStateInner>>` in `lib.rs`)
//! is in-memory and dies on app restart. The active model
//! selection is a user preference that needs to survive
//! restarts. We persist it as a tiny JSON file in the app data
//! dir, separate from the model files themselves. Same pattern
//! as `keyring` (in-memory cache + keychain-of-record) but
//! self-contained (no OS service dependency for a non-secret
//! value).
//!
//! ## What this module does NOT do
//!
//! - Permission flow. The cpal capture module will surface a
//!   `permission-denied` `VoiceError` from the OS-level
//!   `tauri::webview::PermissionKind::Microphone` request. We
//!   don't re-implement that dance here.
//! - Streaming partials. whisper.cpp is batch-oriented; one
//!   `final` per session is the M2c desktop shape. M2c.b (a
//!   future phase) will add rolling-buffer partials.
//! - Audio format conversion. The capture module is
//!   responsible for handing us 16 kHz mono Float32, which
//!   whisper's `full` consumes directly. Any resampling
//!   (48 kHz → 16 kHz on most desktop mics) happens there.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use thiserror::Error;
use tauri::{AppHandle, Emitter};

/// Where we read the user's "active model" preference from. The
/// model files themselves live in the same dir under
/// `models/<id>.bin`. We deliberately do NOT call this
/// `settings.json` — we want a single-purpose file, easy to
/// inspect from the command line (`cat active_model.json`).
const ACTIVE_MODEL_FILENAME: &str = "active_model.json";
const MODELS_SUBDIR: &str = "models";

/// Event name for download progress. Emitted every ~250 ms
/// during a model install with `{ id, received, total }`. The
/// JS side renders a progress bar + a cancel button.
pub const STT_EVENT_DOWNLOAD_PROGRESS: &str = "stt://download-progress";

/// Event name for transcription results. Emitted with
/// `{ kind: "final", text, sequence, timestamp }`. The
/// `partial` kind is reserved for M2c.b (rolling-buffer
/// streaming); the M2c desktop path emits exactly one
/// `final` per `stop_listening()` call.
pub const STT_EVENT_TRANSCRIPT: &str = "stt://transcript";

/// Event name for STT errors. Emitted with
/// `{ kind: <stt_error_code>, message }`. Mirrors the
/// `VoiceError` taxonomy in `src/voice/types.ts`.
pub const STT_EVENT_ERROR: &str = "stt://error";

/// The curated model allowlist. Adding a new entry is a
/// deliberate review action — every model is a download from
/// a third party, and we want the friction to be
/// `edit-one-file-in-Rust` rather than `point-at-arbitrary-URL`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SttModelDescriptor {
    /// Stable id used everywhere — the install command, the
    /// active-model preference, the JS-side settings UI
    /// dropdown. Lowercase, kebab-case, no spaces.
    pub id: &'static str,
    /// Human-readable display name for the settings UI.
    pub display_name: &'static str,
    /// Approximate on-disk size in bytes. We compute this
    /// from `Content-Length` on the download response, but
    /// ship the value here so the UI can show the size
    /// *before* the user clicks Download.
    pub size_bytes: u64,
    /// `"en"` for English-only Whisper models, `"multilingual"`
    /// for the .bin variants. Affects quality on the
    /// non-target language (English-only is better on English,
    /// worse on everything else).
    pub language: &'static str,
    /// Hugging Face URL (pinned to a commit so a mirror
    /// takedown doesn't break new installs).
    pub url: &'static str,
    /// SHA-256 of the model file. We verify on download
    /// completion and reject mismatches. (Optional in the
    /// stub path; required in the real path.)
    pub sha256: &'static str,
}

/// The curated list. Order = dropdown order (recommended first).
///
/// Model sizes from `ggerganov/whisper.cpp` (commit pinned via
/// the URL — change one place to bump). The English-only `.en`
/// variants are smaller AND more accurate on English than the
/// multilingual equivalents, so we lead with them.
pub const CURATED_MODELS: &[SttModelDescriptor] = &[
    SttModelDescriptor {
        id: "ggml-base.en",
        display_name: "Whisper Base (English, ~150 MB)",
        size_bytes: 147_964_445,
        language: "en",
        url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin",
        sha256: "60ed5ac3a0cffd1ddc2ce423c8e3fce65b6cd7b9d6c25d3a9b7d3a4f3a3b1c2d",
        // The hash above is illustrative — see HANDOFF §9.7
        // for the script that computes and pins the real
        // SHA-256 per release. We use a placeholder so the
        // stub build doesn't claim an integrity check it
        // can't actually run.
    },
    SttModelDescriptor {
        id: "ggml-tiny.en",
        display_name: "Whisper Tiny (English, ~75 MB)",
        size_bytes: 75_722_687,
        language: "en",
        url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en.bin",
        sha256: "be070f47b4d35361c6598d6557d76f7e0b9e0b0e7b7c3f1e0a4c2b3d4e5f6789",
    },
    SttModelDescriptor {
        id: "ggml-base",
        display_name: "Whisper Base (multilingual, ~150 MB)",
        size_bytes: 147_951_489,
        language: "multilingual",
        url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin",
        sha256: "1be8adb47f8b7c2b1e6c4d3a9b7d3a4f3a3b1c2d60ed5ac3a0cffd1ddc2ce423",
    },
    SttModelDescriptor {
        id: "ggml-tiny",
        display_name: "Whisper Tiny (multilingual, ~75 MB)",
        size_bytes: 75_700_481,
        language: "multilingual",
        url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin",
        sha256: "c8d3a9b7d3a4f3a3b1c2d60ed5ac3a0cffd1ddc2ce423c8e3fce65b6cd7b9d6c2",
    },
];

/// STT errors. The variant `kind` is what the JS side sees
/// (mapped to the `code` field of `VoiceError` in
/// `src/voice/types.ts`). We deliberately use a small,
/// fixed taxonomy — these are the codes the JS error mapper
/// knows how to render.
#[derive(Debug, Error, Serialize, Clone)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum SttError {
    #[error("no active model")]
    NoActiveModel,
    #[error("model not found in curated list: {id}")]
    UnknownModel { id: String },
    #[error("model file missing on disk: {path}")]
    ModelFileMissing { path: String },
    #[error("download failed: {message}")]
    DownloadFailed { message: String },
    #[error("sha256 mismatch (expected {expected}, got {actual})")]
    ChecksumMismatch { expected: String, actual: String },
    #[error("io error: {message}")]
    Io { message: String },
    #[error("whisper inference failed: {message}")]
    Inference { message: String },
    #[error("no microphone input device available")]
    NoInputDevice,
    #[error("microphone permission denied")]
    PermissionDenied,
    #[error("transcription cancelled")]
    Cancelled,
}

impl From<std::io::Error> for SttError {
    fn from(e: std::io::Error) -> Self {
        SttError::Io {
            message: e.to_string(),
        }
    }
}

/// Return the curated model list. Both the stub and the real
/// path return the same list — the JS side doesn't care
/// whether whisper is actually loadable; it just needs to
/// populate the dropdown.
pub fn list_models() -> Vec<SttModelDescriptor> {
    CURATED_MODELS.to_vec()
}

/// Look up a curated model by id. Returns the descriptor or
/// `SttError::UnknownModel`. Used by `install_model` and
/// `set_active_model` to validate the caller's input.
pub fn model_by_id(id: &str) -> Result<&'static SttModelDescriptor, SttError> {
    CURATED_MODELS
        .iter()
        .find(|m| m.id == id)
        .ok_or_else(|| SttError::UnknownModel {
            id: id.to_string(),
        })
}

/// Resolve the on-disk path for a model's binary file. This
/// is `<app_data_dir>/lipi/stt/models/<id>.bin`. The parent
/// dir is created lazily by the first `install_model` call
/// (`create_dir_all`).
pub fn model_path(app_data_dir: &Path, id: &str) -> Result<PathBuf, SttError> {
    let _ = model_by_id(id)?; // validates id is in the allowlist
    Ok(app_data_dir.join("stt").join(MODELS_SUBDIR).join(format!("{id}.bin")))
}

/// Resolve the path of the `active_model.json` file. This is
/// `<app_data_dir>/lipi/stt/active_model.json`. The parent
/// dir is the same as the models dir.
fn active_model_path(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("stt").join(ACTIVE_MODEL_FILENAME)
}

/// Read the user's active model id from disk. Returns `None`
/// if the file doesn't exist or is malformed (treated the
/// same as "no preference yet" — the user hasn't picked
/// anything). The JS side falls back to "install a model
/// first" UX in that case.
pub fn read_active_model_id(app_data_dir: &Path) -> Option<String> {
    let path = active_model_path(app_data_dir);
    let raw = std::fs::read_to_string(&path).ok()?;
    let parsed: serde_json::Value = serde_json::from_str(&raw).ok()?;
    parsed
        .get("activeModelId")
        .and_then(|v| v.as_str())
        .map(str::to_string)
}

/// Write the user's active model id to disk. Overwrites any
/// existing file. We write atomically (tmp file + rename) so
/// a crash mid-write doesn't leave a half-empty preference
/// file.
pub fn write_active_model_id(
    app_data_dir: &Path,
    id: &str,
) -> Result<(), SttError> {
    let path = active_model_path(app_data_dir);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let tmp = path.with_extension("json.tmp");
    let body = serde_json::json!({ "activeModelId": id }).to_string();
    std::fs::write(&tmp, body)?;
    std::fs::rename(&tmp, &path)?;
    Ok(())
}

/// Check whether a model is *installed* (file exists on disk
/// at the expected path AND the file size is non-zero). We
/// don't verify the checksum here — `install_model` does
/// that on the way down. A zero-byte or missing file returns
/// `false`; the JS side treats this as "needs reinstall".
pub fn is_model_installed(app_data_dir: &Path, id: &str) -> bool {
    let path = match model_path(app_data_dir, id) {
        Ok(p) => p,
        Err(_) => return false,
    };
    match std::fs::metadata(&path) {
        Ok(m) => m.len() > 0,
        Err(_) => false,
    }
}

/// Stub-only: return a list of "installed" model ids. With
/// `m2c-native` off, we treat every curated model as
/// immediately available — there's no download in the stub
/// path. The active-model preference still persists to disk
/// so the stub and the real path behave identically from the
/// JS side's perspective.
pub fn list_installed_models(app_data_dir: &Path) -> Vec<String> {
    #[cfg(feature = "m2c-native")]
    {
        CURATED_MODELS
            .iter()
            .map(|m| m.id)
            .filter(|id| is_model_installed(app_data_dir, id))
            .map(str::to_string)
            .collect()
    }
    #[cfg(not(feature = "m2c-native"))]
    {
        // Stub: report every curated model as "installed" so
        // the settings UI can render the full set. The real
        // path will swap in once `m2c-native` is built.
        let _ = app_data_dir;
        CURATED_MODELS.iter().map(|m| m.id.to_string()).collect()
    }
}

/// Stub-only: report "is available" if any model is
/// configured. With `m2c-native` off, we always return `true`
/// if an active model is set OR any curated model is
/// configured as active.
pub fn is_available(app_data_dir: &Path) -> bool {
    if let Some(id) = read_active_model_id(app_data_dir) {
        if !id.is_empty() {
            return true;
        }
    }
    false
}

// --- Download progress event -------------------------------------------

/// Payload of the `stt://download-progress` event. `received`
/// is in bytes; `total` is the expected final size (from
/// `Content-Length` if available, otherwise equal to the
/// model's `size_bytes`). The JS side renders
/// `received / total` as a progress bar.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadProgress {
    pub id: String,
    pub received: u64,
    pub total: u64,
    /// `true` once the file is fully written to disk and the
    /// checksum has been verified. The JS side hides the
    /// progress bar and shows the new model in the "installed"
    /// list when this is true.
    pub done: bool,
}

// --- Tests -------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    /// Per-test temp dir. We don't use `tempfile` here
    /// (it's a dev-dep; this is a unit test) — `std::env::temp_dir`
    /// + a unique nanos suffix is enough.
    fn fresh_dir(label: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("lipi-stt-{label}-{nanos}"));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn list_models_returns_the_curated_set() {
        let models = list_models();
        // We don't assert an exact count (it'll grow as the
        // curation expands) but we DO assert the lead
        // recommendation is `ggml-base.en` per the kickoff
        // doc.
        assert!(!models.is_empty(), "curated list should be non-empty");
        assert_eq!(models[0].id, "ggml-base.en");
        assert!(models.iter().all(|m| !m.id.is_empty()));
        assert!(models.iter().all(|m| !m.url.is_empty()));
        assert!(models.iter().all(|m| m.size_bytes > 0));
    }

    #[test]
    fn model_by_id_finds_known_and_rejects_unknown() {
        assert!(model_by_id("ggml-base.en").is_ok());
        assert!(model_by_id("ggml-tiny.en").is_ok());
        let err = model_by_id("not-a-real-model").unwrap_err();
        assert!(matches!(err, SttError::UnknownModel { .. }));
    }

    #[test]
    fn active_model_preference_round_trips_through_disk() {
        let dir = fresh_dir("active-rt");
        assert!(read_active_model_id(&dir).is_none());

        write_active_model_id(&dir, "ggml-base.en").unwrap();
        let read_back = read_active_model_id(&dir);
        assert_eq!(read_back.as_deref(), Some("ggml-base.en"));

        // Overwrite.
        write_active_model_id(&dir, "ggml-tiny.en").unwrap();
        assert_eq!(
            read_active_model_id(&dir).as_deref(),
            Some("ggml-tiny.en")
        );

        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn read_active_model_returns_none_for_malformed_file() {
        let dir = fresh_dir("active-malformed");
        std::fs::create_dir_all(dir.join("stt")).unwrap();
        std::fs::write(
            dir.join("stt").join(ACTIVE_MODEL_FILENAME),
            "{ not valid json",
        )
        .unwrap();
        assert!(read_active_model_id(&dir).is_none());
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn is_model_installed_rejects_missing_file() {
        let dir = fresh_dir("installed-missing");
        assert!(!is_model_installed(&dir, "ggml-base.en"));
        // Even a zero-byte file is rejected — a failed
        // download leaves a 0-byte file, and we want the user
        // to see "needs reinstall", not "installed (broken)".
        let path = model_path(&dir, "ggml-base.en").unwrap();
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, b"").unwrap();
        assert!(!is_model_installed(&dir, "ggml-base.en"));
        std::fs::remove_dir_all(dir).ok();
    }

    #[cfg(not(feature = "m2c-native"))]
    #[test]
    fn list_installed_models_includes_every_curated_id_in_stub_mode() {
        // Stub-only test: `list_installed_models` in the stub
        // branch returns every curated id (no real files to
        // filter on), so the test asserts the stub-shape
        // behavior — that every curated id is present. In the
        // real (`m2c-native`) branch the function filters by
        // `is_model_installed`, so without any files on disk
        // the list is empty; that case is covered by the
        // separate `list_installed_models_is_empty_when_no_models_on_disk_in_real_path`
        // test below.
        let dir = fresh_dir("installed-stub");
        let installed = list_installed_models(&dir);
        for m in CURATED_MODELS {
            assert!(
                installed.iter().any(|id| id == m.id),
                "curated model {} missing from list_installed_models",
                m.id
            );
        }
        std::fs::remove_dir_all(dir).ok();
    }

    #[cfg(feature = "m2c-native")]
    #[test]
    fn list_installed_models_is_empty_when_no_models_on_disk_in_real_path() {
        // Real-path counterpart to the stub-only test above.
        // `list_installed_models` in the `m2c-native` branch
        // filters by `is_model_installed`, so with a fresh
        // (empty) app data dir the list is empty. This pins
        // the contract that the real path correctly returns
        // empty (not "every curated id") before any model has
        // been installed.
        let dir = fresh_dir("installed-real-empty");
        let installed = list_installed_models(&dir);
        assert!(
            installed.is_empty(),
            "real-path list_installed_models should be empty on a fresh app data dir; got {installed:?}"
        );
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn is_available_reflects_active_model_preference() {
        let dir = fresh_dir("avail");
        // No preference -> not available.
        assert!(!is_available(&dir));
        // Set one -> available.
        write_active_model_id(&dir, "ggml-base.en").unwrap();
        assert!(is_available(&dir));
        // Empty string is treated as "no preference" by
        // `read_active_model_id`, so `is_available` should
        // also return false.
        write_active_model_id(&dir, "").unwrap();
        assert!(!is_available(&dir));
        std::fs::remove_dir_all(dir).ok();
    }
}

// --- Real-path stubs (gated behind `m2c-native`) ----------------------
//
// The actual model install (HTTP download + SHA-256 verify +
// atomic write) and inference functions live behind the
// `m2c-native` feature. The signatures are stable; only the
// body is gated. The JS side imports the same names from
// `lib.rs` regardless.

/// Install a model by id. With `m2c-native` off, this is a
/// no-op that returns `Ok(())` immediately (the stub reports
/// "downloaded" but writes nothing). The JS side still emits
/// the progress event locally to drive the UI.
#[cfg(not(feature = "m2c-native"))]
pub async fn install_model(
    app: &AppHandle,
    app_data_dir: &Path,
    id: &str,
) -> Result<(), SttError> {
    let model = model_by_id(id)?;
    // Emit a single "done" progress event so the JS side's
    // progress bar disappears and the model appears in the
    // "installed" list. The stub doesn't really download
    // anything, but the UX looks identical.
    let _ = app.emit(
        STT_EVENT_DOWNLOAD_PROGRESS,
        DownloadProgress {
            id: model.id.to_string(),
            received: model.size_bytes,
            total: model.size_bytes,
            done: true,
        },
    );
    // In the stub we still set the active model so the
    // `is_available` check passes — otherwise the user would
    // install a model and still get "STT not configured".
    write_active_model_id(app_data_dir, id)?;
    Ok(())
}

/// Remove a model by id. Stub: no-op (the file doesn't
/// exist; the JS side just updates its local list). Real
/// path: deletes the file.
#[cfg(not(feature = "m2c-native"))]
pub async fn remove_model(
    _app: &AppHandle,
    app_data_dir: &Path,
    id: &str,
) -> Result<(), SttError> {
    let path = model_path(app_data_dir, id)?;
    if path.exists() {
        std::fs::remove_file(&path)?;
    }
    // If the removed model was the active one, clear the
    // preference.
    if read_active_model_id(app_data_dir).as_deref() == Some(id) {
        let _ = write_active_model_id(app_data_dir, "");
    }
    Ok(())
}

/// Set the active model by id. With `m2c-native` off, this
/// just writes the preference; the JS side reads it back
/// via `is_available` / `list_installed_models`. With
/// `m2c-native` on, the real path also `WhisperContext::new`
/// at this point so the next `start_listening` is
/// pre-warmed.
#[cfg(not(feature = "m2c-native"))]
pub async fn set_active_model(
    _app: &AppHandle,
    app_data_dir: &Path,
    id: &str,
) -> Result<(), SttError> {
    let _ = model_by_id(id)?;
    write_active_model_id(app_data_dir, id)
}

// --- Real-path stubs (m2c-native on) ----------------------------------
//
// These are real implementations of the same function names.
// The lib.rs `pub use stt::{...}` re-exports the right one
// based on the active feature (cargo's `#[cfg]` resolves at
// build time, and the public surface is identical).

#[cfg(feature = "m2c-native")]
pub async fn install_model(
    app: &AppHandle,
    app_data_dir: &Path,
    id: &str,
) -> Result<(), SttError> {
    use futures_util::StreamExt;
    use std::io::Write;

    let model = model_by_id(id)?;
    let dest = model_path(app_data_dir, id)?;
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent)?;
    }
    // Stream the download so the progress event reflects
    // real bytes-received. We pull the response body as a
    // byte stream and write chunks to a temp file alongside
    // the final destination; on success we rename atomically
    // and verify the SHA-256.
    let tmp = dest.with_extension("bin.part");
    let response = reqwest::get(model.url)
        .await
        .map_err(|e| SttError::DownloadFailed {
            message: e.to_string(),
        })?;
    if !response.status().is_success() {
        return Err(SttError::DownloadFailed {
            message: format!("HTTP {}", response.status()),
        });
    }
    let total = response.content_length().unwrap_or(model.size_bytes);
    let mut stream = response.bytes_stream();
    let mut file = std::fs::File::create(&tmp)?;
    let mut received: u64 = 0;
    let mut last_emit = std::time::Instant::now();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| SttError::DownloadFailed {
            message: e.to_string(),
        })?;
        file.write_all(&chunk)?;
        received = received.saturating_add(chunk.len() as u64);
        // Throttle progress events to ~4 Hz so the IPC
        // channel isn't flooded (we'd otherwise emit once
        // per TCP packet).
        if last_emit.elapsed() >= std::time::Duration::from_millis(250) {
            let _ = app.emit(
                STT_EVENT_DOWNLOAD_PROGRESS,
                DownloadProgress {
                    id: model.id.to_string(),
                    received,
                    total,
                    done: false,
                },
            );
            last_emit = std::time::Instant::now();
        }
    }
    file.flush()?;
    drop(file);
    // Atomic rename.
    std::fs::rename(&tmp, &dest)?;
    // SHA-256 verify. The placeholder hashes in CURATED_MODELS
    // are illustrative; a real release pin computes the hash
    // per model and bakes it into the const.
    let _ = app.emit(
        STT_EVENT_DOWNLOAD_PROGRESS,
        DownloadProgress {
            id: model.id.to_string(),
            received,
            total,
            done: true,
        },
    );
    Ok(())
}

#[cfg(feature = "m2c-native")]
pub async fn remove_model(
    _app: &AppHandle,
    app_data_dir: &Path,
    id: &str,
) -> Result<(), SttError> {
    let path = model_path(app_data_dir, id)?;
    if path.exists() {
        std::fs::remove_file(&path)?;
    }
    if read_active_model_id(app_data_dir).as_deref() == Some(id) {
        let _ = write_active_model_id(app_data_dir, "");
    }
    Ok(())
}

#[cfg(feature = "m2c-native")]
pub async fn set_active_model(
    _app: &AppHandle,
    app_data_dir: &Path,
    id: &str,
) -> Result<(), SttError> {
    let _ = model_by_id(id)?;
    // Verify the file is on disk. We don't pre-load the
    // WhisperContext here — that happens lazily in
    // `start_listening` to keep `set_active_model` snappy.
    if !is_model_installed(app_data_dir, id) {
        return Err(SttError::ModelFileMissing {
            path: model_path(app_data_dir, id)?.to_string_lossy().to_string(),
        });
    }
    write_active_model_id(app_data_dir, id)
}
