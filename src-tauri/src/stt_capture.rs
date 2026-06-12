//! On-device STT capture + inference (Phase M2c desktop).
//!
//! This module owns the mic + the whisper inference. It is
//! the runtime counterpart to `stt.rs` (which owns the
//! model lifecycle). The split is intentional:
//!
//!   - `stt.rs` is small, easily unit-tested, and doesn't
//!     touch audio hardware. Its public surface is what the
//!     JS settings UI calls (list / install / remove / set
//!     active).
//!   - `stt_capture.rs` is the hard-to-test half. It opens
//!     the mic, fills a buffer, and (in the real build) runs
//!     whisper inference. Unit tests need a real mic + a
//!     real model; in the sandbox we ship a deterministic
//!     stub.
//!
//! ## Audio shape
//!
//! The M2b Wispr path already established the wire format:
//! 16 kHz, mono, 16-bit PCM (delivered to Wispr as base64
//! chunks of 50 ms each). The M2c path uses the same
//! 16 kHz / mono shape but as 32-bit float — whisper.cpp's
//! `full` consumes Float32 directly. The cpal `Stream` is
//! configured for the platform's default sample rate (often
//! 48 kHz) and we resample to 16 kHz on the way into the
//! ring buffer. Resampling is a simple linear interpolation
//! in the stub path; the real path uses `dasp_sample` (a
//! dep whisper-rs already pulls in).
//!
//! ## Cancellation
//!
//! The JS side calls `stt_stop_listening` to end a session.
//! Internally we flip a `CancellationToken`; the cpal
//! stream's `Drop` impl closes the device, and the
//! inference thread observes the flag between buffer
//! snapshots. We do NOT block on the cpal stream — it owns
//! the device handle, we own the buffer.
//!
//! ## Stub vs real
//!
//! With `m2c-native` OFF (the default in the dev / CI /
//! sandbox build), `start_listening` is a no-op that emits
//! a recognisable fake transcript after a short delay. The
//! JS side can't tell the difference at the protocol level.
//! With `m2c-native` ON, the real cpal + whisper path runs.
//!
//! The same `start_listening` / `stop_listening` entry
//! points are exposed in both modes; only the body changes.
//! The function signatures are stable.

use std::path::Path;

use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::stt::{SttError, STT_EVENT_TRANSCRIPT};

#[cfg(feature = "m2c-native")]
use std::sync::{Arc, Mutex};
#[cfg(feature = "m2c-native")]
use tokio_util::sync::CancellationToken;

/// Whisper's expected sample rate. We resample to this in
/// the capture path; the cpal input stream's actual rate
/// (often 48 kHz on macOS, 44.1 kHz on Windows) doesn't
/// matter.
pub const WHISPER_SAMPLE_RATE_HZ: u32 = 16_000;

/// Whisper expects mono Float32 in `[-1.0, 1.0]`. The
/// `samples_per_ms` is a convenient derived constant for
/// callers that want to convert "5 seconds" → "80000
/// samples" without doing the math.
pub const WHISPER_SAMPLES_PER_MS: u32 = WHISPER_SAMPLE_RATE_HZ / 1000;

/// Default cap on a single session's audio length, in
/// milliseconds. 30 s is whisper's recommended ceiling for
/// `full` — longer audio bloats memory linearly and
/// dramatically increases inference latency. The JS
/// settings panel exposes this as a tunable; the
/// `start_listening` command takes an `opts.max_duration_ms`
/// override.
///
/// The const is `pub` so the unit test can sanity-check
/// the buffer math, but it's not part of the public API
/// — the JS side never reads it. The `#[allow(dead_code)]`
/// suppresses the "never used" warning when `m2c-native`
/// is off (the real path is the only consumer).
#[allow(dead_code)]
pub const DEFAULT_MAX_DURATION_MS: u32 = 30_000;

/// Payload of the `stt://transcript` event. Mirrors the
/// `TranscriptionEvent` shape in `src/voice/types.ts` (the
/// `partial` kind is reserved for M2c.b; the M2c desktop
/// path emits exactly one `final` per session).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptEvent {
    /// One of `"partial"` / `"final"`. M2c desktop only
    /// emits `"final"`.
    pub kind: String,
    /// The transcribed text. Empty for the stub on a
    /// cancelled session; non-empty on a successful
    /// inference.
    pub text: String,
    /// Monotonic sequence number within the current
    /// session. Always `0` for M2c desktop (one event per
    /// session); the field exists so M2c.b can emit
    /// multiple events without changing the wire shape.
    pub sequence: u32,
    /// Wall-clock timestamp (ms since epoch) when the
    /// provider emitted this.
    pub timestamp: u64,
    /// `true` for the last event of a session. M2c desktop
    /// always emits `true` (it's always the last event).
    pub is_utterance_end: bool,
    /// Detected language (BCP-47, e.g. "en"). `None` for
    /// English-only models.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub language: Option<String>,
    /// M3: the session id this event belongs to. Mirrors
    /// the optional `sessionId` field on
    /// `TranscriptionEvent` in `src/voice/types.ts`. The
    /// field is `Option` (skip-serialised when `None`) so
    /// pre-M3 desktop stubs don't have to fabricate one —
    /// the M3 on-device factory demuxes by this field when
    /// the iOS / Android plugin ships with concurrent
    /// session support. See HANDOFF Decision #51.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub session_id: Option<String>,
}

// --- Tests -------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn whisper_sample_rate_is_16khz() {
        // Whisper's hard requirement. If we ever change
        // this, the cpal resampler AND the whisper-rs
        // config both need to change in lockstep.
        assert_eq!(WHISPER_SAMPLE_RATE_HZ, 16_000);
    }

    #[test]
    fn samples_per_ms_is_a_clean_integer() {
        // 16 kHz / 1000 = exactly 16 samples per ms. The
        // math has to be clean or the buffer math
        // elsewhere will silently truncate samples.
        assert_eq!(WHISPER_SAMPLES_PER_MS, 16);
    }

    #[test]
    fn default_max_duration_yields_a_manageable_buffer() {
        // 30 s × 16 kHz × 4 bytes (f32) = ~1.9 MB. That
        // fits comfortably in the Rust heap and the
        // whisper-rs context. If this number grows, the
        // inference latency grows linearly.
        let max_samples = (DEFAULT_MAX_DURATION_MS as usize) * (WHISPER_SAMPLES_PER_MS as usize);
        let buffer_bytes = max_samples * std::mem::size_of::<f32>();
        assert!(buffer_bytes < 4 * 1024 * 1024, "buffer should be < 4 MB");
    }

    #[test]
    fn transcript_event_serializes_with_camel_case_keys() {
        // The JS side reads `event.kind`, `event.text`,
        // etc. — those are the camelCase wire keys. We
        // assert them explicitly so a rename doesn't
        // silently break the protocol.
        let event = TranscriptEvent {
            kind: "final".to_string(),
            text: "hello".to_string(),
            sequence: 0,
            timestamp: 1_700_000_000_000,
            is_utterance_end: true,
            language: Some("en".to_string()),
            session_id: Some("stt_abcdef".to_string()),
        };
        let json = serde_json::to_string(&event).unwrap();
        assert!(json.contains("\"kind\":\"final\""));
        assert!(json.contains("\"text\":\"hello\""));
        assert!(json.contains("\"sequence\":0"));
        assert!(json.contains("\"timestamp\":1700000000000"));
        assert!(json.contains("\"isUtteranceEnd\":true"));
        assert!(json.contains("\"language\":\"en\""));
        // M3: the new `sessionId` field is in the
        // output (the iOS / Android plugin contract
        // depends on it).
        assert!(json.contains("\"sessionId\":\"stt_abcdef\""));
    }

    #[test]
    fn transcript_event_omits_language_when_none() {
        // English-only models don't set a language; the
        // field should be absent from the JSON, not
        // serialized as `"language": null`.
        let event = TranscriptEvent {
            kind: "final".to_string(),
            text: "x".to_string(),
            sequence: 0,
            timestamp: 0,
            is_utterance_end: true,
            language: None,
            session_id: None,
        };
        let json = serde_json::to_string(&event).unwrap();
        assert!(!json.contains("language"));
        // M3: the `sessionId` field is also optional
        // and must be omitted from the JSON when
        // `None` (per Decision #2 the desktop stub
        // doesn't have to fabricate one).
        assert!(!json.contains("sessionId"));
    }
}

// --- Real-path stubs (m2c-native on) -----------------------------------

/// Start a new STT session. Returns the `sessionId` (a
/// short random hex string) so the JS side can demux
/// events from concurrent sessions (defensive — the M2c
/// desktop MVP only supports one session at a time, but
/// the wire shape leaves room for parallelism later).
///
/// In stub mode: returns a placeholder id and schedules a
/// fake transcript event 200 ms later (matching the M2a
/// stub's deliberate latency, so the user can see the
/// `transcribing` state transition).
///
/// In real mode: opens the cpal stream, starts filling
/// the buffer, and (in the real implementation) spawns a
/// task that calls whisper's `full` on the buffer when
/// `stop_listening` is called.
#[cfg(not(feature = "m2c-native"))]
pub async fn start_listening(
    app: AppHandle,
    _app_data_dir: &Path,
    _opts: ListenOptions,
) -> Result<String, SttError> {
    let session_id = format!("stt_{}", random_hex_short());
    // Stub: emit a fake transcript 200 ms after start.
    // The user sees the same `transcribing` → `transcript`
    // transition as the Wispr path. The text is
    // recognisable so they can tell at a glance that the
    // stub provider is in use.
    let app_for_task = app.clone();
    let session_id_for_task = session_id.clone();
    tokio::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
        let event = TranscriptEvent {
            kind: "final".to_string(),
            text: format!(
                "voice transcript (on-device STT, stub mode — switch the Rust build to m2c-native for real whisper inference)"
            ),
            sequence: 0,
            timestamp: now_ms(),
            is_utterance_end: true,
            language: None,
            // M3: the desktop stub DOES set `session_id`
            // (we just generated it; it costs nothing to
            // thread through). The M3 JS factory demuxes
            // by it. Pre-M3 callers that read the JSON
            // just ignore the new field.
            session_id: Some(session_id_for_task.clone()),
        };
        let _ = app_for_task.emit(STT_EVENT_TRANSCRIPT, &event);
    });
    Ok(session_id)
}

/// Stop the current STT session. With the stub, this is a
/// no-op (the 200 ms delayed transcript will still fire
/// once — that's intentional, so the user sees the full
/// transition). The JS side ignores late transcripts that
/// arrive after `stop_listening` was called; the hook's
/// `useVoiceStore` will overwrite the placeholder.
#[cfg(not(feature = "m2c-native"))]
pub async fn stop_listening(
    _app: &AppHandle,
    _session_id: &str,
) -> Result<(), SttError> {
    Ok(())
}

// --- Real-path stubs (m2c-native on) -----------------------------------

/// Per-session options. The `max_duration_ms` override is
/// exposed for the future "long dictation" mode; the M2c
/// desktop MVP uses the `DEFAULT_MAX_DURATION_MS`
/// constant.
#[derive(Debug, Clone, Default)]
pub struct ListenOptions {
    /// BCP-47 language tag, e.g. `"en"`. `None` = let
    /// whisper auto-detect (works on multilingual models
    /// only).
    pub language: Option<String>,
    /// Hard cap on the session's audio length. The
    /// `stop_listening` is auto-fired when this is reached.
    pub max_duration_ms: Option<u32>,
}

/// The shared state for a single live session. The cpal
/// stream writes into `buffer`; the inference task reads
/// from it on `stop_listening`. We use a `Mutex<Vec<f32>>`
/// rather than a ring buffer because the audio is short
/// (≤30 s) and the lock contention is one writer + one
/// reader — a ring buffer's complexity isn't justified.
#[cfg(feature = "m2c-native")]
struct LiveSession {
    session_id: String,
    buffer: Arc<Mutex<Vec<f32>>>,
    cancel: CancellationToken,
}

#[cfg(feature = "m2c-native")]
impl LiveSession {
    fn new(session_id: String) -> Self {
        Self {
            session_id,
            buffer: Arc::new(Mutex::new(Vec::with_capacity(
                (WHISPER_SAMPLE_RATE_HZ as usize)
                    * (DEFAULT_MAX_DURATION_MS as usize)
                    / 1000,
            ))),
            cancel: CancellationToken::new(),
        }
    }
}

#[cfg(feature = "m2c-native")]
use std::collections::HashMap;

/// Process-wide registry of live sessions, keyed by
/// `sessionId`. The `start_listening` command inserts;
/// `stop_listening` removes after running inference. We
/// keep this in `lib.rs` via `.manage(Arc<Mutex<HashMap<…>>>)`
/// — see the wiring TODO in `lib.rs`.
#[cfg(feature = "m2c-native")]
pub type SessionRegistry = Arc<Mutex<HashMap<String, LiveSession>>>;

#[cfg(feature = "m2c-native")]
pub async fn start_listening(
    _app: AppHandle,
    _app_data_dir: &Path,
    _opts: ListenOptions,
) -> Result<String, SttError> {
    // Real path: cpal host open → input stream → 16 kHz
    // mono f32 buffer. The buffer is owned by the session
    // in the registry; the cpal stream holds an
    // `Arc<Mutex<Vec<f32>>>` clone and appends to it
    // on every audio callback.
    //
    // The real cpal + cpal-to-16kHz resample code is ~80
    // LoC. It is omitted from this session's first
    // because: (a) it needs `m2c-native` to be on (which
    // requires a real `libclang.dll`); (b) the unit tests
    // for it would need a virtual audio device that we
    // can't fabricate in the sandbox. The first ship of
    // M2c desktop captures the protocol, the JS plumbing,
    // the Settings UI, and the model lifecycle (all
    // stub-mode). The cpal integration is a one-day
    // follow-up on a real machine.
    //
    // See HANDOFF §9.7 for the follow-up tasks.
    let session_id = format!("stt_{}", random_hex_short());
    Ok(session_id)
}

#[cfg(feature = "m2c-native")]
pub async fn stop_listening(
    _app: &AppHandle,
    _session_id: &str,
) -> Result<(), SttError> {
    // Real path: flip the session's CancellationToken,
    // wait for the cpal stream to drop (releases the
    // device), pull the buffer out of the registry, run
    // whisper's `full`, emit the `stt://transcript`
    // event, remove the session from the registry.
    Ok(())
}

// --- shared helpers ----------------------------------------------------

/// Generate a short hex string. Used for the `sessionId`.
/// We don't need cryptographic strength here — a session
/// id just needs to be unique within a process lifetime.
fn random_hex_short() -> String {
    use std::fmt::Write;
    let mut bytes = [0u8; 8];
    if getrandom::getrandom(&mut bytes).is_err() {
        // Counter fallback. Same rationale as the chat
        // request-id generator in `lib.rs`.
        for (i, b) in bytes.iter_mut().enumerate() {
            *b = i as u8;
        }
    }
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        let _ = write!(s, "{b:02x}");
    }
    s
}

/// Wall-clock ms since the Unix epoch. We could use
/// `std::time::SystemTime`, but a tokio-internal helper
/// would be preferable for testability. The plain SystemTime
/// call is fine here — the test doesn't depend on it.
fn now_ms() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}
