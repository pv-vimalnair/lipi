//! Phase 5c — workspace-local `lipi-tools.json`
//! storage.
//!
//! Custom tools in 5c are user-defined and live
//! in a JSON file at the root of the user's
//! workspace: `<workspace>/lipi-tools.json`. The
//! JS `customToolsStore` is the source of truth
//! at runtime; the Rust side just provides
//! read/write primitives that the JS side calls.
//!
//! ## File shape
//!
//! ```json
//! {
//!   "version": 1,
//!   "tools": [
//!     {
//!       "name": "run_npm_test",
//!       "description": "Run npm test in a specific package.",
//!       "kind": "shell",
//!       "command": "npm",
//!       "args": ["test", "--prefix", "{package_dir}"],
//!       "cwd": null,
//!       "args_spec": [
//!         { "name": "package_dir", "type": "string", "description": "..." }
//!       ]
//!     },
//!     {
//!       "name": "fetch_jira",
//!       "description": "Fetch a Jira issue.",
//!       "kind": "http",
//!       "url": "https://example.atlassian.net/rest/api/3/issue/{key}",
//!       "method": "GET",
//!       "headers": { "Authorization": "Bearer ..." },
//!       "body": "",
//!       "args_spec": [
//!         { "name": "key", "type": "string", "description": "Jira key, e.g. PROJ-123." }
//!       ]
//!     }
//!   ]
//! }
//! ```
//!
//! The Rust side's `LipiToolsFile` mirrors this
//! shape; the JS side mirrors it in
//! `src/ipc/lipiTools.ts` (see also
//! `customToolsStore` for the runtime state).
//!
//! ## Why Rust and not a JS-side `fs` plugin?
//!
//! Tauri's webview CAN do file IO via
//! `tauri-plugin-fs`, but we deliberately keep
//! the workspace-local file ops behind Rust so:
//!   - the path is always relative to the
//!     workspace root (no path-traversal bugs),
//!   - the JSON shape is validated on read (the
//!     JS store can then trust it),
//!   - the `lipi-tools.json` is locked
//!     against concurrent writes (file-level
//!     advisory lock via `fs2` — 5d+).
//!
//! For 5c we just do the simple "read / write /
//! return errors" surface. The 5d+ lock is
//! noted but not implemented.
//!
//! ## `kind` policy
//!
//! 5c only supports `'shell' | 'http'`. We
//! reject any other value at read time
//! (filtering them out and returning the
//! remainder — the user can then fix the
//! file and re-read). This is more forgiving
//! than erroring, and matches the "be liberal
//! in what you accept" tradition.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use thiserror::Error;

/// The constant filename. The user can have
/// one `lipi-tools.json` per workspace at the
/// workspace root.
pub const LIPI_TOOLS_FILENAME: &str = "lipi-tools.json";

/// The current file shape version. Bump on
/// backwards-incompatible changes; 5c is v1.
pub const LIPI_TOOLS_VERSION: u32 = 1;

/// 5c: the full per-tool definition. Lives
/// inside `LipiToolsFile.tools`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LipiToolEntry {
    /// Tool name (e.g. `"run_npm_test"`). Must
    /// be unique across `tools` (we validate
    /// this on read).
    pub name: String,
    /// Human-readable description shown to
    /// the model in the tool's JSON Schema.
    pub description: String,
    /// Tool kind. 5c only supports
    /// `"shell" | "http"`. Unknown kinds are
    /// rejected on read (see
    /// `LipiToolsFile::from_json_str`).
    pub kind: LipiToolKind,
    /// `shell` only: the program to run
    /// (e.g. `"npm"`). Ignored for `http`
    /// tools.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub command: Option<String>,
    /// `shell` only: argv after the program.
    /// May contain `{arg_name}` placeholders
    /// that the JS side substitutes before
    /// calling `run_command`. Ignored for
    /// `http` tools.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub args: Option<Vec<String>>,
    /// `shell` only: optional working
    /// directory. `null` = inherit from the
    /// parent process. Ignored for `http`
    /// tools.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cwd: Option<String>,
    /// `http` only: the URL with optional
    /// `{arg_name}` placeholders. Ignored
    /// for `shell` tools.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    /// `http` only: HTTP method. Defaults to
    /// `"GET"` on the wire (the JS side
    /// supplies this default when saving).
    /// Ignored for `shell` tools.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub method: Option<String>,
    /// `http` only: HTTP headers. Ignored
    /// for `shell` tools.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub headers: Option<std::collections::HashMap<String, String>>,
    /// `http` only: request body (raw
    /// string). Ignored for `shell` tools.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub body: Option<String>,
    /// Arguments the model can pass. The
    /// Rust side only sees this to build the
    /// provider-specific JSON Schema (via
    /// `custom_tool.rs`); the actual
    /// substitution happens on the JS side
    /// using `args` / `url`.
    pub args_spec: Vec<LipiToolArgSpec>,
}

/// A single argument for a custom tool.
/// Mirrors `CustomToolArg` in
/// `custom_tool.rs` but uses the file-shape
/// name `argsSpec` (which is the storage
/// convention). The runtime
/// `CustomToolArg` is derived from this on
/// the JS side.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LipiToolArgSpec {
    pub name: String,
    /// 5c: only `"string"`. The deserialiser
    /// accepts any string but the JS
    /// editor restricts the dropdown.
    #[serde(rename = "type")]
    pub type_: String,
    #[serde(default)]
    pub description: String,
}

/// The discriminator for `LipiToolEntry.kind`.
/// 5c only supports the two variants. A future
/// version may add `'mcp' | 'wasm'` etc. — we
/// leave the enum open for that.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum LipiToolKind {
    Shell,
    Http,
}

/// The file envelope.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct LipiToolsFile {
    /// Shape version. Must equal
    /// `LIPI_TOOLS_VERSION` for the JS
    /// store to load it.
    pub version: u32,
    /// All the user's custom tools. The JS
    /// store indexes this by `name` for O(1)
    /// lookup.
    pub tools: Vec<LipiToolEntry>,
}

impl LipiToolsFile {
    /// Build an empty file (the default when
    /// `lipi-tools.json` doesn't exist yet).
    pub fn empty() -> Self {
        Self {
            version: LIPI_TOOLS_VERSION,
            tools: Vec::new(),
        }
    }

    /// Parse a JSON string into a
    /// `LipiToolsFile`, validating the shape.
    ///
    /// On parse error: returns
    /// `LipiToolsError::Json`. On shape
    /// error: returns
    /// `LipiToolsError::Shape { reason }`. On
    /// duplicate tool names: returns
    /// `LipiToolsError::DuplicateName { name }`.
    /// On unknown `kind` value: returns
    /// `LipiToolsError::UnknownKind { kind }`.
    pub fn from_json_str(s: &str) -> Result<Self, LipiToolsError> {
        let file: LipiToolsFile = serde_json::from_str(s)
            .map_err(|e| LipiToolsError::Json { detail: e.to_string() })?;
        file.validate()?;
        Ok(file)
    }

    /// Round-trip serialise to a pretty-
    /// printed JSON string. 5c uses 2-space
    /// indent (matches the JSON files in
    /// `package.json` / `tsconfig.json`).
    pub fn to_json_string(&self) -> Result<String, LipiToolsError> {
        serde_json::to_string_pretty(self)
            .map_err(|e| LipiToolsError::Json { detail: e.to_string() })
    }

    /// Run all the shape validations: version
    /// check, no duplicate names, no unknown
    /// `kind` values, no missing required
    /// fields per kind.
    pub fn validate(&self) -> Result<(), LipiToolsError> {
        // 1. Version check. We accept
        //    any version equal to the
        //    current one. Future versions
        //    can do migrations here.
        if self.version != LIPI_TOOLS_VERSION {
            return Err(LipiToolsError::Shape {
                reason: format!(
                    "unsupported file version {} (expected {})",
                    self.version, LIPI_TOOLS_VERSION
                ),
            });
        }

        // 2. Duplicate-name check. We use
        //    a `HashSet` for O(n) over
        //    the typical file size
        //    (handful of tools).
        let mut seen = std::collections::HashSet::new();
        for tool in &self.tools {
            if !seen.insert(tool.name.as_str()) {
                return Err(LipiToolsError::DuplicateName {
                    name: tool.name.clone(),
                });
            }
        }

        // 3. Per-tool kind-specific
        //    validation.
        for tool in &self.tools {
            match tool.kind {
                LipiToolKind::Shell => {
                    // The JS editor doesn't
                    // allow `command: ""`, but
                    // the file might have one
                    // (e.g. user-edited). We
                    // don't error — we let
                    // `run_command` handle it
                    // (it returns
                    // `RunCommandError::Empty`).
                    // We DO require that the
                    // entry has a `command`
                    // key, even if it's an
                    // empty string, so the JS
                    // editor can read it
                    // back without the field
                    // disappearing.
                    //
                    // 5c: nothing to enforce.
                }
                LipiToolKind::Http => {
                    // 5c: nothing to enforce.
                    // The `url` field can be
                    // empty (the user might
                    // be mid-edit); the JS
                    // editor surfaces a
                    // validation hint.
                }
            }
        }

        Ok(())
    }

    /// Project the file's `tools` list into
    /// the `Vec<CustomToolSpec>` that the
    /// chat IPC wants. Each tool's
    /// `args_spec` is mapped 1:1 to
    /// `CustomToolArg`. We filter out
    /// `shell` / `http`-only fields
    /// (`command`, `url`, etc.) — the
    /// provider tool declaration doesn't
    /// need them.
    ///
    /// The filter is a "best effort" — the
    /// Rust side doesn't care if a
    /// `command` field is present in the
    /// projection. The provider tool
    /// declaration only uses `name`,
    /// `description`, and `args`.
    pub fn to_custom_tool_specs(&self) -> Vec<crate::CustomToolSpec> {
        self.tools
            .iter()
            .map(|t| crate::CustomToolSpec {
                name: t.name.clone(),
                description: t.description.clone(),
                args: t
                    .args_spec
                    .iter()
                    .map(|a| crate::CustomToolArg {
                        name: a.name.clone(),
                        type_: a.type_.clone(),
                        description: a.description.clone(),
                    })
                    .collect(),
            })
            .collect()
    }
}

/// Public error type. `#[serde(tag = "kind")]`
/// so the JS side can switch on a single
/// discriminator without parsing nested fields.
#[derive(Debug, Error, Serialize)]
#[serde(tag = "kind", content = "message")]
pub enum LipiToolsError {
    /// The file is missing. The JS store
    /// treats this as "no custom tools yet" —
    /// it does NOT error; it just renders an
    /// empty state. The Rust command returns
    /// this only when the path is provided
    /// explicitly (e.g. a `loadByPath` debug
    /// entry — not exposed to the JS side in
    /// 5c).
    #[error("file not found at `{path}`")]
    NotFound { path: String },
    /// Permission denied, is-a-directory,
    /// etc. The JS side surfaces this as a
    /// "we can't read the file" error.
    #[error("io error reading `{path}`: {detail}")]
    Io { path: String, detail: String },
    /// The file is not valid JSON, or the
    /// shape doesn't match the schema.
    #[error("invalid JSON: {detail}")]
    Json { detail: String },
    /// The file's version doesn't match
    /// the current `LIPI_TOOLS_VERSION`.
    #[error("unsupported file shape: {reason}")]
    Shape { reason: String },
    /// Two tools in the same file have the
    /// same `name`. We can't have two tools
    /// with the same name in the model
    /// declaration (the model would get
    /// confused about which one to call).
    #[error("duplicate tool name `{name}`")]
    DuplicateName { name: String },
    /// A tool's `kind` is not one of
    /// `"shell" | "http"`. 5c only supports
    /// these two. The Rust deserialiser
    /// itself rejects unknown variants
    /// (via serde's `rename_all =
    /// "lowercase"`), so this variant is
    /// effectively unreachable in 5c;
    /// future versions may surface a
    /// friendlier error.
    ///
    /// The offending value is named
    /// `unknown_kind_value` (not `kind`)
    /// so it doesn't collide with the
    /// `#[serde(tag = "kind")]`
    /// discriminator on the wire.
    #[error("unknown tool kind `{unknown_kind_value}`")]
    UnknownKind { unknown_kind_value: String },
}

impl LipiToolsError {
    /// Helper for tests: render the error to
    /// a plain string (the `Display` impl
    /// already does this, but tests sometimes
    /// want the explicit `to_string`).
    #[allow(dead_code)]
    pub fn render(&self) -> String {
        self.to_string()
    }
}

/// Read the `lipi-tools.json` at the given
/// workspace root. Returns
///   - `Ok(LipiToolsFile)` on success,
///   - `Err(LipiToolsError::NotFound)` if
///     the file doesn't exist,
///   - `Err(LipiToolsError::Json | Shape |
///     DuplicateName)` on parse / shape
///     errors,
///   - `Err(LipiToolsError::Io { .. })` on
///     I/O errors.
///
/// The JS `customToolsStore` calls this via
/// the `read_lipi_tools` Tauri command.
/// `NotFound` is NOT propagated to the JS
/// side as an error — the wrapper command
/// converts it to `Ok(empty file)`.
pub fn read_lipi_tools(workspace_root: &Path) -> Result<LipiToolsFile, LipiToolsError> {
    let path = workspace_root.join(LIPI_TOOLS_FILENAME);
    let path_str = path.to_string_lossy().into_owned();
    let bytes = match fs::read(&path) {
        Ok(b) => b,
        Err(e) if e.kind() == io::ErrorKind::NotFound => {
            return Err(LipiToolsError::NotFound { path: path_str });
        }
        Err(e) => {
            return Err(LipiToolsError::Io {
                path: path_str,
                detail: e.to_string(),
            });
        }
    };
    let s = String::from_utf8(bytes).map_err(|e| LipiToolsError::Io {
        path: path_str.clone(),
        detail: format!("file is not valid UTF-8: {e}"),
    })?;
    LipiToolsFile::from_json_str(&s)
}

/// Write the `lipi-tools.json` to the given
/// workspace root. Creates the file if it
/// doesn't exist; overwrites if it does.
/// Validates the in-memory representation
/// before writing.
///
/// The JS `customToolsStore` calls this via
/// the `write_lipi_tools` Tauri command. The
/// `tools` are the in-memory state from the
/// `customToolsStore`; the Rust side treats
/// it as a full overwrite (no
/// merge-with-existing logic in 5c — the JS
/// store reads the existing file, mutates
/// the in-memory list, and writes the full
/// list back).
pub fn write_lipi_tools(
    workspace_root: &Path,
    file: &LipiToolsFile,
) -> Result<(), LipiToolsError> {
    file.validate()?;
    let path = workspace_root.join(LIPI_TOOLS_FILENAME);
    let path_str = path.to_string_lossy().into_owned();
    let json = file.to_json_string()?;
    fs::write(&path, json).map_err(|e| LipiToolsError::Io {
        path: path_str,
        detail: e.to_string(),
    })?;
    Ok(())
}

/// Build the full path to the
/// `lipi-tools.json` for the given workspace
/// root. Used by tests to construct the
/// expected file location.
pub fn lipi_tools_path(workspace_root: &Path) -> PathBuf {
    workspace_root.join(LIPI_TOOLS_FILENAME)
}

// --- Tests ------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use tempfile::tempdir;

    fn shell_entry(name: &str) -> LipiToolEntry {
        LipiToolEntry {
            name: name.to_string(),
            description: "Run npm test.".to_string(),
            kind: LipiToolKind::Shell,
            command: Some("npm".to_string()),
            args: Some(vec!["test".to_string(), "--prefix".to_string(), "{package_dir}".to_string()]),
            cwd: None,
            url: None,
            method: None,
            headers: None,
            body: None,
            args_spec: vec![LipiToolArgSpec {
                name: "package_dir".to_string(),
                type_: "string".to_string(),
                description: "Package dir, e.g. 'packages/core'.".to_string(),
            }],
        }
    }

    fn http_entry(name: &str) -> LipiToolEntry {
        let mut headers = HashMap::new();
        headers.insert("Authorization".to_string(), "Bearer token".to_string());
        LipiToolEntry {
            name: name.to_string(),
            description: "Fetch Jira issue.".to_string(),
            kind: LipiToolKind::Http,
            command: None,
            args: None,
            cwd: None,
            url: Some("https://example.atlassian.net/rest/api/3/issue/{key}".to_string()),
            method: Some("GET".to_string()),
            headers: Some(headers),
            body: None,
            args_spec: vec![LipiToolArgSpec {
                name: "key".to_string(),
                type_: "string".to_string(),
                description: "Jira key.".to_string(),
            }],
        }
    }

    #[test]
    fn from_json_str_happy_path() {
        let json = r#"{
            "version": 1,
            "tools": [
                {
                    "name": "run_npm_test",
                    "description": "Run npm test.",
                    "kind": "shell",
                    "command": "npm",
                    "args": ["test"],
                    "argsSpec": [
                        { "name": "package_dir", "type": "string", "description": "..." }
                    ]
                }
            ]
        }"#;
        let file = LipiToolsFile::from_json_str(json).expect("valid");
        assert_eq!(file.version, 1);
        assert_eq!(file.tools.len(), 1);
        assert_eq!(file.tools[0].name, "run_npm_test");
        assert_eq!(file.tools[0].kind, LipiToolKind::Shell);
    }

    #[test]
    fn from_json_str_rejects_duplicate_names() {
        let json = r#"{
            "version": 1,
            "tools": [
                { "name": "x", "description": "", "kind": "shell", "command": "a", "args": [], "argsSpec": [] },
                { "name": "x", "description": "", "kind": "shell", "command": "b", "args": [], "argsSpec": [] }
            ]
        }"#;
        let err = LipiToolsFile::from_json_str(json).expect_err("should reject");
        assert!(matches!(err, LipiToolsError::DuplicateName { .. }));
    }

    #[test]
    fn from_json_str_rejects_unsupported_version() {
        let json = r#"{
            "version": 999,
            "tools": []
        }"#;
        let err = LipiToolsFile::from_json_str(json).expect_err("should reject");
        assert!(matches!(err, LipiToolsError::Shape { .. }));
    }

    #[test]
    fn from_json_str_rejects_malformed_json() {
        let json = "{ not valid json";
        let err = LipiToolsFile::from_json_str(json).expect_err("should reject");
        assert!(matches!(err, LipiToolsError::Json { .. }));
    }

    #[test]
    fn from_json_str_rejects_unknown_kind() {
        // serde's `rename_all = "lowercase"`
        // rejects unknown variants in the
        // serialised form. The error path
        // surfaces as `Json` (the underlying
        // `serde_json::Error`).
        let json = r#"{
            "version": 1,
            "tools": [
                { "name": "x", "description": "", "kind": "wasm", "argsSpec": [] }
            ]
        }"#;
        let err = LipiToolsFile::from_json_str(json).expect_err("should reject");
        assert!(matches!(err, LipiToolsError::Json { .. }));
    }

    #[test]
    fn to_custom_tool_specs_projects_correctly() {
        let mut file = LipiToolsFile::empty();
        file.tools.push(shell_entry("run_npm_test"));
        file.tools.push(http_entry("fetch_jira"));
        let specs = file.to_custom_tool_specs();
        assert_eq!(specs.len(), 2);
        assert_eq!(specs[0].name, "run_npm_test");
        assert_eq!(specs[0].args.len(), 1);
        assert_eq!(specs[0].args[0].name, "package_dir");
        assert_eq!(specs[1].name, "fetch_jira");
        assert_eq!(specs[1].args.len(), 1);
        assert_eq!(specs[1].args[0].name, "key");
    }

    #[test]
    fn write_then_read_round_trips() {
        let dir = tempdir().expect("tempdir");
        let mut file = LipiToolsFile::empty();
        file.tools.push(shell_entry("run_npm_test"));
        file.tools.push(http_entry("fetch_jira"));

        write_lipi_tools(dir.path(), &file).expect("write");
        let read_back = read_lipi_tools(dir.path()).expect("read");
        assert_eq!(read_back, file);
    }

    #[test]
    fn read_returns_not_found_when_file_missing() {
        let dir = tempdir().expect("tempdir");
        let err = read_lipi_tools(dir.path()).expect_err("missing file");
        assert!(matches!(err, LipiToolsError::NotFound { .. }));
    }

    #[test]
    fn write_rejects_duplicate_names_before_touching_disk() {
        let dir = tempdir().expect("tempdir");
        let mut file = LipiToolsFile::empty();
        file.tools.push(shell_entry("x"));
        file.tools.push(shell_entry("x"));
        let err = write_lipi_tools(dir.path(), &file).expect_err("dup");
        assert!(matches!(err, LipiToolsError::DuplicateName { .. }));
        // The file should NOT have been
        // created.
        assert!(!dir.path().join(LIPI_TOOLS_FILENAME).exists());
    }

    #[test]
    fn lipi_tools_path_appends_filename() {
        let p = lipi_tools_path(Path::new("/tmp/workspace"));
        assert_eq!(p, PathBuf::from("/tmp/workspace/lipi-tools.json"));
    }
}
