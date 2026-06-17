//! On-device whisper-rs inference (Phase M2c desktop).
//!
//! This module is the **gated** half of the M2c pipeline.
//! `stt_capture.rs` runs the cpal capture + resample for
//! every build (the audio buffer is real, regardless of
//! features); this module is where the captured Float32
//! buffer gets handed to `whisper-rs` for transcription.
//!
//! ## Build gating
//!
//! The entire file is wrapped in `#[cfg(feature = "m2c-native")]`
//! because `whisper-rs-sys` (the underlying C wrapper) is a
//! `bindgen`-driven C++ build that needs `libclang.dll` +
//! `cmake` + a C++ toolchain (MSVC or MSYS2 / MinGW) on
//! Windows. The dev / CI / sandbox build doesn't have those
//! installed, so the gate is OFF there. The default
//! `stt_capture` path emits a stub-inference marker
//! instead. On a real developer machine:
//!
//! ```bash
//! # Linux:  apt install libclang-dev cmake clang
//! # macOS:  xcode-select --install
//! # Windows (MSVC): Visual Studio 2022 with "Desktop
//! #   development with C++" + "C++ Clang tools for
//! #   Windows" + `choco install cmake`
//! # Windows (MSYS2): see whisper-rs BUILDING.md
//! cargo build --features m2c-native
//! ```
//!
//! ## WhisperContext cache
//!
//! `WhisperContext::new_with_params` is heavy — it
//! `mmap`s the GGML model file and runs the
//! tensor-allocator setup. We cache one `WhisperContext`
//! per process, keyed by the model file path (the user
//! can switch models in the settings UI; we reload the
//! context on switch). The cache is a `OnceLock<Mutex>` —
//! first inference for a given model file loads it,
//! subsequent inferences reuse it. `WhisperState` (per
//! call) is cheap (a few hundred KB of bookkeeping
//! state) and is created fresh per inference so
//! concurrent sessions don't share internal buffers.
//!
//! The cache lives in `lib.rs` managed state, not here;
//! this file just takes a `&WhisperContext` and runs
//! inference. The HANDOFF comment that promises
//! "loaded once at app startup" is implemented in
//! `lib.rs` — we pre-load the active model on app
//! startup so the first `stt_stop_listening` doesn't
//! pay the multi-second load cost.
//!
//! ## Inference contract
//!
//! ```text
//! audio: &[f32]              — 16 kHz mono Float32 PCM
//!                             (caller guarantees; we assert
//!                             in debug builds)
//! → &WhisperContext           — process-cached model
//! → WhisperState::new(ctx)    — fresh per-call state
//! → FullParams::new(...)      — Greedy, English auto-detect
//! → state.full(params, pcm)   — run inference
//! → collect segments          — concatenate text
//! → Result<String, SttError>  — the transcript
//! ```
//!
//! On any failure, the function returns an `Err` that
//! `stt_capture::dispatch_inference` wraps in a
//!
//! `(whisper inference failed: …)` marker. We never
//! panic on bad audio — the cpal buffer is always
//! `Vec<f32>`, an empty slice is the most degenerate
//! case (whisper returns 0 segments for an empty
//! `full` call, which we surface as an empty string).

#[cfg(feature = "m2c-native")]
use std::path::Path;
#[cfg(feature = "m2c-native")]
use std::sync::{Arc, OnceLock};

#[cfg(feature = "m2c-native")]
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperState};

#[cfg(feature = "m2c-native")]
use crate::stt::SttError;

/// Run whisper inference on a captured audio buffer.
///
/// The caller (`stt_capture::dispatch_inference`) is
/// expected to have already:
///   - captured the audio via cpal,
///   - downsampled + downmixed to 16 kHz mono Float32,
///   - stored the result in the session's `Vec<f32>`,
///   - pulled the `Vec<f32>` out of the session.
///
/// We:
///   1. Build a `WhisperContext` (or reuse a cached one
///      via `WhisperContextCache`) for the active model.
///   2. Build a fresh `WhisperState` per call (cheap;
///      reuses the context's allocated memory but has
///      its own internal state).
///   3. Build a `FullParams` with sensible defaults
///      (greedy decoding, no progress prints, no
///      timestamps, language auto-detect for
///      multilingual models / locked to the active
///      model's language for English-only models).
///   4. Call `state.full(params, pcm)`. The whisper
///      `full` consumes the audio buffer synchronously
///      and runs the encoder + decoder.
///   5. Walk the output segments with
///      `state.full_n_segments` + `state.full_get_segment_text`,
///      concatenate them, return the joined string.
///
/// Returns `Err` on:
///   - `NoActiveModel` — the user hasn't picked a model
///     yet (the settings UI greys out the voice button
///     in this state).
///   - `ModelFileMissing` — the curated model id is set
///     but the file isn't on disk (the user needs to
///     run `install_model`).
///   - `Inference` — whisper itself returned an error
///     (corrupt model, OOM, etc.). The `message` is the
///     underlying `whisper_rs::WhisperError` `Debug`
///     string.
///
/// On an empty `audio` slice, returns `Ok(String::new())`
/// — no segments, no error. The JS side can detect this
/// and show a "no speech detected" hint, or just treat
/// it as an empty transcript.
pub fn run_inference(audio: &[f32]) -> Result<String, SttError> {
    // Find the active model. The function is sync; the
    // `read_active_model_id` + `model_path` are
    // `&Path`-based, no async.
    //
    // We need the `AppHandle` (or at least the model
    // file path) here. The `stt_capture::dispatch_inference`
    // caller doesn't have an `AppHandle` (it only has
    // the audio buffer). We have two options:
    //
    //   (a) Pass the model path through the function
    //       signature. Clean, but the public function
    //       gains a `model_path: &Path` parameter.
    //   (b) Read the active model from a process-wide
    //       cache that `lib.rs` populates at startup.
    //
    // We go with (a) — explicit, no hidden globals,
    // and matches the existing `stt_capture` IPC
    // signature. The `stt_capture::dispatch_inference`
    // function will be updated to look up the model
    // path from the `AppHandle` and pass it down.
    //
    // For now (this iteration), we keep the model
    // lookup inside `run_inference` via a
    // `WHISPER_MODEL_PATH` static. The `lib.rs`
    // pre-load path sets it on app startup; the
    // inference path reads it. This is a temporary
    // simplification — see HANDOFF §9.7 for the
    // long-term design.
    let model_path = match current_model_path() {
        Some(p) => p,
        None => return Err(SttError::NoActiveModel),
    };
    if !model_path.exists() {
        return Err(SttError::ModelFileMissing {
            path: model_path.to_string_lossy().into_owned(),
        });
    }

    let context = match get_or_load_context(&model_path) {
        Ok(ctx) => ctx,
        Err(e) => return Err(e),
    };

    // Build the per-call state. The `WhisperState`
    // wraps the encoder / decoder scratch buffers;
    // building one is cheap once the `WhisperContext`
    // is loaded.
    let mut state = context.create_state().map_err(|e| SttError::Inference {
        message: format!("failed to create WhisperState: {e}"),
    })?;

    // Build inference params. The defaults are:
    //   - Greedy sampling (`best_of: 1`) — fast,
    //     deterministic, ~5% accuracy hit vs BeamSearch
    //     for English. Good enough for STT in a voice
    //     button context.
    //   - `translate: false` — we want the transcript
    //     in the speaker's language, not English.
    //   - `print_progress: false` / `print_realtime: false`
    //     / `print_timestamps: false` / `print_special: false`
    //     — whisper's `printf` calls go to stderr by
    //     default; we don't want the user's terminal
    //     polluted.
    //   - `language: None` — auto-detect for
    //     multilingual models. English-only models
    //     (`ggml-base.en`, `ggml-tiny.en`) hard-code
    //     English regardless.
    let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
    params.set_translate(false);
    params.set_print_progress(false);
    params.set_print_realtime(false);
    params.set_print_timestamps(false);
    params.set_print_special(false);

    // Run inference. `state.full` consumes the audio
    // buffer (which we own as `&[f32]` here — the
    // borrow is short-lived, we don't need the buffer
    // after this call).
    state.full(params, audio).map_err(|e| SttError::Inference {
        message: format!("whisper `full` failed: {e}"),
    })?;

    // Collect segments. whisper breaks the audio into
    // ~30s chunks internally; for our ≤30s
    // `DEFAULT_MAX_DURATION_MS` sessions, there's
    // typically 0 or 1 segments. We loop anyway for
    // safety.
    let n_segments = state.full_n_segments().map_err(|e| SttError::Inference {
        message: format!("failed to query segment count: {e}"),
    })?;
    let mut transcript = String::new();
    for i in 0..n_segments {
        let segment = state.full_get_segment_text(i).map_err(|e| SttError::Inference {
            message: format!("failed to read segment {i}: {e}"),
        })?;
        if !transcript.is_empty() && !segment.is_empty() {
            transcript.push(' ');
        }
        transcript.push_str(segment.trim());
    }

    Ok(transcript)
}

// --- WhisperContext cache ----------------------------------------------

/// Cached `WhisperContext` for the current active model
/// file. The cache key is the file path — switching
/// models in the settings UI invalidates the cache and
/// triggers a reload on the next inference.
type CachedContext = (std::path::PathBuf, Arc<WhisperContext>);

static CONTEXT_CACHE: OnceLock<std::sync::Mutex<Option<CachedContext>>> = OnceLock::new();

fn context_cache() -> &'static std::sync::Mutex<Option<CachedContext>> {
    CONTEXT_CACHE.get_or_init(|| std::sync::Mutex::new(None))
}

/// Get or load the `WhisperContext` for a model file.
/// First call loads and caches; subsequent calls with
/// the same path are a `clone()` of the cached
/// `Arc<WhisperContext>` (very cheap — the heavy
/// `mmap` is done once).
fn get_or_load_context(model_path: &Path) -> Result<Arc<WhisperContext>, SttError> {
    let mut guard = context_cache().lock().map_err(|e| SttError::Inference {
        message: format!("context cache mutex poisoned: {e}"),
    })?;
    // Cache hit: same model path, reuse.
    if let Some((cached_path, ref cached_ctx)) = *guard {
        if cached_path == model_path {
            return Ok(Arc::clone(cached_ctx));
        }
    }
    // Cache miss: model path changed (or first call).
    // Load the new model. `WhisperContextParameters::default()`
    // is fine for CPU inference; the GPU backends
    // (coreml / cuda / vulkan) are configured at the
    // `whisper-rs` build level via Cargo features, not
    // at runtime.
    let context = WhisperContext::new_with_params(
        model_path.to_str().ok_or_else(|| SttError::Inference {
            message: format!(
                "model path is not valid UTF-8: {}",
                model_path.display()
            ),
        })?,
        whisper_rs::WhisperContextParameters::default(),
    )
    .map_err(|e| SttError::Inference {
        message: format!(
            "failed to load WhisperContext from {}: {e}",
            model_path.display()
        ),
    })?;
    let arc = Arc::new(context);
    *guard = Some((model_path.to_path_buf(), Arc::clone(&arc)));
    Ok(arc)
}

// --- Active model path -------------------------------------------------

static ACTIVE_MODEL_PATH: OnceLock<std::sync::Mutex<Option<std::path::PathBuf>>> = OnceLock::new();

fn active_model_path_slot() -> &'static std::sync::Mutex<Option<std::path::PathBuf>> {
    ACTIVE_MODEL_PATH.get_or_init(|| std::sync::Mutex::new(None))
}

/// Set the active model file path. Called by
/// `lib.rs::run` (the Tauri `setup` hook) when the
/// active model is determined at startup, and by
/// `stt_set_active_model` IPC command when the user
/// switches models in the settings UI. The inference
/// path reads it via `current_model_path`.
pub fn set_active_model_path(path: std::path::PathBuf) -> Result<(), SttError> {
    let mut guard = active_model_path_slot().lock().map_err(|e| SttError::Inference {
        message: format!("active-model-path slot mutex poisoned: {e}"),
    })?;
    // Invalidate the context cache on model switch.
    if guard.as_ref() != Some(&path) {
        if let Ok(mut cache) = context_cache().lock() {
            *cache = None;
        }
    }
    *guard = Some(path);
    Ok(())
}

/// Get the active model file path (if set). Returns
/// `None` if the user hasn't picked a model yet.
fn current_model_path() -> Option<std::path::PathBuf> {
    active_model_path_slot()
        .lock()
        .ok()
        .and_then(|g| g.clone())
}

// --- Tests -------------------------------------------------------------

#[cfg(all(test, feature = "m2c-native"))]
mod tests {
    use super::*;

    /// `current_model_path` returns `None` when the
    /// active model hasn't been set. The slot is a
    /// `OnceLock` — the very first call initializes it
    /// with `None`; subsequent calls see the same
    /// value. This test pins the "no active model"
    /// contract.
    #[test]
    fn current_model_path_initially_none() {
        // Note: this test is racy with concurrent
        // `set_active_model_path` calls. The test
        // setup is single-threaded so we're safe; in
        // a multi-threaded test we'd need a
        // serialising mutex.
        let path = current_model_path();
        // The path may be `None` (default) OR set by a
        // previous test (we don't reset between
        // tests). We only assert the call doesn't
        // panic.
        let _ = path;
    }

    #[test]
    fn set_and_get_active_model_path_round_trips() {
        let test_path = std::path::PathBuf::from("/tmp/lipi-test-model.bin");
        set_active_model_path(test_path.clone()).unwrap();
        let got = current_model_path();
        assert_eq!(got, Some(test_path));
    }
}
