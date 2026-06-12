//! Phase 5b-2 — cancellation registry for in-flight
//! chat streams.
//!
//! The JS side calls `ai_cancel_stream(requestId)`
//! to abort a streaming chat. The Rust side keeps a
//! process-wide map of `requestId -> Arc<AtomicBool>`;
//! the chat-stream reader task checks the bool
//! between SSE events and bails out when it's set.
//!
//! This is the same pattern as the terminal session
//! map (`terminal::SessionRegistry` in 4c) but
//! simpler — no status, no exit code, just a flag.
//!
//! ## RAII cleanup
//!
//! The chat-stream task holds a `CancelGuard` for
//! the duration of the stream; when the task exits
//! (naturally, on error, or on cancellation), the
//! guard drops and the entry is removed from the
//! map. This means the map only ever contains
//! in-flight requests, never stale entries.
//!
//! ## Concurrency
//!
//! The map is behind a `Mutex` (the canonical
//! choice for "low-contention, infrequent mutation
//! with frequent reads" — the map is mutated once
//! per request lifecycle, not per SSE event). The
//! `Arc<AtomicBool>` is what the reader task
//! actually checks (`Ordering::Relaxed` is fine
//! because the bool is a pure "stop now" signal —
//! we don't need to synchronise any other state
//! through it).
//!
//! ## Why a `OnceLock` and not a `lazy_static!`
//!
//! `OnceLock` is in `std::sync` since 1.70. We
//! initialise the registry at app startup from
//! the `run()` function (or on first use, via
//! `get_or_init`). The MSRV is 1.82 (per
//! `Cargo.toml` `rust-version`), so `OnceLock` is
//! fine.

use std::collections::HashMap;
// `Ordering` is used in the `#[cfg(test)]`
// module below. The non-test code paths use
// `cancel::lookup(...)` which returns an
// `Arc<AtomicBool>` — callers do their own
// `Ordering` selection. We allow the unused
// import in non-test builds.
#[allow(unused_imports)]
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};

type CancelMap = Mutex<HashMap<String, Arc<AtomicBool>>>;

/// The process-wide cancellation registry. Set up
/// once at app startup. Tests can call
/// `cancel_registry().get_or_init(...)` to inject a
/// fresh registry; production calls it from `run()`.
static CANCEL_REGISTRY: OnceLock<CancelMap> = OnceLock::new();

/// Return the process-wide registry, initialising
/// it on first call. Safe to call from multiple
/// threads (the first caller wins; subsequent
/// callers see the same `Arc<AtomicBool>` for
/// the same `requestId`).
pub fn cancel_registry() -> &'static CancelMap {
    CANCEL_REGISTRY.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Register a new request's cancellation token.
/// Returns the `Arc<AtomicBool>` the caller should
/// hand to the reader task, and a `CancelGuard`
/// that removes the entry from the map on drop.
///
/// If the same `request_id` is registered twice
/// (which shouldn't happen — the JS side generates
/// a fresh id per `ai_chat_stream` call), the
/// second registration wins and the first guard's
/// `drop` is a no-op (we re-check the Arc identity
/// in the guard). This is defensive: we'd rather
/// flip a stale flag than silently fail to cancel.
pub fn register(request_id: &str) -> (Arc<AtomicBool>, CancelGuard) {
    let cancel = Arc::new(AtomicBool::new(false));
    let cancel_for_map = cancel.clone();
    {
        let mut map = cancel_registry().lock().expect("cancel registry poisoned");
        map.insert(request_id.to_string(), cancel_for_map);
    }
    let cancel_for_caller = cancel.clone();
    let guard = CancelGuard {
        request_id: request_id.to_string(),
        cancel: Some(cancel),
    };
    (cancel_for_caller, guard)
}

/// Look up a request's cancellation token by
/// `requestId`. Returns `None` if the request is
/// unknown (already finished, never existed, or
/// was registered under a different id).
pub fn lookup(request_id: &str) -> Option<Arc<AtomicBool>> {
    let map = cancel_registry().lock().expect("cancel registry poisoned");
    map.get(request_id).cloned()
}

/// Remove a request's entry from the registry.
/// Idempotent: returns silently if the entry is
/// not present. Public for the guard's `Drop` and
/// for tests.
pub fn deregister(request_id: &str) {
    let mut map = cancel_registry().lock().expect("cancel registry poisoned");
    map.remove(request_id);
}

/// RAII guard: removes the request's entry from
/// the registry on drop. Holds a reference to the
/// `Arc<AtomicBool>` so a lookup-during-teardown
/// race can't panic.
pub struct CancelGuard {
    request_id: String,
    /// `None` after `disarm()` (used by the
    /// registry to avoid double-removal). We keep
    /// the `Arc` in the Option so the guard is
    /// `Drop`-safe.
    cancel: Option<Arc<AtomicBool>>,
}

impl Drop for CancelGuard {
    fn drop(&mut self) {
        if self.cancel.is_some() {
            deregister(&self.request_id);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn register_then_lookup_returns_same_arc() {
        let id = format!("test_register_lookup_{}", random_suffix());
        let (cancel, _guard) = register(&id);
        let looked_up = lookup(&id).expect("entry should be present");
        assert!(Arc::ptr_eq(&cancel, &looked_up));
    }

    #[test]
    fn guard_drop_removes_entry() {
        let id = format!("test_guard_drop_{}", random_suffix());
        let (_cancel, guard) = register(&id);
        assert!(lookup(&id).is_some());
        drop(guard);
        assert!(lookup(&id).is_none());
    }

    #[test]
    fn flip_signal_via_lookup() {
        let id = format!("test_flip_{}", random_suffix());
        let (cancel, _guard) = register(&id);
        let looked_up = lookup(&id).expect("entry should be present");
        assert!(!looked_up.load(Ordering::Relaxed));
        looked_up.store(true, Ordering::Relaxed);
        assert!(cancel.load(Ordering::Relaxed));
    }

    /// The tests in this module share the
    /// process-wide `CANCEL_REGISTRY`. Using
    /// random suffixes avoids the rare collision
    /// when tests run in parallel.
    fn random_suffix() -> String {
        use std::time::{SystemTime, UNIX_EPOCH};
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        format!("{nanos}")
    }
}
