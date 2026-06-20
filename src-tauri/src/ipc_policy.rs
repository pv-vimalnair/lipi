use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::Manager;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IpcAuditEvent<'a> {
    pub action: &'a str,
    pub outcome: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subject: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub workspace_root: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<&'a str>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct IpcAuditRecord<'a> {
    timestamp_ms: u128,
    action: &'a str,
    outcome: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    subject: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    workspace_root: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    detail: Option<&'a str>,
}

pub fn audit(app: &tauri::AppHandle, event: IpcAuditEvent<'_>) {
    if let Err(e) = write_audit_record(app, event) {
        log::warn!("failed to write IPC audit event: {e}");
    }
}

fn write_audit_record(app: &tauri::AppHandle, event: IpcAuditEvent<'_>) -> Result<(), String> {
    let dir = app.path().app_local_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join("ipc-audit.jsonl");
    let timestamp_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis();
    let record = IpcAuditRecord {
        timestamp_ms,
        action: event.action,
        outcome: event.outcome,
        subject: event.subject,
        workspace_root: event.workspace_root,
        detail: event.detail,
    };
    let line = serde_json::to_string(&record).map_err(|e| e.to_string())?;
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(|e| e.to_string())?;
    writeln!(file, "{line}").map_err(|e| e.to_string())
}

pub fn canonicalize_workspace_root(raw: &str) -> Result<PathBuf, String> {
    if raw.trim().is_empty() {
        return Err("workspace root is required".to_string());
    }
    let path = PathBuf::from(raw);
    if !path.is_absolute() {
        return Err("workspace root must be absolute".to_string());
    }
    let canonical = fs::canonicalize(&path)
        .map_err(|e| format!("workspace root `{raw}` is not accessible: {e}"))?;
    if !canonical.is_dir() {
        return Err(format!("workspace root `{raw}` is not a directory"));
    }
    Ok(canonical)
}

pub fn canonicalize_workspace_child(
    workspace_root: &Path,
    raw_path: &str,
    label: &str,
) -> Result<PathBuf, String> {
    if raw_path.trim().is_empty() {
        return Err(format!("{label} is required"));
    }
    let path = PathBuf::from(raw_path);
    if !path.is_absolute() {
        return Err(format!("{label} must be absolute"));
    }
    let canonical = fs::canonicalize(&path)
        .map_err(|e| format!("{label} `{raw_path}` is not accessible: {e}"))?;
    if !canonical.is_dir() {
        return Err(format!("{label} `{raw_path}` is not a directory"));
    }
    if canonical != workspace_root && !canonical.starts_with(workspace_root) {
        return Err(format!("{label} must be inside the active workspace"));
    }
    Ok(canonical)
}

pub fn is_shell_interpreter(program: &str) -> bool {
    let normalized = program
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or(program)
        .trim()
        .trim_end_matches(".exe")
        .trim_end_matches(".cmd")
        .trim_end_matches(".bat")
        .to_ascii_lowercase();
    matches!(
        normalized.as_str(),
        "cmd" | "powershell" | "pwsh" | "sh" | "bash" | "zsh" | "fish"
    )
}

pub fn validate_custom_shell_policy(
    program: &str,
    cwd: Option<&str>,
    workspace_root: &str,
) -> Result<PathBuf, String> {
    if program.trim().is_empty() {
        return Err("program is required".to_string());
    }
    if is_shell_interpreter(program) {
        return Err(format!(
            "`{program}` is a shell; configure a direct executable command instead"
        ));
    }
    let root = canonicalize_workspace_root(workspace_root)?;
    let cwd = cwd.ok_or_else(|| {
        "cwd must be set to the active workspace or a child directory".to_string()
    })?;
    canonicalize_workspace_child(&root, cwd, "cwd")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn shell_interpreter_detection_handles_paths_and_extensions() {
        assert!(is_shell_interpreter("powershell.exe"));
        assert!(is_shell_interpreter(r"C:\Windows\System32\cmd.exe"));
        assert!(is_shell_interpreter("/bin/bash"));
        assert!(!is_shell_interpreter("npm"));
        assert!(!is_shell_interpreter("git"));
    }

    #[test]
    fn custom_shell_policy_requires_workspace_child_cwd() {
        let root = std::env::temp_dir().join(format!(
            "lipi-policy-root-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let child = root.join("pkg");
        fs::create_dir_all(&child).unwrap();
        let outside = std::env::temp_dir();

        let accepted = validate_custom_shell_policy(
            "npm",
            Some(&child.to_string_lossy()),
            &root.to_string_lossy(),
        )
        .unwrap();
        assert_eq!(accepted, fs::canonicalize(&child).unwrap());

        let rejected = validate_custom_shell_policy(
            "npm",
            Some(&outside.to_string_lossy()),
            &root.to_string_lossy(),
        )
        .unwrap_err();
        assert!(rejected.contains("inside the active workspace"));

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn custom_shell_policy_rejects_interpreters() {
        let root = std::env::temp_dir();
        let err = validate_custom_shell_policy(
            "powershell",
            Some(&root.to_string_lossy()),
            &root.to_string_lossy(),
        )
        .unwrap_err();
        assert!(err.contains("shell"));
    }
}
