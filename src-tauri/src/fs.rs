//! Lipi — Virtual filesystem (Phase 2a).
//!
//! Owns the read/write/open-folder surface that the React frontend calls
//! through `invoke()`. Pure stdlib + small helpers — no LSP, no watcher
//! yet (D2 may add `notify` for live updates, that's a later concern).
//!
//! Contract with the frontend (see `src/ipc/fs.ts`):
//!
//!   read_dir({ path: string })                    -> FsEntry[]
//!   read_file({ path: string })                   -> FileContent
//!   write_file({ path: string, content: string }) -> ()
//!   pick_folder()                                 -> string | null
//!
//! All commands are sync on the Rust side (no async needed for the
//! sizes we care about). Tauri runs them on its async runtime.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use serde::Serialize;
use thiserror::Error;

/// Maximum file size we will read into Monaco. 5 MB is well above any
/// human-editable source file and keeps the IPC payload bounded.
pub const MAX_READ_BYTES: u64 = 5 * 1024 * 1024;

/// Heuristic for "is this probably text?". We keep it simple: reject
/// any file that has a NUL byte in the first 8 KB. Sufficient for a
/// first cut; future phases may swap in `content_inspector` or similar.
const TEXT_PROBE_BYTES: usize = 8 * 1024;

#[derive(Debug, Error, Serialize)]
#[serde(tag = "kind", content = "detail")]
pub enum FsError {
    #[error("path not found: {0}")]
    NotFound(String),
    #[error("permission denied: {0}")]
    PermissionDenied(String),
    #[error("not a directory: {0}")]
    NotADirectory(String),
    #[error("not a file: {0}")]
    NotAFile(String),
    #[error("file too large: {0} bytes (max {MAX_READ_BYTES} bytes)")]
    TooLarge(u64),
    #[error("io error: {0}")]
    Io(String),
}

impl From<std::io::Error> for FsError {
    fn from(err: std::io::Error) -> Self {
        use std::io::ErrorKind;
        match err.kind() {
            ErrorKind::NotFound => FsError::NotFound(err.to_string()),
            ErrorKind::PermissionDenied => FsError::PermissionDenied(err.to_string()),
            _ => FsError::Io(err.to_string()),
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FsEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
    pub modified_ms: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileContent {
    pub content: String,
    pub encoding: FileEncoding,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum FileEncoding {
    Utf8,
    Binary,
}

/// List the immediate children of a directory, sorted: directories
/// first, then files, both alphabetically (case-insensitive).
pub fn read_dir(path: &Path) -> Result<Vec<FsEntry>, FsError> {
    let meta = fs::metadata(path).map_err(|err| match err.kind() {
        std::io::ErrorKind::NotFound => FsError::NotFound(path.display().to_string()),
        std::io::ErrorKind::PermissionDenied => {
            FsError::PermissionDenied(path.display().to_string())
        }
        _ => FsError::Io(err.to_string()),
    })?;
    if !meta.is_dir() {
        return Err(FsError::NotADirectory(path.display().to_string()));
    }

    let mut out = Vec::new();
    for entry in fs::read_dir(path)? {
        let entry = entry?;
        let entry_path = entry.path();
        let entry_meta = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue, // skip unreadable entries silently
        };
        let modified_ms = entry_meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        let name = entry.file_name().to_string_lossy().to_string();
        out.push(FsEntry {
            name,
            path: entry_path.display().to_string(),
            is_dir: entry_meta.is_dir(),
            size: entry_meta.len(),
            modified_ms,
        });
    }

    out.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });
    Ok(out)
}

/// Read a file and decide whether it's text. Files larger than
/// `MAX_READ_BYTES` are rejected with `FsError::TooLarge`.
pub fn read_file(path: &Path) -> Result<FileContent, FsError> {
    let meta = fs::metadata(path).map_err(|err| match err.kind() {
        std::io::ErrorKind::NotFound => FsError::NotFound(path.display().to_string()),
        std::io::ErrorKind::PermissionDenied => {
            FsError::PermissionDenied(path.display().to_string())
        }
        _ => FsError::Io(err.to_string()),
    })?;
    if !meta.is_file() {
        return Err(FsError::NotAFile(path.display().to_string()));
    }
    if meta.len() > MAX_READ_BYTES {
        return Err(FsError::TooLarge(meta.len()));
    }

    let bytes = fs::read(path)?;
    let encoding = if looks_like_text(&bytes) {
        FileEncoding::Utf8
    } else {
        FileEncoding::Binary
    };
    // We only return Utf8 for now; Binary content is exposed so the
    // frontend can show a "binary file" placeholder instead of trying
    // to render it in Monaco.
    let content = match encoding {
        FileEncoding::Utf8 => String::from_utf8_lossy(&bytes).into_owned(),
        FileEncoding::Binary => String::new(),
    };
    Ok(FileContent { content, encoding })
}

/// Atomically write a file: write to `<path>.tmp`, fsync, rename.
/// Reduces the chance of a half-written file if Lipi is killed mid-save.
pub fn write_file(path: &Path, content: &str) -> Result<(), FsError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let tmp = tmp_path(path);
    {
        let mut f = fs::File::create(&tmp)?;
        f.write_all(content.as_bytes())?;
        f.sync_all()?;
    }
    // On Windows, rename refuses to overwrite. Remove the dest first.
    #[cfg(windows)]
    {
        if path.exists() {
            fs::remove_file(path)?;
        }
    }
    fs::rename(&tmp, path)?;
    Ok(())
}

fn tmp_path(p: &Path) -> PathBuf {
    let mut s = p.as_os_str().to_owned();
    s.push(".tmp");
    PathBuf::from(s)
}

fn looks_like_text(bytes: &[u8]) -> bool {
    let probe = &bytes[..bytes.len().min(TEXT_PROBE_BYTES)];
    !probe.contains(&0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::env::temp_dir;

    fn unique_tmpdir(label: &str) -> PathBuf {
        let mut p = temp_dir();
        let nanos = std::time::SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        p.push(format!("lipi-test-{label}-{nanos}"));
        fs::create_dir_all(&p).unwrap();
        p
    }

    #[test]
    fn read_dir_sorts_dirs_first_and_files_alphabetically() {
        let dir = unique_tmpdir("readdir");
        fs::write(dir.join("b.txt"), "b").unwrap();
        fs::create_dir(dir.join("a-dir")).unwrap();
        fs::write(dir.join("a.txt"), "a").unwrap();
        let entries = read_dir(&dir).unwrap();
        assert_eq!(entries[0].name, "a-dir");
        assert!(entries[0].is_dir);
        assert_eq!(entries[1].name, "a.txt");
        assert_eq!(entries[2].name, "b.txt");
        fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn read_dir_rejects_missing_path() {
        let err = read_dir(Path::new("Z:/this/does/not/exist/at/all")).unwrap_err();
        assert!(matches!(err, FsError::NotFound(_)));
    }

    #[test]
    fn read_dir_rejects_file_as_dir() {
        let dir = unique_tmpdir("file-as-dir");
        let file = dir.join("not-a-dir.txt");
        fs::write(&file, "x").unwrap();
        let err = read_dir(&file).unwrap_err();
        assert!(matches!(err, FsError::NotADirectory(_)));
        fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn read_file_returns_utf8_for_text() {
        let dir = unique_tmpdir("utf8");
        let file = dir.join("hello.txt");
        fs::write(&file, "héllo, world").unwrap();
        let c = read_file(&file).unwrap();
        assert!(matches!(c.encoding, FileEncoding::Utf8));
        assert_eq!(c.content, "héllo, world");
        fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn read_file_marks_binary_for_nul_bytes() {
        let dir = unique_tmpdir("binary");
        let file = dir.join("blob.bin");
        fs::write(&file, [0u8, 1, 2, 3, 0, 0, 0]).unwrap();
        let c = read_file(&file).unwrap();
        assert!(matches!(c.encoding, FileEncoding::Binary));
        assert!(c.content.is_empty());
        fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn write_file_creates_and_overwrites() {
        let dir = unique_tmpdir("write");
        let file = dir.join("out.txt");
        write_file(&file, "first").unwrap();
        assert_eq!(fs::read_to_string(&file).unwrap(), "first");
        write_file(&file, "second").unwrap();
        assert_eq!(fs::read_to_string(&file).unwrap(), "second");
        fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn write_file_creates_missing_parent_dirs() {
        let dir = unique_tmpdir("nested");
        let file = dir.join("a/b/c.txt");
        write_file(&file, "deep").unwrap();
        assert_eq!(fs::read_to_string(&file).unwrap(), "deep");
        fs::remove_dir_all(dir).ok();
    }
}
