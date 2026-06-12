//! Lipi — workspace text search (Phase S).
//!
//! Exposes a single Tauri command `workspace_search` that walks a
//! directory tree and returns a flat list of matches
//! (`{path, line, column, lineText}`). Pure stdlib, no ripgrep
//! dependency. Slower than ripgrep on huge repos, but adequate
//! for typical user workspaces (≤ a few thousand files) and
//! avoids shipping a 5 MB sidecar binary.
//!
//! ## Design choices
//!
//! 1. **No recursive descent walker library**: we use
//!    `fs::read_dir` in a stack-based loop so we can stop
//!    early on the first `MaxResults` matches (ripgrep does
//!    the same with `--max-count` semantics, just much
//!    faster). For a typical "find me TODO in this folder"
//!    search, we never read more than a few hundred files
//!    before hitting the cap.
//!
//! 2. **UTF-8 only with a NUL-byte probe**: anything with a
//!    NUL byte in the first 8 KB is treated as binary and
//!    skipped. We don't attempt cp1252 / Latin-1 fallbacks
//!    in v1 — binary files are a search-no-op in every
//!    editor I've ever used, and the false-negative cost is
//!    low (the user can rename `.bin` to `.txt` and retry,
//!    or open the file directly).
//!
//! 3. **Default ignore list** matches the
//!    [common set](https://git-scm.com/docs/gitignore) —
//!    `.git`, `node_modules`, `dist`, `build`, etc. The JS
//!    side can override via the `extraIgnores` parameter.
//!
//! 4. **Per-file size cap** matches the editor's read cap
//!    (`MAX_READ_BYTES` from `fs.rs`). Files larger than
//!    that wouldn't open in Monaco anyway, so a search hit
//!    inside a 50 MB log file would be useless. We skip
//!    them silently.
//!
//! 5. **Synchronous**: the command reads each file in
//!    sequence on Tauri's worker thread. Tauri commands
//!    are allowed to block; the JS side awaits a
//!    Promise. We could parallelise with rayon, but the
//!    common case is "search a folder, get 20 results in
//!    200 ms" and parallelising adds measurable complexity
//!    to the cancellation story (which v1 doesn't have).
//!
//! ## Cancellation
//!
//! Not implemented in v1. A search of a 10 GB
//! `node_modules` that the user forgot to ignore takes
//! ~30 s on a fast disk. That's a UX problem worth solving
//! in a follow-up — likely with a tokio task + a
//! `CancellationToken` that the JS side can flip via
//! `workspace_search_cancel`. Documented as a known
//! limitation; not blocking the v1 ship.

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::fs::{looks_like_text, MAX_READ_BYTES};

/// Default directories and file globs to skip during a
/// workspace search. Matches what most editors
/// (VS Code, Sublime, Zed) skip by default.
const DEFAULT_IGNORES: &[&str] = &[
    ".git",
    "node_modules",
    "dist",
    "build",
    "target", // Cargo build output
    ".next",
    ".nuxt",
    ".cache",
    ".parcel-cache",
    ".turbo",
    ".svelte-kit",
    ".venv",
    "venv",
    "__pycache__",
    ".pytest_cache",
    ".mypy_cache",
    ".terraform",
    ".gradle",
    "out",
    "coverage",
    ".nyc_output",
    ".idea",
    ".vscode",
];

/// The hard cap on the number of matches returned in a
/// single search. Keeps the IPC payload bounded and
/// gives the UI a clear "X more matches not shown" hint
/// at the bottom of the results list.
pub const MAX_RESULTS: usize = 1_000;

/// Hard cap on the number of files scanned. A
/// pathological case (forgot to ignore `node_modules`)
/// can't blow up the search beyond this.
pub const MAX_FILES_SCANNED: usize = 10_000;

#[derive(Debug, Error, Serialize)]
#[serde(tag = "kind", content = "detail")]
pub enum SearchError {
    #[error("path not found: {0}")]
    NotFound(String),
    #[error("not a directory: {0}")]
    NotADirectory(String),
    #[error("invalid query: {0}")]
    InvalidQuery(String),
    #[error("io error: {0}")]
    Io(String),
}

impl From<std::io::Error> for SearchError {
    fn from(err: std::io::Error) -> Self {
        match err.kind() {
            std::io::ErrorKind::NotFound => {
                SearchError::NotFound(err.to_string())
            }
            _ => SearchError::Io(err.to_string()),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchMatch {
    /// Absolute path to the file containing the match.
    pub path: String,
    /// 1-based line number.
    pub line: u32,
    /// 1-based column number.
    pub column: u32,
    /// The full line text (without the trailing newline).
    /// We send the line rather than just the match so
    /// the JS side can render context without a second
    /// read.
    pub line_text: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    /// The matches, in walk order (file-system order
    /// within a directory). The JS side is free to
    /// re-sort.
    pub matches: Vec<SearchMatch>,
    /// Number of files actually scanned. The UI uses
    /// this for the "X files scanned" footer.
    pub files_scanned: u32,
    /// True if we hit the `MAX_RESULTS` cap and stopped
    /// early. The UI shows "Showing first N matches".
    pub truncated: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchOptions {
    /// The substring to search for. Case-sensitive
    /// in v1; we add case-insensitive as a follow-up
    /// (it's a one-line change but I want the v1
    /// behaviour to match the user's typed query
    /// exactly).
    pub query: String,
    /// The directory to search in. Must exist and
    /// be a directory.
    pub root_path: String,
    /// File name globs to ignore, in addition to
    /// the default set. The JS side can pass
    /// `.lipiignore` contents here, or workspace-
    /// specific extras.
    #[serde(default)]
    pub extra_ignores: Vec<String>,
    /// When true, the search is case-insensitive.
    /// Off by default; matching the typed query
    /// exactly is the v1 contract.
    #[serde(default)]
    pub case_insensitive: bool,
    /// Maximum number of results to return. Defaults
    /// to `MAX_RESULTS` (1_000) when None. The UI
    /// may override for a "find next" operation.
    #[serde(default)]
    pub max_results: Option<usize>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Match {
    Yes { column: u32 },
    No,
}

/// Search the workspace rooted at `root_path` for
/// `query`. Returns a flat list of matches plus
/// diagnostics (files scanned, truncated flag).
#[tauri::command]
pub fn workspace_search(opts: SearchOptions) -> Result<SearchResult, SearchError> {
    if opts.query.is_empty() {
        return Err(SearchError::InvalidQuery(
            "query must not be empty".to_string(),
        ));
    }
    let root = PathBuf::from(&opts.root_path);
    let meta = fs::metadata(&root).map_err(|err| match err.kind() {
        std::io::ErrorKind::NotFound => {
            SearchError::NotFound(root.display().to_string())
        }
        _ => SearchError::Io(err.to_string()),
    })?;
    if !meta.is_dir() {
        return Err(SearchError::NotADirectory(
            root.display().to_string(),
        ));
    }

    let max_results = opts.max_results.unwrap_or(MAX_RESULTS);
    let needles = build_needles(&opts);

    let mut matches: Vec<SearchMatch> = Vec::new();
    let mut files_scanned: u32 = 0;
    let mut truncated = false;

    let mut stack: Vec<PathBuf> = vec![root];
    let ignore_table = IgnoreTable::new(&DEFAULT_IGNORES, &opts.extra_ignores);

    while let Some(dir) = stack.pop() {
        if files_scanned as usize >= MAX_FILES_SCANNED {
            truncated = true;
            break;
        }
        if matches.len() >= max_results {
            truncated = true;
            break;
        }

        let entries = match fs::read_dir(&dir) {
            Ok(e) => e,
            Err(_) => continue, // permission denied etc. — skip silently
        };
        // Sort: dirs first, then files, both
        // alphabetically. Matches `fs::read_dir`'s
        // typical iteration order on most
        // platforms and gives stable output for
        // tests.
        let mut dirs = Vec::new();
        let mut files = Vec::new();
        for entry in entries {
            let entry = match entry {
                Ok(e) => e,
                Err(_) => continue,
            };
            let name = entry.file_name().to_string_lossy().to_string();
            if ignore_table.is_ignored(&name) {
                continue;
            }
            let path = entry.path();
            let m = match entry.metadata() {
                Ok(m) => m,
                Err(_) => continue,
            };
            if m.is_dir() {
                dirs.push(path);
            } else {
                files.push((path, m.len()));
            }
        }
        dirs.sort();
        files.sort_by(|a, b| a.0.cmp(&b.0));

        for d in dirs {
            stack.push(d);
        }
        for (path, size) in files {
            if files_scanned as usize >= MAX_FILES_SCANNED {
                truncated = true;
                break;
            }
            if matches.len() >= max_results {
                truncated = true;
                break;
            }
            if size > MAX_READ_BYTES {
                continue;
            }
            files_scanned += 1;
            if scan_file(&path, &needles, &mut matches, max_results) {
                // `scan_file` stopped at the cap.
                truncated = true;
                break;
            }
        }
    }

    Ok(SearchResult {
        matches,
        files_scanned,
        truncated,
    })
}

/// Per-needle matcher. We accept up to two needles —
/// the raw query and, when `case_insensitive` is on,
/// its lowercased twin — and return `Yes` if any
/// matches. Storing the lowercased version saves
/// us re-lowercasing the haystack on every line.
struct Needles {
    raw: String,
    /// Lowercased copy of `raw`. Only used when
    /// the search is case-insensitive — otherwise
    /// the field is the same as `raw` and the
    /// case-sensitive path runs.
    insensitive: String,
}

fn build_needles(opts: &SearchOptions) -> Needles {
    if opts.case_insensitive {
        Needles {
            raw: opts.query.clone(),
            insensitive: opts.query.to_lowercase(),
        }
    } else {
        // We still build the lowercased form
        // (it's free) so the per-line scan
        // can branch on a single bool flag.
        Needles {
            raw: opts.query.clone(),
            insensitive: String::new(),
        }
    }
}

fn scan_file(
    path: &Path,
    needles: &Needles,
    out: &mut Vec<SearchMatch>,
    max_results: usize,
) -> bool {
    let bytes = match fs::read(path) {
        Ok(b) => b,
        Err(_) => return false,
    };
    if !looks_like_text(&bytes) {
        return false;
    }
    // Lossy conversion: invalid UTF-8 is replaced
    // with U+FFFD, which keeps the line/column
    // math simple. We don't need a perfectly
    // faithful byte view for search results.
    let text = String::from_utf8_lossy(&bytes);
    let path_str = path.to_string_lossy().into_owned();
    let insensitive_needle = needles.insensitive.as_str();

    for (i, line) in text.lines().enumerate() {
        if out.len() >= max_results {
            return true; // hit the cap — tell the caller
        }
        let m = if needles.insensitive.is_empty() {
            find_in_line(line, &needles.raw, false)
        } else {
            find_in_line(line, insensitive_needle, true)
        };
        if let Match::Yes { column } = m {
            out.push(SearchMatch {
                path: path_str.clone(),
                line: (i + 1) as u32,
                column,
                line_text: line.to_string(),
            });
        }
    }
    false
}

fn find_in_line(haystack: &str, needle: &str, case_insensitive: bool) -> Match {
    if needle.is_empty() {
        return Match::No;
    }
    let column = if case_insensitive {
        haystack
            .to_lowercase()
            .find(needle)
            .map(|i| (i + 1) as u32)
    } else {
        haystack.find(needle).map(|i| (i + 1) as u32)
    };
    match column {
        Some(c) => Match::Yes { column: c },
        None => Match::No,
    }
}

/// Lookup table for directory and file names to skip
/// during a workspace search. Built once per
/// `workspace_search` call from the default ignore
/// list plus the caller's `extra_ignores`.
struct IgnoreTable {
    names: Vec<String>,
}

impl IgnoreTable {
    fn new(defaults: &[&str], extra: &[String]) -> Self {
        let mut names: Vec<String> =
            defaults.iter().map(|s| s.to_string()).collect();
        for e in extra {
            if !e.is_empty() && !names.contains(e) {
                names.push(e.clone());
            }
        }
        IgnoreTable { names }
    }
    fn is_ignored(&self, name: &str) -> bool {
        // Exact-name match. Globs (e.g. `*.min.js`)
        // are not supported in v1 — adding them
        // would need a globset dep. The default
        // list is all exact names, so this is
        // enough for the common case.
        self.names.iter().any(|n| n == name)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::env::temp_dir;
    use std::fs;
    use std::time::SystemTime;

    fn unique_tmpdir(label: &str) -> PathBuf {
        let mut p = temp_dir();
        let nanos = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        p.push(format!("lipi-ws-search-test-{label}-{nanos}"));
        fs::create_dir_all(&p).unwrap();
        p
    }

    fn write(dir: &Path, rel: &str, content: &str) -> PathBuf {
        let full = dir.join(rel);
        if let Some(parent) = full.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(&full, content).unwrap();
        full
    }

    fn opts_for(root: &Path, query: &str) -> SearchOptions {
        SearchOptions {
            query: query.to_string(),
            root_path: root.to_string_lossy().into_owned(),
            extra_ignores: vec![],
            case_insensitive: false,
            max_results: None,
        }
    }

    #[test]
    fn empty_query_is_rejected() {
        let dir = unique_tmpdir("empty");
        let opts = SearchOptions {
            query: "".to_string(),
            root_path: dir.to_string_lossy().into_owned(),
            extra_ignores: vec![],
            case_insensitive: false,
            max_results: None,
        };
        let err = workspace_search(opts).unwrap_err();
        assert!(matches!(err, SearchError::InvalidQuery(_)));
        fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn nonexistent_root_returns_not_found() {
        let opts = SearchOptions {
            query: "x".to_string(),
            root_path: "Z:/this/does/not/exist/at/all".to_string(),
            extra_ignores: vec![],
            case_insensitive: false,
            max_results: None,
        };
        let err = workspace_search(opts).unwrap_err();
        assert!(matches!(err, SearchError::NotFound(_)));
    }

    #[test]
    fn file_root_returns_not_a_directory() {
        let dir = unique_tmpdir("file-root");
        let file = write(&dir, "a.txt", "x");
        let opts = SearchOptions {
            query: "x".to_string(),
            root_path: file.to_string_lossy().into_owned(),
            extra_ignores: vec![],
            case_insensitive: false,
            max_results: None,
        };
        let err = workspace_search(opts).unwrap_err();
        assert!(matches!(err, SearchError::NotADirectory(_)));
        fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn finds_match_in_single_file() {
        let dir = unique_tmpdir("single");
        write(&dir, "a.txt", "hello world\nfoo bar\n");
        let res = workspace_search(opts_for(&dir, "foo")).unwrap();
        assert_eq!(res.matches.len(), 1);
        assert_eq!(res.matches[0].line, 2);
        assert_eq!(res.matches[0].column, 1);
        assert_eq!(res.matches[0].line_text, "foo bar");
        assert_eq!(res.files_scanned, 1);
        assert!(!res.truncated);
        fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn walks_recursively() {
        let dir = unique_tmpdir("recurse");
        write(&dir, "a/b/c/deep.txt", "needle here\n");
        write(&dir, "top.txt", "no match\n");
        let res = workspace_search(opts_for(&dir, "needle")).unwrap();
        assert_eq!(res.matches.len(), 1);
        assert!(res.matches[0].path.ends_with("deep.txt"));
        assert_eq!(res.files_scanned, 2);
        fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn returns_multiple_matches_in_same_file() {
        let dir = unique_tmpdir("multi");
        write(&dir, "a.txt", "foo\nbar\nfoo\nbaz foo\n");
        let res = workspace_search(opts_for(&dir, "foo")).unwrap();
        assert_eq!(res.matches.len(), 3);
        // Lines are 1-based and in file order.
        assert_eq!(res.matches[0].line, 1);
        assert_eq!(res.matches[1].line, 3);
        assert_eq!(res.matches[2].line, 4);
        assert_eq!(res.matches[2].column, 5);
        fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn skips_default_ignored_directories() {
        let dir = unique_tmpdir("ignore");
        write(&dir, "node_modules/pkg/index.js", "needle");
        write(&dir, "src/a.js", "needle");
        let res = workspace_search(opts_for(&dir, "needle")).unwrap();
        // Only the src/ file should be scanned.
        assert_eq!(res.files_scanned, 1);
        assert_eq!(res.matches.len(), 1);
        assert!(res.matches[0].path.contains("src"));
        fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn honours_extra_ignores() {
        let dir = unique_tmpdir("extra-ignore");
        write(&dir, "build/x.txt", "needle");
        write(&dir, "src/x.txt", "needle");
        let mut opts = opts_for(&dir, "needle");
        opts.extra_ignores = vec!["build".to_string()];
        let res = workspace_search(opts).unwrap();
        assert_eq!(res.files_scanned, 1);
        fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn case_insensitive_finds_lowercase_needle_in_uppercase_text() {
        let dir = unique_tmpdir("case");
        write(&dir, "a.txt", "FOO\nfoo\nFoO\n");
        let mut opts = opts_for(&dir, "foo");
        opts.case_insensitive = true;
        let res = workspace_search(opts).unwrap();
        assert_eq!(res.matches.len(), 3);
        fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn case_sensitive_does_not_match_different_case() {
        let dir = unique_tmpdir("case-sensitive");
        write(&dir, "a.txt", "FOO\n");
        let res = workspace_search(opts_for(&dir, "foo")).unwrap();
        assert_eq!(res.matches.len(), 0);
        fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn skips_binary_files() {
        let dir = unique_tmpdir("binary");
        write(&dir, "a.txt", "needle");
        // Write the binary file directly —
        // our `write` helper takes a `&str`
        // (text files only). The NUL byte in
        // the middle of the byte string is
        // exactly what `looks_like_text`
        // uses to detect a binary file.
        let bin = dir.join("b.bin");
        fs::write(&bin, [0u8, b'n', b'e', b'e', 0u8, b'd', b'l', b'e']).unwrap();
        let res = workspace_search(opts_for(&dir, "needle")).unwrap();
        assert_eq!(res.matches.len(), 1);
        assert!(res.matches[0].path.ends_with("a.txt"));
        fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn skips_files_larger_than_max_read_bytes() {
        let dir = unique_tmpdir("large");
        write(&dir, "small.txt", "needle");
        // 6 MB file (above the 5 MB cap).
        let big = "x".repeat(6 * 1024 * 1024);
        write(&dir, "big.txt", &big);
        let res = workspace_search(opts_for(&dir, "needle")).unwrap();
        assert_eq!(res.matches.len(), 1);
        // big.txt is not scanned (size gate).
        assert!(res.files_scanned < 2);
        fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn max_results_caps_output_and_sets_truncated() {
        let dir = unique_tmpdir("max");
        let mut body = String::new();
        for i in 0..50 {
            body.push_str(&format!("hit line {i}\n"));
        }
        write(&dir, "a.txt", &body);
        let mut opts = opts_for(&dir, "hit");
        opts.max_results = Some(10);
        let res = workspace_search(opts).unwrap();
        assert_eq!(res.matches.len(), 10);
        assert!(res.truncated);
        fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn empty_workspace_returns_empty_result() {
        let dir = unique_tmpdir("empty-ws");
        let res = workspace_search(opts_for(&dir, "anything")).unwrap();
        assert_eq!(res.matches.len(), 0);
        assert_eq!(res.files_scanned, 0);
        assert!(!res.truncated);
        fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn search_match_serialises_to_camel_case_wire_shape() {
        let m = SearchMatch {
            path: "/a/b.txt".to_string(),
            line: 7,
            column: 3,
            line_text: "hello".to_string(),
        };
        let j = serde_json::to_string(&m).unwrap();
        assert!(j.contains("\"path\":\"/a/b.txt\""));
        assert!(j.contains("\"line\":7"));
        assert!(j.contains("\"column\":3"));
        assert!(j.contains("\"lineText\":\"hello\""));
    }
}
