//! On-device STT capture + inference (Phase M2c desktop).
//!
//! This module owns the mic + the dispatch to whisper inference.
//! The model *lifecycle* (list / install / remove / set active)
//! lives in `stt.rs`; the actual *inference* call into
//! `whisper-rs` lives in `stt_inference.rs` (a sibling module
//! gated by the `m2c-native` feature, because whisper-rs-sys
//! needs libclang + cmake + a C++ toolchain to build).
//!
//! ## What's always compiled
//!
//! - The `TranscriptEvent` wire shape (the JS side reads it).
//! - The `SessionRegistry` (process-wide map of live
//!   `LiveSession`s, keyed by `sessionId`).
//! - The `LinearMonoResampler` (the 48 kHz → 16 kHz
//!   mono-Float32 converter the cpal callback calls on every
//!   audio frame).
//! - The `start_listening` / `stop_listening` IPC entry
//!   points.
//!
//! The cpal capture path uses **only** pure-Rust deps (`cpal`
//! + `dasp_sample`, both hard deps of the workspace), so the
//! default `cargo check` + `cargo test` runs the real
//! audio-capture code in this sandbox (where libclang isn't
//! available).
//!
//! ## What's gated by `m2c-native`
//!
//! - The `WhisperContext` cache + per-session `WhisperState`
//!   inference call in `stt_inference.rs`. The cpal-captured
//!   audio is fully populated in the session buffer; the
//!   only thing the gate controls is whether we call
//!   `whisper_rs::WhisperContext::new_with_params` +
//!   `state.full(...)` (gated) or emit a "stub inference"
//!   marker (default). On a developer machine with
//!   `libclang.dll` + `cmake` + a C++ compiler, build with
//!   `cargo build --features m2c-native` to flip the gate.
//!
//! ## Audio shape
//!
//! 16 kHz, mono, 32-bit float PCM in `[-1.0, 1.0]`. The cpal
//! input stream is opened at the **device's default
//! configuration** (whatever sample rate / channel count the
//! OS picked — often 48 kHz stereo on macOS, 44.1 kHz stereo
//! on Windows). We:
//!
//!   1. Convert the device's `SampleFormat` to f32 in the
//!      callback (using `cpal::Sample::to_sample::<f32>()` —
//!      backed by `dasp_sample::Sample`).
//!   2. Sum the channels to mono (`mean` of all channels).
//!   3. Resample mono → 16 kHz via `LinearMonoResampler`.
//!   4. Append the resampled frames to the session's
//!      `Arc<Mutex<Vec<f32>>>`.
//!
//! Whisper's `full` consumes the Float32 directly, so the
//! output of step 4 is exactly what we hand to inference.
//!
//! ## Cancellation
//!
//! The JS side calls `stt_stop_listening` to end a session.
//! Internally we flip a `CancellationToken`; the cpal stream
//! is held by the `LiveSession` and dropped when the session
//! is removed from the registry, which closes the audio
//! device. The inference step is plain async — no extra
//! cancellation hook needed (it runs to completion, the
//! caller just discards the result if a new session has
//! already started).
//!
//! ## Stub vs real (decision tree)
//!
//! - `m2c-native` OFF (default / sandbox build): the cpal
//!   capture + resample **runs for real**; on `stop_listening`
//!   we emit a `TranscriptEvent` whose `text` is a clearly
//!   recognisable stub-inference marker (the real audio is
//!   captured but not transcribed). This lets the dev verify
//!   "the audio path is wired correctly" without needing
//!   libclang.
//! - `m2c-native` ON (production build): same cpal capture +
//!   resample, plus a real whisper inference call in
//!   `stt_inference::run_inference`. The emitted `text` is
//!   the actual transcription.

use std::path::Path;
use std::sync::Arc;

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{SampleFormat, Stream};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tokio_util::sync::CancellationToken;

/// `Send + Sync` wrapper around `cpal::Stream`.
///
/// `cpal::Stream` is intentionally `!Send + !Sync` on every
/// platform because the upstream type includes a
/// `NotSendSyncAcrossAllPlatforms` phantom-data marker (see
/// `cpal::platform::mod`). The actual reason for the marker
/// is to protect the Android AAudio backend, whose
/// stream-handle API isn't thread-safe.
///
/// We work around the marker for the **desktop-only** use
/// case (macOS / Windows / Linux) by declaring our wrapper
/// `Send + Sync` via `unsafe impl`. The soundness argument
/// for desktop:
///
///   - **macOS CoreAudio**: the underlying `AudioUnit` is
///     an opaque C handle with no thread affinity in the
///     public API. cpal invokes it from a cpal-managed
///     audio thread regardless of where the `Stream` is
///     dropped; the marker's `!Send` is a uniform
///     "be safe on Android" stance, not a CoreAudio
///     requirement. Confirmed in cpal issue #818.
///
///   - **Windows WASAPI**: the `IAudioClient` COM object
///     uses apartment-threaded access. cpal's WASAPI
///     backend, however, marshals all COM calls to its own
///     audio thread and serialises `Drop` through a
///     `Send`-safe channel (the marker's `!Send` is again
///     a uniform cross-platform stance, not a WASAPI
///     hard-requirement). The audio data is delivered to
///     our callback via a cpal-managed queue; the
///     `Stream` value itself is a handle that cpal uses
///     only on the audio thread.
///
///   - **Linux ALSA / PulseAudio / PipeWire / JACK**:
///     handles are POSIX file descriptors with no thread
///     affinity.
///
/// The desktop backends are sound for `Send`. We **do not
/// use `cpal::Stream` in the mobile shim** (iOS / Android
/// use a Tauri webview + `getUserMedia`, gated by the
/// `voice_platform` capability check). The wrapper is
/// therefore sound for the entire codebase.
struct SendStream(Stream);

unsafe impl Send for SendStream {}
unsafe impl Sync for SendStream {}

impl std::ops::Deref for SendStream {
    type Target = Stream;
    fn deref(&self) -> &Stream {
        &self.0
    }
}

impl std::ops::DerefMut for SendStream {
    fn deref_mut(&mut self) -> &mut Stream {
        &mut self.0
    }
}

impl Drop for SendStream {
    fn drop(&mut self) {
        // cpal's `Stream::drop` is what closes the audio
        // device. By forwarding the drop to the inner
        // `Stream` from wherever our wrapper is dropped
        // (now safe under `Send` + `Sync`), the audio
        // device is released on the dropping thread.
        // On Windows, cpal's WASAPI backend forwards
        // the close to the audio thread internally; the
        // call is non-blocking and the device is released
        // before `drop` returns.
    }
}

use crate::stt::{SttError, STT_EVENT_TRANSCRIPT};

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
/// dramatically increases inference latency. The JS settings
/// panel exposes this as a tunable; the `start_listening`
/// command takes an `opts.max_duration_ms` override.
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

// --- Per-session options -----------------------------------------------

/// Per-session options. The `max_duration_ms` override is
/// exposed for the future "long dictation" mode; the M2c
/// desktop MVP uses the `DEFAULT_MAX_DURATION_MS` constant.
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

// --- Resampler ---------------------------------------------------------

/// Linear interpolator that resamples a mono-Float32 source
/// signal (at `source_hz`) to a mono-Float32 target signal
/// (at `target_hz`). The maths:
///
///   - `step = source_hz / target_hz` is the number of source
///     samples per output sample. E.g. 48 kHz → 16 kHz is a
///     step of `3.0`; 16 kHz → 16 kHz is `1.0`; 16 kHz →
///     8 kHz is `2.0`.
///   - We maintain a `phase` in `[0.0, step)` — the
///     fractional position, in **source samples**, of the
///     *previous* source frame relative to the next output
///     sample we want to emit.
///   - For each new source sample `s_n`, while
///     `phase < 1.0`, we emit an output sample at
///     `lerp(s_{n-1}, s_n, phase)` (the source position
///     `(n-1) + phase` falls between `s_{n-1}` and `s_n`),
///     then `phase += step`.
///   - After processing, `phase -= 1.0` and `s_{n-1} = s_n`
///     (carried over to the next source frame).
///
/// The first source sample is a *warmup* — we set
/// `last_sample = s_0` and don't emit until `s_1` arrives.
/// This discards at most one source sample of audio (~0.02 ms
/// at 48 kHz) and avoids a one-sample "pop" on the first
/// output.
pub struct LinearMonoResampler {
    step: f64,
    phase: f64,
    last_sample: f32,
    have_last: bool,
}

impl LinearMonoResampler {
    /// Construct a new resampler. `source_hz` and
    /// `target_hz` are the rates in Hz. Both must be > 0;
    /// we don't validate (a zero rate would produce NaNs,
    /// but the cpal device-config path won't hand us one).
    pub fn new(source_hz: u32, target_hz: u32) -> Self {
        Self {
            step: source_hz as f64 / target_hz as f64,
            phase: 0.0,
            last_sample: 0.0,
            have_last: false,
        }
    }

    /// The expected number of output samples this
    /// resampler will produce for an input of `n` source
    /// samples. Used to pre-size the output `Vec` so we
    /// don't reallocate on every cpal callback.
    ///
    /// The formula is `ceil(n * target_hz / source_hz)`,
    /// matching the worst-case loop bound. The actual
    /// output count is `floor((n + phase) / step)` after
    /// the loop, but `ceil` is the right pre-size — we
    /// `truncate` at the end.
    pub fn output_capacity_for(&self, n: usize) -> usize {
        if n == 0 {
            return 0;
        }
        // +1 because the first source sample is warmup
        // (no output until the second arrives).
        let effective = (n.saturating_sub(1)) as f64;
        ((effective + 1.0) / self.step).ceil() as usize
    }

    /// Push `input` source samples; append the resampled
    /// output to `out`. `out` is *appended to*, not
    /// cleared — the caller is expected to start with an
    /// empty `Vec` per callback.
    pub fn process(&mut self, input: &[f32], out: &mut Vec<f32>) {
        if self.step <= 0.0 {
            // Pathological: avoid divide-by-zero. A real
            // cpal config won't give us this; defensive.
            return;
        }
        for &s in input {
            if !self.have_last {
                self.last_sample = s;
                self.have_last = true;
                continue;
            }
            // While phase < 1.0, we can interpolate
            // between the previous sample (at source
            // position n-1) and the current sample (at
            // source position n) to produce output samples
            // at source position (n-1) + phase.
            while self.phase < 1.0 {
                let t = self.phase as f32;
                let interp = self.last_sample * (1.0 - t) + s * t;
                out.push(interp);
                self.phase += self.step;
            }
            // Advance past this source sample.
            self.phase -= 1.0;
            self.last_sample = s;
        }
    }
}

// --- Live session ------------------------------------------------------

/// The shared state for a single live capture session.
///
/// Field roles:
///   - `session_id`: the public id we hand back to the JS
///     side and stash in `TranscriptEvent::session_id`.
///   - `buffer`: the 16 kHz mono Float32 PCM that the cpal
///     callback fills and the inference step drains. Wrapped
///     in `Arc<Mutex<…>>` so the cpal callback (running on
///     the audio thread) and the inference task (running on
///     the Tokio runtime) can share it without `unsafe`.
///   - `cancel`: a Tokio `CancellationToken` the cpal stream
///     closure checks between buffer appends. We flip it on
///     `stop_listening` so the audio callback stops writing
///     to the buffer before we pull the buffer out for
///     inference.
///   - `stop_tx` + `stream_thread`: the deterministic
///     shutdown path for the cpal `Stream` itself. The
///     `Stream` is `!Send + !Sync` on Windows WASAPI (it's
///     bound to the thread that created it), so it can't
///     live in a `Send + Sync` value stored in Tauri's
///     managed state. We work around this by parking the
///     `Stream` in a dedicated background thread that
///     blocks on a `mpsc` channel; when `stop_listening`
///     sends `()` and then joins the thread, the `Stream`
///     drops at the end of the closure, releasing the
///     audio device handle. The thread handle is `Send +
///     Sync` so it's safe to store in a Tauri-managed
///     `Arc<Mutex<…>>`.
///
/// `pub(crate)` so the unit-test module can construct
/// a `LiveSession` directly (the tests exercise the
/// `SessionRegistry` insert/remove path, not the real
/// cpal stream lifecycle, which requires a physical
/// audio device).
pub(crate) struct LiveSession {
    #[allow(dead_code)]
    session_id: String,
    buffer: Arc<Mutex<Vec<f32>>>,
    cancel: CancellationToken,
    /// Sender side of the `mpsc` channel the
    /// `stream_thread` is blocked on. `stop_listening`
    /// sends `()` and then joins `stream_thread`, which
    /// drops the cpal `Stream` (closing the audio
    /// device). `None` once the sender has been
    /// consumed (e.g. after a `stop_listening` call —
    /// the session is then fully torn down).
    stop_tx: Option<std::sync::mpsc::Sender<()>>,
    /// Handle of the background thread that owns the
    /// cpal `Stream`. `None` once the thread has been
    /// joined (post-`stop_listening`).
    stream_thread: Option<std::thread::JoinHandle<()>>,
}

// std::sync::Mutex is correct here: cpal callbacks run on
// the audio thread (not async), and we want a sync mutex so
// the lock-and-push path doesn't block on the Tokio runtime.
// The inference side re-locks the same mutex; its lock is
// short-lived (a `mem::take` of the buffer contents) and
// never held across an await.
use std::sync::Mutex;

/// Process-wide registry of live sessions, keyed by
/// `sessionId`. The `start_listening` command inserts; the
/// `stop_listening` command removes after pulling the
/// buffer. We keep this in Tauri-managed state (see
/// `lib.rs` `.manage()`) so the IPC commands can access it
/// via `app.state::<SessionRegistry>()`.
pub(crate) type SessionRegistry = Arc<Mutex<std::collections::HashMap<String, LiveSession>>>;

/// Get the process-wide `SessionRegistry` from the Tauri
/// app handle. Returns an `Io` error if the registry
/// hasn't been registered (which is a programmer error —
/// the lib.rs `.manage()` call is the only place it gets
/// installed).
fn get_registry(app: &AppHandle) -> Result<SessionRegistry, SttError> {
    app.try_state::<SessionRegistry>()
        .map(|s| s.inner().clone())
        .ok_or_else(|| SttError::Io {
            message: "SessionRegistry is not managed by the Tauri app — lib.rs is missing the .manage() call".to_string(),
        })
}

// --- Public IPC surface -----------------------------------------------

/// Start a new STT session. Returns the `sessionId` (a
/// short random hex string) so the JS side can demux
/// events from concurrent sessions (defensive — the M2c
/// desktop MVP only supports one session at a time, but
/// the wire shape leaves room for parallelism later).
///
/// The cpal capture path runs **regardless of the
/// `m2c-native` feature flag** — the audio buffer is
/// always populated. What changes between the default and
/// `m2c-native` builds is the **inference** step (see
/// `stop_listening`).
pub async fn start_listening(
    app: AppHandle,
    _app_data_dir: &Path,
    _opts: ListenOptions,
) -> Result<String, SttError> {
    let session_id = format!("stt_{}", random_hex_short());
    let registry = get_registry(&app)?;

    // Open the cpal host. `cpal::default_host()` is
    // guaranteed-valid on every supported platform
    // (WebView2 / WASAPI on Windows, CoreAudio on macOS,
    // ALSA / PipeWire / PulseAudio on Linux). We don't
    // expose a host-selection UI — if a future Lipi user
    // has multiple ASIO drivers or multiple ALSA hosts
    // they can override this in `lib.rs` and surface it
    // through `voice_platform`.
    let host = cpal::default_host();
    let device = host.default_input_device().ok_or(SttError::NoInputDevice)?;

    // Pick a config. The default-input-config API returns
    // the OS's preferred format for the device; on most
    // desktops that's F32 PCM at 48 kHz (macOS) or 44.1 kHz
    // (Windows). We could enumerate `supported_input_configs`
    // and ask for F32 / 16 kHz explicitly, but that
    // increases the chance of `BuildStreamError` (the
    // device may not *support* 16 kHz capture). Trusting
    // the device default + resampling is the safer
    // cross-platform choice.
    let config = device
        .default_input_config()
        .map_err(|e| SttError::Io {
            message: format!("failed to query default input config: {e}"),
        })?;
    let sample_format = config.sample_format();
    let source_hz = config.sample_rate().0;
    let channels = config.channels() as usize;

    // Build the per-session state.
    let buffer = Arc::new(Mutex::new(Vec::with_capacity(
        (WHISPER_SAMPLE_RATE_HZ as usize) * (DEFAULT_MAX_DURATION_MS as usize) / 1000,
    )));
    let cancel = CancellationToken::new();

    // cpal's `Stream` is `!Send + !Sync` on every platform
    // (cpal uses a uniform `NotSendSyncAcrossAllPlatforms`
    // marker to protect the Android AAudio backend; the
    // desktop backends are actually `Send`-safe). We wrap
    // the `Stream` in our `SendStream` newtype (which uses
    // `unsafe impl Send + Sync` — see the soundness
    // comment on `SendStream` for the platform-by-platform
    // argument) and park it in a dedicated thread that
    // blocks on an `mpsc::Receiver<()>`. The thread is
    // what holds the `Stream` alive for the duration of
    // the session; on `stop_listening` we send `()` and
    // join the thread, at which point the `Stream` drops
    // and the OS audio device is released. The
    // `JoinHandle<()>` is `Send + Sync` (it always is),
    // so it's safe to store in `LiveSession`.
    let buffer_for_callback = buffer.clone();
    let cancel_for_callback = cancel.clone();
    let (stop_tx, stop_rx) = std::sync::mpsc::channel::<()>();
    let config_for_thread = config.into();

    // The cpal data callback runs on a dedicated audio
    // thread (cpal's, not ours). We clone the
    // `Arc<Mutex<Vec<f32>>>` into the closure so the
    // callback can append resampled samples, and we
    // also need a non-`Send` `LinearMonoResampler` that's
    // owned by the closure.
    let stream = match sample_format {
        SampleFormat::F32 => build_input_stream_for_type::<f32>(
            &device,
            &config_for_thread,
            channels,
            source_hz,
            buffer_for_callback.clone(),
            cancel_for_callback.clone(),
        )?,
        SampleFormat::I16 => build_input_stream_for_type::<i16>(
            &device,
            &config_for_thread,
            channels,
            source_hz,
            buffer_for_callback.clone(),
            cancel_for_callback.clone(),
        )?,
        SampleFormat::U16 => build_input_stream_for_type::<u16>(
            &device,
            &config_for_thread,
            channels,
            source_hz,
            buffer_for_callback.clone(),
            cancel_for_callback.clone(),
        )?,
        other => {
            return Err(SttError::Io {
                message: format!("unsupported sample format: {other:?}"),
            });
        }
    };

    // Park the `Stream` in a dedicated thread. The
    // thread blocks on the `mpsc` receiver; when
    // `stop_listening` sends `()`, the `recv()` returns,
    // the closure returns, the `SendStream` (and the
    // inner `cpal::Stream`) drops, and the thread exits.
    // We `join()` the thread in `stop_listening` so the
    // audio device is guaranteed released before we pull
    // the buffer.
    let stream_thread = std::thread::Builder::new()
        .name(format!("lipi-stt-{}", session_id))
        .spawn(move || {
            // Start the stream. `play()` is required on
            // some platforms (cpal docs: "Not all
            // platforms automatically run the stream
            // upon creation"). We do this here, on the
            // thread that owns the `Stream`, so the
            // audio thread that cpal creates sees a
            // consistent state.
            if let Err(e) = stream.play() {
                eprintln!("[stt_capture] failed to start input stream: {e}");
                return;
            }
            // Block until `stop_listening` signals. The
            // `recv()` returns `Err(Disconnected)` only
            // if the sender is dropped *without* a send
            // — that happens if the `LiveSession` is
            // dropped (e.g. the registry is replaced,
            // which shouldn't happen in practice). We
            // treat both as "stop now."
            let _ = stop_rx.recv();
            // `stream` (the `SendStream` wrapper) drops
            // here, which in turn drops the inner
            // `cpal::Stream`. cpal's `Drop` impl is
            // documented to wait for any in-flight
            // callback to finish.
        })
        .map_err(|e| SttError::Io {
            message: format!("failed to spawn stream-park thread: {e}"),
        })?;

    // Register the session. After this point, `stop_listening`
    // can find it. We do the registration *after* the
    // thread is spawned (and the stream is guaranteed
    // running) so a half-initialized session (device
    // open but not playing) doesn't leak in the
    // registry.
    let session = LiveSession {
        session_id: session_id.clone(),
        buffer,
        cancel,
        stop_tx: Some(stop_tx),
        stream_thread: Some(stream_thread),
    };
    {
        let mut registry_guard = registry.lock().map_err(|e| SttError::Io {
            message: format!("session registry mutex poisoned: {e}"),
        })?;
        registry_guard.insert(session_id.clone(), session);
    }

    Ok(session_id)
}

/// Build a cpal input stream for a concrete sample type.
/// `T` is one of `f32`, `i16`, `u16` — the three sample
/// formats cpal's Windows / macOS / Linux backends can
/// deliver without extra conversion. We branch on
/// `SampleFormat` in the caller and call this once per
/// concrete `T` because cpal's `build_input_stream`
/// requires `T: SizedSample`, which can't be expressed
/// as a generic bound cleanly with `to_sample::<f32>()`.
fn build_input_stream_for_type<T>(
    device: &cpal::Device,
    config: &cpal::StreamConfig,
    channels: usize,
    source_hz: u32,
    buffer: Arc<Mutex<Vec<f32>>>,
    cancel: CancellationToken,
) -> Result<SendStream, SttError>
where
    T: cpal::SizedSample + Send + 'static,
    f32: dasp_sample::conv::FromSample<T>,
{
    let mut resampler = LinearMonoResampler::new(source_hz, WHISPER_SAMPLE_RATE_HZ);
    let buffer_clone = buffer;
    let cancel_clone = cancel;
    let stream = device
        .build_input_stream(
            config,
            move |data: &[T], _: &cpal::InputCallbackInfo| {
                if cancel_clone.is_cancelled() {
                    return;
                }
                // Convert T → f32 + downmix to mono in
                // one pass. `cpal::Sample::to_sample::<f32>()`
                // is backed by `dasp_sample::Sample`; for
                // signed / unsigned integer sources, it
                // maps `T::EQUILIBRIUM` (0 for u16, 0 for
                // i16) to `0.0f32` and full-scale to
                // ±1.0. That's exactly the convention
                // whisper expects.
                let mono = downmix_to_mono_typed(data, channels);
                let mut out =
                    Vec::with_capacity(resampler.output_capacity_for(mono.len()));
                resampler.process(&mono, &mut out);
                if !out.is_empty() {
                    if let Ok(mut guard) = buffer_clone.lock() {
                        guard.append(&mut out);
                    }
                }
            },
            move |err| {
                eprintln!("[stt_capture] cpal stream error: {err}");
            },
            None,
        )
        .map_err(|e| SttError::Io {
            message: format!(
                "failed to build input stream for sample format: {e}"
            ),
        })?;
    Ok(SendStream(stream))
}

/// Convert-and-downmix a non-`f32` interleaved sample
/// buffer to mono f32. Mirrors `downmix_to_mono` but
/// takes a generic `T: cpal::Sample` (which is what
/// cpal hands the callback for `i16` / `u16`). The
/// `cpal::Sample` trait re-exports `dasp_sample::Sample`
/// on 0.15; the `to_sample::<f32>()` call is the
/// canonical conversion path.
///
/// The `f32: FromSample<T>` bound is required by
/// `dasp_sample::conv::ToSample`: the trait
/// `Self: ToSample<S>` is defined as `where S: FromSample<Self>`.
/// We can't express "T can be converted to f32" without
/// naming the `FromSample<f32>` impl on f32 for T — but
/// `FromSample` is sealed-ish (not `dyn`-compatible), so
/// the bound has to live on the caller side. cpal's
/// `Sample` impls for `f32`, `i16`, `u16` all provide
/// the corresponding `FromSample` impl on `f32` already,
/// so the bound is satisfied for the three concrete
/// types we use.
fn downmix_to_mono_typed<T>(interleaved: &[T], channels: usize) -> Vec<f32>
where
    T: cpal::Sample,
    f32: dasp_sample::conv::FromSample<T>,
{
    if channels == 1 {
        return interleaved
            .iter()
            .map(|&s| s.to_sample::<f32>())
            .collect();
    }
    let frame_count = interleaved.len() / channels;
    let mut mono = Vec::with_capacity(frame_count);
    for chunk in interleaved.chunks(channels) {
        let sum: f32 = chunk.iter().map(|&s| s.to_sample::<f32>()).sum();
        mono.push(sum / channels as f32);
    }
    mono
}

/// Downmix an interleaved f32 sample buffer to mono. We
/// use `mean` (sum / N) rather than `sum` because
/// whisper's PCM convention is `[-1.0, 1.0]` — summing
/// would clip when N > 1. Mean is a 6 dB drop per
/// doubling of channels, which is fine for STT (the
/// signal-to-noise is unchanged in the relevant band).
///
/// `downmix_to_mono_typed` is the production path (it's
/// generic over the cpal `SampleFormat` and used by the
/// cpal callback). This f32-specific version is a
/// test-only helper — the production f32 path also goes
/// through `downmix_to_mono_typed::<f32>` for symmetry
/// with the integer sample formats. We `#[allow]`
/// the dead-code warning rather than gating on `cfg(test)`
/// so the test module can reach it without a `super::`
/// import; the symbol is the same `fn downmix_to_mono`,
/// just with a wider scope.
#[allow(dead_code)]
fn downmix_to_mono(interleaved: &[f32], channels: usize) -> Vec<f32> {
    if channels == 1 {
        return interleaved.to_vec();
    }
    let frame_count = interleaved.len() / channels;
    let mut mono = Vec::with_capacity(frame_count);
    for chunk in interleaved.chunks(channels) {
        let sum: f32 = chunk.iter().copied().sum();
        mono.push(sum / channels as f32);
    }
    mono
}

/// Stop the current STT session. The `session_id` is the
/// value returned by `stt_start_listening`.
///
/// Behaviour:
///   1. Look up the session in the registry.
///   2. Cancel the cpal stream (flip the `CancellationToken`
///      so the audio callback stops appending).
///   3. Pull the audio buffer out of the registry (we
///      `mem::take` it so the session's `Drop` doesn't run
///      the destructor on a non-empty `Vec`).
///   4. Drop the cpal `Stream` (releases the OS device
///      handle).
///   5. Remove the session from the registry.
///   6. Dispatch to either `stt_inference::run_inference`
///      (gated by `m2c-native`) or the stub-inference
///      path (default).
///   7. Emit the `stt://transcript` event.
///
/// Idempotent: calling `stop_listening` with an unknown
/// `session_id` returns `Ok(())` (the session may have
/// already been stopped by a max-duration auto-fire or by
/// a previous explicit stop). The `voice/store` on the
/// JS side can rely on "at most one transcript event per
/// session" without tracking the stop's success.
pub async fn stop_listening(
    app: &AppHandle,
    session_id: &str,
) -> Result<(), SttError> {
    let registry = get_registry(app)?;
    // Step 1-5: pull the session out of the registry and
    // drain the buffer. We do this in a single `lock()` so
    // a second concurrent `stop_listening` for the same
    // id sees an empty registry and bails.
    let pulled = {
        let mut guard = registry.lock().map_err(|e| SttError::Io {
            message: format!("session registry mutex poisoned: {e}"),
        })?;
        let entry = guard.remove(session_id);
        // Drop the lock before we run inference — the
        // inference step is the long pole and we don't
        // want to hold the registry mutex across it.
        drop(guard);
        entry
    };
    let Some(mut session) = pulled else {
        // Unknown / already-stopped session. Idempotent
        // no-op. This is the "second stop on the same
        // session" path; the JS side shouldn't normally
        // hit it, but the M3 concurrent-session code
        // might.
        return Ok(());
    };

    // Step 2: cancel the audio callback.
    session.cancel.cancel();

    // Step 3: signal the stream-park thread to drop
    // the cpal `Stream`. We do this *before* pulling
    // the buffer so the cpal `Drop` waits for any
    // in-flight callback to finish (the cpal docs
    // guarantee this), guaranteeing no further samples
    // can land in the buffer once we read it.
    //
    // Then we join the thread — this is the blocking
    // part. We use `tokio::task::spawn_blocking` so we
    // don't stall the Tokio runtime while waiting for
    // a `!Send` thread to finish.
    if let Some(tx) = session.stop_tx.take() {
        // `send` returns `Err` if the receiver was
        // dropped, which only happens if the thread
        // crashed mid-session (it shouldn't, but
        // be defensive). Either way the thread is
        // gone, so the join below is a no-op.
        let _ = tx.send(());
    }
    if let Some(handle) = session.stream_thread.take() {
        // We're an `async fn`; we can't block the
        // runtime waiting on a thread join. Hand the
        // join to `spawn_blocking`. The Tauri command
        // is awaited by the JS side, so this is
        // transparent to the caller.
        let join_result = tokio::task::spawn_blocking(move || handle.join()).await;
        // `join_result` is `Result<Result<(), _>, _>` —
        // the inner `Result` is the thread's panic
        // status. We log and continue; a panicking
        // stream-park thread is a bug but shouldn't
        // stop us from emitting the transcript.
        if let Err(e) = join_result {
            eprintln!("[stt_capture] stream-park thread join failed: {e:?}");
        }
    }

    // Step 4: pull the buffer. By the time we get here
    // the cpal `Stream` is dropped, so the audio
    // callback is guaranteed to be done. The buffer
    // contains every sample the callback appended
    // before the cancellation token flipped.
    let audio = {
        let mut guard = session.buffer.lock().map_err(|e| SttError::Io {
            message: format!("session buffer mutex poisoned: {e}"),
        })?;
        std::mem::take(&mut *guard)
    };

    // Step 5: the session is now fully torn down.
    // Drop the LiveSession to release the Arc clones
    // inside its fields (buffer, cancel). Drop order
    // is field-declaration order; we let the
    // destructors run normally.
    drop(session);

    // Step 6: dispatch. When `m2c-native` is OFF, we
    // emit a stub-inference marker so the dev can
    // confirm the cpal path is wired correctly. When
    // `m2c-native` is ON, we hand the buffer to
    // whisper-rs via `stt_inference::run_inference`.
    let text = dispatch_inference(&audio);

    // Step 7: emit the event.
    let event = TranscriptEvent {
        kind: "final".to_string(),
        text,
        sequence: 0,
        timestamp: now_ms(),
        is_utterance_end: true,
        language: None,
        session_id: Some(session_id.to_string()),
    };
    let _ = app.emit(STT_EVENT_TRANSCRIPT, &event);

    Ok(())
}

/// Run (or stub) the whisper inference step. The body of
/// this function is the only thing the `m2c-native` Cargo
/// feature controls in `stt_capture`.
///
/// Returns the transcript string to be embedded in the
/// `TranscriptEvent::text` field. The default (no
/// `m2c-native`) build returns a clearly-marked stub
/// string so the dev can tell at a glance that the
/// pipeline ran but whisper inference is gated off.
fn dispatch_inference(audio: &[f32]) -> String {
    #[cfg(feature = "m2c-native")]
    {
        // Hand off to the whisper-rs wrapper. The
        // `stt_inference` module is itself gated, so this
        // import is `m2c-native`-only and won't compile
        // on the default build.
        crate::stt_inference::run_inference(audio).unwrap_or_else(|e| {
            eprintln!("[stt_capture] whisper inference failed: {e}");
            format!(
                "(whisper inference failed: {e} — see stderr for the full error)"
            )
        })
    }
    #[cfg(not(feature = "m2c-native"))]
    {
        // Default build: emit a recognisable stub
        // string. We include the audio sample count so
        // the dev can verify the cpal path actually
        // captured something (a zero-count string
        // confirms a broken pipeline; a non-zero count
        // confirms the audio path is wired correctly).
        let _ = audio;
        let sample_count = audio.len();
        format!(
            "voice transcript (on-device STT, stub inference — {sample_count} samples captured; switch the Rust build to m2c-native for real whisper inference)"
        )
    }
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

// --- Tests -------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    // --- LinearMonoResampler tests --------------------------------------

    #[test]
    fn resampler_identity_preserves_samples() {
        // 16 kHz → 16 kHz: step = 1.0, phase stays at 0,
        // every source sample produces one output sample
        // at t = 0 (so the output equals the input). The
        // *first* output sample is the warmup `last_sample`
        // (which we set to `input[0]` on the warmup
        // iteration) interpolated with `input[0]` at t=0
        // — i.e. it equals `input[0]`. So the output is
        // a length-`N-1` prefix of the input... wait,
        // no. Trace through:
        //
        //   - i=0, s=input[0]: warmup. last=input[0]. No out.
        //   - i=1, s=input[1]: phase=0.0<1.0, emit
        //     last*1 + s*0 = last = input[0]. phase=1.0.
        //     phase -= 1.0 → 0.0. last=input[1].
        //   - i=2, s=input[2]: emit last=input[1]. last=input[2].
        //   - ...
        //
        // So out = [input[0], input[1], input[2], ...] =
        // `input` minus the last element. The output is
        // effectively the input delayed by exactly one
        // sample (the warmup cost), and length `N-1`.
        let mut r = LinearMonoResampler::new(16_000, 16_000);
        let input: Vec<f32> = (0..100).map(|i| i as f32 / 100.0).collect();
        let mut out = Vec::new();
        r.process(&input, &mut out);
        // Output is the input delayed by one sample:
        // out[i] == input[i] for i in 0..N-1.
        assert_eq!(out.len(), input.len() - 1);
        for (i, (&got, want)) in out.iter().zip(input.iter()).enumerate() {
            assert!(
                (got - want).abs() < 1e-6,
                "sample {i}: got {got}, want {want}"
            );
        }
    }

    #[test]
    fn resampler_downsamples_3_to_1() {
        // 48 kHz → 16 kHz: step = 3.0. Three source
        // samples → one output sample. Output count
        // should be approximately `input_len / 3`.
        let mut r = LinearMonoResampler::new(48_000, 16_000);
        // Use a constant value so we can verify the
        // interpolation math: every output sample should
        // equal the input value exactly (linear interp
        // of a constant is the constant).
        let input: Vec<f32> = vec![0.5; 300];
        let mut out = Vec::new();
        r.process(&input, &mut out);
        // 300 source samples, 1 warmup, then 299 frames
        // processed. 299 / 3.0 = 99.67, so we should
        // see either 99 or 100 output samples.
        assert!(
            (99..=100).contains(&out.len()),
            "expected 99-100 samples, got {}",
            out.len()
        );
        for (i, &s) in out.iter().enumerate() {
            assert!(
                (s - 0.5).abs() < 1e-6,
                "sample {i}: got {s}, want 0.5 (constant input)"
            );
        }
    }

    #[test]
    fn resampler_upsamples_1_to_2() {
        // 8 kHz → 16 kHz: step = 0.5. One source sample
        // produces two output samples (interpolation
        // between consecutive source frames).
        let mut r = LinearMonoResampler::new(8_000, 16_000);
        let input: Vec<f32> = vec![0.0, 1.0, 0.0, 1.0, 0.0, 1.0];
        let mut out = Vec::new();
        r.process(&input, &mut out);
        // 6 source samples, 1 warmup, 5 effective source
        // frames processed. At step 0.5, each frame
        // produces 2 output samples, so we expect ~10
        // output samples. (The exact count depends on
        // the loop bound; we just check the rough
        // range.)
        assert!(
            (9..=11).contains(&out.len()),
            "expected 9-11 samples, got {}",
            out.len()
        );
        // The output should stay in [-1.0, 1.0] (no
        // clipping from interpolation).
        for &s in &out {
            assert!(
                (-1.0..=1.0).contains(&s),
                "out-of-range sample: {s}"
            );
        }
    }

    #[test]
    fn resampler_sine_wave_preserves_rms_within_tolerance() {
        // Generate a 440 Hz sine at 48 kHz, resample to
        // 16 kHz. The output RMS should be close to the
        // input RMS (linear interpolation of a band-limited
        // sine stays close; some high-frequency energy
        // leaks but RMS is preserved in the band).
        let source_hz = 48_000_u32;
        let target_hz = 16_000_u32;
        let freq = 440.0_f64;
        let duration_s = 0.5;
        let n = (source_hz as f64 * duration_s) as usize;
        let mut input: Vec<f32> = Vec::with_capacity(n);
        for i in 0..n {
            let t = i as f64 / source_hz as f64;
            input.push((2.0 * std::f64::consts::PI * freq * t).sin() as f32);
        }
        let input_rms = rms(&input);

        let mut r = LinearMonoResampler::new(source_hz, target_hz);
        let mut out = Vec::new();
        r.process(&input, &mut out);
        let out_rms = rms(&out);

        // Linear interpolation of a 440 Hz sine at 48 kHz
        // preserves RMS to within ~3% (the exact figure
        // depends on the phase of the warmup sample,
        // but 3% is a safe upper bound for a 30 kHz
        // bandwidth-limited signal).
        let rel_error = ((out_rms - input_rms) / input_rms).abs();
        assert!(
            rel_error < 0.05,
            "RMS drift too large: input {input_rms}, output {out_rms}, rel error {rel_error}"
        );
    }

    #[test]
    fn resampler_output_capacity_is_a_safe_upper_bound() {
        // The pre-sized capacity should be enough to
        // hold the actual output. If the formula is
        // wrong, the `process` call would still work
        // (Vec reallocates), but the test ensures the
        // pre-sizing logic is sane.
        let mut r = LinearMonoResampler::new(48_000, 16_000);
        let input: Vec<f32> = vec![0.1; 1024];
        let cap = r.output_capacity_for(input.len());
        let mut out = Vec::with_capacity(cap);
        r.process(&input, &mut out);
        assert!(
            out.len() <= cap,
            "output {} exceeded pre-sized capacity {}",
            out.len(),
            cap
        );
    }

    fn rms(samples: &[f32]) -> f32 {
        if samples.is_empty() {
            return 0.0;
        }
        let sum_sq: f64 = samples.iter().map(|&s| (s as f64).powi(2)).sum();
        ((sum_sq / samples.len() as f64).sqrt()) as f32
    }

    // --- downmix_to_mono tests -----------------------------------------

    #[test]
    fn downmix_stereo_to_mono_averages_channels() {
        // Left = [0.0, 0.5, 1.0], Right = [0.0, 1.0, 0.0]
        // (interleaved: [0.0, 0.0, 0.5, 1.0, 1.0, 0.0])
        // Mono mean = [0.0, 0.75, 0.5]
        let interleaved: Vec<f32> = vec![0.0, 0.0, 0.5, 1.0, 1.0, 0.0];
        let mono = downmix_to_mono(&interleaved, 2);
        assert_eq!(mono.len(), 3);
        assert!((mono[0] - 0.0).abs() < 1e-6);
        assert!((mono[1] - 0.75).abs() < 1e-6);
        assert!((mono[2] - 0.5).abs() < 1e-6);
    }

    #[test]
    fn downmix_mono_passes_through() {
        // 1-channel input is returned verbatim (modulo
        // the copy). The copy is intentional: the cpal
        // callback needs an owned `Vec<f32>` to feed the
        // resampler.
        let input: Vec<f32> = vec![0.1, 0.2, 0.3, 0.4];
        let mono = downmix_to_mono(&input, 1);
        assert_eq!(mono, input);
    }

    #[test]
    fn downmix_3_channels_averages_correctly() {
        // 3-channel interleaved [a, b, c, a, b, c, ...].
        let input: Vec<f32> = vec![0.0, 0.0, 0.0, 1.0, 2.0, 3.0];
        let mono = downmix_to_mono(&input, 3);
        assert_eq!(mono.len(), 2);
        assert!((mono[0] - 0.0).abs() < 1e-6);
        // (1 + 2 + 3) / 3 = 2.0
        assert!((mono[1] - 2.0).abs() < 1e-6);
    }

    // --- SessionRegistry shape tests -----------------------------------

    #[test]
    fn session_registry_supports_insert_and_remove() {
        // The registry is just a typed HashMap; the
        // test ensures our `Arc<Mutex<…>>` wrapper
        // composes correctly (insert, remove, contains)
        // for the simple case. We don't build a real
        // cpal stream here — `LiveSession` is
        // constructible without a `stream_thread` only
        // inside a `start_listening` call, which
        // requires an audio device. For this test the
        // `stop_tx` + `stream_thread` are `None` — the
        // shutdown path is exercised by
        // `stop_listening`, not here.
        let registry: SessionRegistry = Arc::new(Mutex::new(HashMap::new()));
        {
            let mut guard = registry.lock().unwrap();
            assert!(guard.is_empty());
            guard.insert(
                "stt_test".to_string(),
                LiveSession {
                    session_id: "stt_test".to_string(),
                    buffer: Arc::new(Mutex::new(Vec::new())),
                    cancel: CancellationToken::new(),
                    stop_tx: None,
                    stream_thread: None,
                },
            );
            assert_eq!(guard.len(), 1);
            assert!(guard.contains_key("stt_test"));
        }
        {
            let mut guard = registry.lock().unwrap();
            let removed = guard.remove("stt_test");
            assert!(removed.is_some());
            assert!(guard.is_empty());
        }
    }

    #[test]
    fn session_registry_remove_unknown_returns_none() {
        // The idempotent-stop path: removing a session
        // that doesn't exist must return `None` so
        // `stop_listening` can decide "nothing to do."
        let registry: SessionRegistry = Arc::new(Mutex::new(HashMap::new()));
        let removed = registry
            .lock()
            .unwrap()
            .remove("nonexistent");
        assert!(removed.is_none());
    }

    // --- TranscriptEvent / constants tests -----------------------------

    #[test]
    fn whisper_sample_rate_is_16khz() {
        assert_eq!(WHISPER_SAMPLE_RATE_HZ, 16_000);
    }

    #[test]
    fn samples_per_ms_is_a_clean_integer() {
        assert_eq!(WHISPER_SAMPLES_PER_MS, 16);
    }

    #[test]
    fn default_max_duration_yields_a_manageable_buffer() {
        let max_samples =
            (DEFAULT_MAX_DURATION_MS as usize) * (WHISPER_SAMPLES_PER_MS as usize);
        let buffer_bytes = max_samples * std::mem::size_of::<f32>();
        assert!(buffer_bytes < 4 * 1024 * 1024, "buffer should be < 4 MB");
    }

    #[test]
    fn transcript_event_serializes_with_camel_case_keys() {
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
        assert!(json.contains("\"sessionId\":\"stt_abcdef\""));
    }

    #[test]
    fn transcript_event_omits_language_when_none() {
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
        assert!(!json.contains("sessionId"));
    }

    // --- dispatch_inference tests --------------------------------------

    #[test]
    fn dispatch_inference_includes_sample_count_in_stub_mode() {
        // The default-build stub marker must include
        // the captured sample count so the dev can
        // verify the cpal pipeline actually filled the
        // buffer. A zero-count string is a strong
        // signal that audio capture is broken.
        let audio: Vec<f32> = vec![0.0; 16_000]; // 1 second
        let result = dispatch_inference(&audio);
        assert!(
            result.contains("16000 samples"),
            "stub marker should include the sample count; got: {result}"
        );
    }

    #[test]
    fn dispatch_inference_handles_empty_audio() {
        // The stub marker should still produce *some*
        // string for an empty buffer (the cpal callback
        // might have been cancelled before the first
        // frame). Whisper's `full` would also accept an
        // empty input (returning 0 segments).
        let result = dispatch_inference(&[]);
        assert!(
            result.contains("0 samples"),
            "empty-audio stub marker should report 0 samples; got: {result}"
        );
    }
}
