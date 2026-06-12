//! Integration smoke test for the `git` module.
//!
//! Phase 3b added this as a guardrail: the unit tests in `src/git.rs`
//! already cover per-file changes against a temp repo, but the real
//! "ship a real desktop app" question is "does the `open_repo` ->
//! `status` wire return the right *shape* of data for a real
//! working tree, with no surprises in the changeKind discriminator?".
//!
//! Phase 3c-1 extends this with diff + discard wire-shape checks:
//!   - `file_diff_serialises_with_camel_case_field_names` — locks the
//!     FileDiff JSON shape (camelCase renames) so the 3c-2 DiffView
//!     can build against a stable contract.
//!   - `discard_writes_head_blob_back_to_worktree` — exercises the
//!     full open -> modify -> discard -> re-status roundtrip on a
//!     real temp repo, asserting that the file is restored to HEAD's
//!     content and that status() reports the worktree as clean again.
//!
//! This test spins up a fresh temp git repo (mirroring the
//! `init_temp_repo` helper in `src/git.rs`'s unit tests but reachable
//! from the integration test binary) and asserts a minimal shape
//! contract. The lipi/ project root is not assumed to be a git repo
//! — it isn't in the current dev environment, and depending on a
//! developer having initialised one would be a flaky test.

use std::fs;
use std::path::PathBuf;
use std::process::Command;

use lipi_lib::{diff, discard, open_repo, status, ChangeKind};

fn run(cmd: &str, args: &[&str], cwd: &PathBuf) {
    let status = Command::new(cmd)
        .args(args)
        .current_dir(cwd)
        .output()
        .expect(cmd);
    assert!(
        status.status.success(),
        "{} {:?} failed: {}",
        cmd,
        args,
        String::from_utf8_lossy(&status.stderr)
    );
}

/// Mirror of the unit test helper: create a fresh temp git repo
/// with one committed file. Returns the canonicalised workdir.
fn init_temp_repo(label: &str) -> PathBuf {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let dir = std::env::temp_dir().join(format!("lipi-git-smoke-{label}-{nanos}"));
    fs::create_dir_all(&dir).unwrap();
    run("git", &["init", "-q", "-b", "main"], &dir);
    run("git", &["config", "user.email", "lipi@test"], &dir);
    run("git", &["config", "user.name", "Lipi"], &dir);
    fs::write(dir.join("hello.txt"), "hello\n").unwrap();
    run("git", &["add", "."], &dir);
    run("git", &["commit", "-q", "-m", "init"], &dir);
    // Canonicalise so gix sees the same shape as a real user-supplied
    // absolute path. (gix::open is happy with non-canonical paths, but
    // we want the wire to roundtrip an `open_repo` -> `status` pair
    // on a real-path-style input.)
    dunce_canonicalize(&dir)
}

#[cfg(windows)]
fn dunce_canonicalize(p: &PathBuf) -> PathBuf {
    // On Windows, `std::fs::canonicalize` returns the
    // extended-length `\\?\C:\...` form, which trips up some tools.
    // Strip the prefix to get a plain `C:\...` path.
    let s = p.to_string_lossy().to_string();
    if let Some(stripped) = s.strip_prefix(r"\\?\") {
        PathBuf::from(stripped)
    } else {
        p.clone()
    }
}

#[cfg(not(windows))]
fn dunce_canonicalize(p: &PathBuf) -> PathBuf {
    p.clone()
}

#[test]
fn open_and_status_round_trip_on_a_real_temp_repo() {
    let dir = init_temp_repo("roundtrip");
    let handle = open_repo(&dir).expect("open_repo should succeed on a real repo");
    // The handle's workdir should be the same path we opened (modulo
    // gix's own canonicalisation; the unit tests assert exact
    // equality, but at the integration layer we just assert
    // canonical equality so this test is robust to gix tweaks).
    let handle_canon = dunce_canonicalize(&PathBuf::from(&handle.workdir));
    assert_eq!(handle_canon, dir);

    let s = status(&handle).expect("status should succeed on a real repo");
    assert_eq!(s.branch.as_deref(), Some("main"));
    assert!(s.is_clean, "freshly committed repo should be clean, got {:?}", s.changed_files);
    assert!(s.changed_files.is_empty());
    assert!(!s.is_detached);

    fs::remove_dir_all(&dir).ok();
}

#[test]
fn status_kind_discriminator_is_exhaustively_named() {
    // This test will fail to compile if a new ChangeKind variant is
    // added without updating the kind naming. It's a tripwire.

    fn name(k: ChangeKind) -> &'static str {
        match k {
            ChangeKind::Added => "added",
            ChangeKind::Modified => "modified",
            ChangeKind::Deleted => "deleted",
            ChangeKind::Renamed => "renamed",
            ChangeKind::Copied => "copied",
            ChangeKind::Untracked => "untracked",
            ChangeKind::TypeChange => "type-change",
            ChangeKind::Conflict => "conflict",
        }
    }

    // Make sure every known kind has a non-empty name (no fallthroughs).
    for kind in [
        ChangeKind::Added,
        ChangeKind::Modified,
        ChangeKind::Deleted,
        ChangeKind::Renamed,
        ChangeKind::Copied,
        ChangeKind::Untracked,
        ChangeKind::TypeChange,
        ChangeKind::Conflict,
    ] {
        assert!(!name(kind).is_empty());
    }
}

#[test]
fn changed_file_serialises_with_camel_case_field_names() {
    // The Rust -> JSON rename rules are `#[serde(rename_all = "camelCase")]`
    // for `ChangedFile`. This is the contract the JS side reads
    // (`@/ipc/git.ts` mirrors it), so a regression here would silently
    // break the wire. Snapshot-test the JSON shape.
    let dir = init_temp_repo("rename");
    fs::write(dir.join("fresh.txt"), "new file\n").unwrap();
    let h = open_repo(&dir).expect("open_repo");
    let s = status(&h).expect("status");
    let fresh = s
        .changed_files
        .iter()
        .find(|c| c.path.ends_with("fresh.txt"))
        .expect("fresh.txt in changed_files");
    let json = serde_json::to_value(fresh).expect("serialize");
    // Staged should be false (untracked -> unstaged-only), and the
    // *serialised* field name must be `staged`, not `staged_`.
    assert_eq!(json["staged"], serde_json::Value::Bool(false));
    assert_eq!(json["unstaged"], serde_json::Value::Bool(true));
    assert_eq!(json["path"], serde_json::Value::String(fresh.path.clone()));
    // `kind` is a unit variant serialised via rename_all = "kebab-case".
    assert_eq!(json["kind"], serde_json::Value::String("untracked".into()));
    fs::remove_dir_all(&dir).ok();
}

// --- Phase 3c-1: diff + discard wire shape -----------------------------

#[test]
fn file_diff_serialises_with_camel_case_field_names() {
    // Mirror the ChangedFile pattern: lock the FileDiff JSON shape
    // so 3c-2's DiffView component builds against a stable contract.
    // The Rust struct uses `#[serde(rename_all = "camelCase")]`; the
    // JS `FileDiff` interface mirrors it.
    let dir = init_temp_repo("diff-camel");
    let tracked = dir.join("hello.txt");
    // Modify the tracked file so both `old` and `new` are non-null.
    fs::write(&tracked, "v2-content\n").unwrap();

    let h = open_repo(&dir).expect("open_repo");
    let d = diff(&h, &tracked).expect("diff should succeed");

    // Direct Rust access: snake_case field names (camelCase is for
    // JSON only).
    assert!(!d.is_binary);
    assert!(!d.is_new);
    assert!(!d.is_deleted);
    assert_eq!(d.old.as_deref(), Some("hello\n"));
    assert_eq!(d.new.as_deref(), Some("v2-content\n"));

    // JSON shape: must be camelCase.
    let json = serde_json::to_value(&d).expect("serialize");
    assert_eq!(
        json["path"],
        serde_json::Value::String(tracked.to_string_lossy().to_string())
    );
    assert_eq!(json["old"], serde_json::Value::String("hello\n".into()));
    assert_eq!(json["new"], serde_json::Value::String("v2-content\n".into()));
    assert_eq!(json["isBinary"], serde_json::Value::Bool(false));
    assert_eq!(json["isNew"], serde_json::Value::Bool(false));
    assert_eq!(json["isDeleted"], serde_json::Value::Bool(false));

    fs::remove_dir_all(&dir).ok();
}

#[test]
fn discard_writes_head_blob_back_to_worktree() {
    // Roundtrip: open -> modify -> discard -> re-status.
    // After discard, status() must report the worktree as clean.
    let dir = init_temp_repo("discard-roundtrip");
    let tracked = dir.join("hello.txt");
    // Sanity: starting state is clean.
    let h = open_repo(&dir).expect("open_repo");
    assert!(status(&h).expect("status").is_clean);

    // Modify the file and confirm it shows up in status.
    fs::write(&tracked, "garbage\n").unwrap();
    let s = status(&h).expect("status after modify");
    assert!(!s.is_clean, "modification should be visible in status");
    let changed = s
        .changed_files
        .iter()
        .find(|c| c.path.ends_with("hello.txt"))
        .expect("hello.txt in changed_files");
    assert_eq!(changed.kind, ChangeKind::Modified);

    // Discard and confirm.
    discard(&h, &tracked).expect("discard should succeed");
    let restored = fs::read_to_string(&tracked).expect("read hello.txt");
    assert_eq!(restored, "hello\n", "worktree should be restored to HEAD");

    // Status is clean again.
    let s_after = status(&h).expect("status after discard");
    assert!(
        s_after.is_clean,
        "post-discard worktree should be clean, got {:?}",
        s_after.changed_files
    );

    fs::remove_dir_all(&dir).ok();
}

#[test]
fn discard_is_idempotent_on_already_clean_files() {
    // `discard` on a file that's already at HEAD's content should be
    // a no-op: the worktree is untouched, no errors, status stays
    // clean. This is the "click discard twice" case.
    let dir = init_temp_repo("discard-idempotent");
    let tracked = dir.join("hello.txt");
    let h = open_repo(&dir).expect("open_repo");
    let before = fs::read_to_string(&tracked).expect("read");

    discard(&h, &tracked).expect("discard on clean file");
    let after = fs::read_to_string(&tracked).expect("read");
    assert_eq!(before, after, "clean file should not be touched");

    let s = status(&h).expect("status");
    assert!(s.is_clean, "clean repo stays clean after idempotent discard");

    fs::remove_dir_all(&dir).ok();
}
