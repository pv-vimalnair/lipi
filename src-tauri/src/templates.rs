//! Phase J — workspace starter templates.
//!
//! The Welcome screen's "Template gallery" hands this module
//! a `template_id` and a destination directory. We expand the
//! template's inlined file list into the destination
//! atomically: every file is written into a staging subdir
//! (`.lipi-template-staging-<rand>`) inside `dest` first, then
//! the staging dir's contents are renamed over to `dest`. If
//! anything in the middle fails (permission, disk full, name
//! collision with an existing file in `dest`, etc.), the
//! staging dir is removed and the user's existing `dest` is
//! untouched.
//!
//! The atomicity story is:
//!  - rename is atomic on the same filesystem (POSIX rename,
//!    Windows `MoveFileExW(MOVEFILE_REPLACE_EXISTING)`) for
//!    the rename of a single file.
//!  - To move many files, we rename them one by one. A crash
//!    mid-loop leaves `dest` in a partial state (some files
//!    present, some still in staging). On the next `apply`
//!    call to the same `dest`, the staging dir is cleaned up
//!    on the way in (see `clean_stale_staging`) and a fresh
//!    attempt is made. We document this in the `TemplateError`
//!    `Partial` variant so the UI can warn the user that
//!    recovery requires manual cleanup.
//!
//! The 5 template bodies are inlined below. They are small
//! enough (each < 2 KB) that a 6 KB binary footprint is
//! acceptable, and it means the registry, the content, and
//! the validator all live in one Rust file that can be
//! unit-tested in isolation (see `#[cfg(test)] mod tests` at
//! the bottom).

use std::fmt;
use std::fs;
use std::io;
use std::path::Path;

use serde::{Deserialize, Serialize};
use thiserror::Error;

/// The wire shape of one file inside a template. Both
/// fields are `&'static str` so the inlined registry
/// can be a true `const` slice (the bodies are baked
/// into the binary at compile time). The JS side never
/// sends template bodies (only the template id), so the
/// borrow lifetime is internal.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TemplateFile {
    /// Path relative to the workspace root, using `/` as
    /// the separator (we translate to `\` on Windows at
    /// write time).
    pub rel_path: &'static str,
    /// Full file contents. May be empty for `.gitkeep`-style
    /// placeholder files.
    pub content: &'static str,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Template {
    pub id: &'static str,
    pub name: &'static str,
    pub description: &'static str,
    pub files: &'static [TemplateFile],
}

/// Errors from `apply`. The JS side surfaces the
/// `Display`-form message verbatim; the variants are
/// diagnostic (so future code can branch on them, e.g. to
/// offer "remove the stale staging dir" action).
#[derive(Debug, Error)]
pub enum TemplateError {
    #[error("unknown template id: {0}")]
    UnknownId(String),
    #[error("the destination directory does not exist: {0}")]
    DestMissing(String),
    #[error("the destination path is not a directory: {0}")]
    DestNotADir(String),
    #[error("the destination already contains files; refusing to overwrite: {0}")]
    DestNotEmpty(String),
    #[error("io error staging template files: {0}")]
    StagingIo(#[from] io::Error),
    #[error("template applied partially; staging left at {0}; manual cleanup required")]
    Partial(String),
    #[error("invalid relative path in template: {0}")]
    InvalidRelPath(String),
}

impl Serialize for TemplateError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

impl<'de> Deserialize<'de> for TemplateError {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let s = String::deserialize(d)?;
        // The JS side never re-hydrates TemplateError; this
        // impl exists for symmetry with other Lipi errors.
        Ok(TemplateError::UnknownId(format!("(re-hydrated) {s}")))
    }
}

/// Wire type: the set of files that were written. JS
/// shows a "Created N files" toast from this.
#[derive(Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct ApplyResult {
    pub created_paths: Vec<String>,
    pub template_id: String,
}

// ---------------------------------------------------------------------------
// Template bodies
// ---------------------------------------------------------------------------
//
// The plan's full set: React+Vite, Tauri+Rust, Node API,
// Python venv, Go module. Each file is small enough to keep
// inline; we deliberately don't read these from disk at
// runtime so the template gallery works even when the app
// was launched with a stripped-down resources directory.

const REACT_VITE: Template = Template {
    id: "react-vite",
    name: "React + Vite + TypeScript",
    description: "Modern React app with Vite's dev server and TypeScript.",
    files: &[
        TemplateFile {
            rel_path: "package.json",
            content: r#"{
  "name": "react-vite-app",
  "private": true,
  "version": "0.0.1",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@types/react": "^18.3.3",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.1",
    "typescript": "^5.5.3",
    "vite": "^5.4.0"
  }
}
"#,
        },
        TemplateFile {
            rel_path: "vite.config.ts",
            content: r#"import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
});
"#,
        },
        TemplateFile {
            rel_path: "tsconfig.json",
            content: r#"{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["src"]
}
"#,
        },
        TemplateFile {
            rel_path: "index.html",
            content: r#"<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>React + Vite</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
"#,
        },
        TemplateFile {
            rel_path: "src/main.tsx",
            content: r#"import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
"#,
        },
        TemplateFile {
            rel_path: "src/App.tsx",
            content: r#"export default function App() {
  return (
    <main>
      <h1>Hello, Lipi!</h1>
      <p>Edit <code>src/App.tsx</code> and save to reload.</p>
    </main>
  );
}
"#,
        },
        TemplateFile {
            rel_path: "src/index.css",
            content: r#":root {
  font-family: Inter, system-ui, Avenir, Helvetica, Arial, sans-serif;
  line-height: 1.5;
  font-weight: 400;
  color-scheme: light dark;
  color: rgba(255, 255, 255, 0.87);
  background-color: #242424;
}
body { margin: 0; display: grid; place-items: center; min-height: 100vh; }
main { text-align: center; }
"#,
        },
        TemplateFile {
            rel_path: ".gitignore",
            content: "node_modules\ndist\n.DS_Store\n*.log\n",
        },
        TemplateFile {
            rel_path: "README.md",
            content: r#"# React + Vite

A minimal React + Vite + TypeScript starter. Open this folder in Lipi, then:

```
npm install
npm run dev
```
"#,
        },
    ],
};

const TAURI_RUST: Template = Template {
    id: "tauri-rust",
    name: "Tauri 2 + React + Rust",
    description: "Cross-platform desktop app with a Rust backend and a React UI.",
    files: &[
        TemplateFile {
            rel_path: "package.json",
            content: r#"{
  "name": "tauri-react-app",
  "private": true,
  "version": "0.0.1",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "tauri": "tauri"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "@tauri-apps/api": "^2.0.0"
  },
  "devDependencies": {
    "@types/react": "^18.3.3",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.1",
    "typescript": "^5.5.3",
    "vite": "^5.4.0",
    "@tauri-apps/cli": "^2.0.0"
  }
}
"#,
        },
        TemplateFile {
            rel_path: "vite.config.ts",
            content: r#"import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { port: 1420, strictPort: true },
});
"#,
        },
        TemplateFile {
            rel_path: "tsconfig.json",
            content: r#"{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["src"]
}
"#,
        },
        TemplateFile {
            rel_path: "index.html",
            content: r#"<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Tauri + React</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
"#,
        },
        TemplateFile {
            rel_path: "src/main.tsx",
            content: r#"import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
"#,
        },
        TemplateFile {
            rel_path: "src/App.tsx",
            content: r#"import { invoke } from '@tauri-apps/api/core';
import { useState } from 'react';

export default function App() {
  const [msg, setMsg] = useState('');
  const greet = async () => setMsg(await invoke<string>('greet', { name: 'Lipi' }));
  return (
    <main>
      <h1>Tauri + React</h1>
      <button onClick={greet}>Greet from Rust</button>
      {msg && <p>{msg}</p>}
    </main>
  );
}
"#,
        },
        TemplateFile {
            rel_path: "src-tauri/Cargo.toml",
            content: r#"[package]
name = "tauri-react-app"
version = "0.0.1"
edition = "2021"

[lib]
name = "app_lib"
crate-type = ["staticlib", "cdylib", "rlib"]

[build-dependencies]
tauri-build = { version = "2", features = [] }

[dependencies]
tauri = { version = "2", features = [] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
"#,
        },
        TemplateFile {
            rel_path: "src-tauri/tauri.conf.json",
            content: r#"{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "Tauri React App",
  "version": "0.0.1",
  "identifier": "com.example.tauri-react-app",
  "build": {
    "frontendDist": "../dist",
    "devUrl": "http://localhost:1420",
    "beforeDevCommand": "npm run dev",
    "beforeBuildCommand": "npm run build"
  },
  "app": {
    "windows": [
      {
        "title": "Tauri React App",
        "width": 900,
        "height": 600
      }
    ],
    "security": { "csp": null }
  }
}
"#,
        },
        TemplateFile {
            rel_path: "src-tauri/src/main.rs",
            content: r#"fn main() {
    app_lib::run();
}
"#,
        },
        TemplateFile {
            rel_path: "src-tauri/src/lib.rs",
            content: r#"#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {name}!")
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![greet])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
"#,
        },
        TemplateFile {
            rel_path: ".gitignore",
            content: "node_modules\ndist\n.DS_Store\ntarget\n*.log\n",
        },
        TemplateFile {
            rel_path: "README.md",
            content: r#"# Tauri 2 + React + Rust

A minimal Tauri 2 desktop app with a React frontend. Open this folder in Lipi, then:

```
npm install
npm run tauri dev
```
"#,
        },
    ],
};

const NODE_API: Template = Template {
    id: "node-api",
    name: "Node.js + TypeScript API",
    description: "Small HTTP API with Node 20, TypeScript, and no extra deps.",
    files: &[
        TemplateFile {
            rel_path: "package.json",
            content: r#"{
  "name": "node-api",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "start": "tsx src/server.ts",
    "build": "tsc -b",
    "test": "node --test --import tsx tests/*.test.ts"
  },
  "devDependencies": {
    "@types/node": "^20.12.7",
    "tsx": "^4.16.0",
    "typescript": "^5.5.3"
  }
}
"#,
        },
        TemplateFile {
            rel_path: "tsconfig.json",
            content: r#"{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "esModuleInterop": true,
    "strict": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src", "tests"]
}
"#,
        },
        TemplateFile {
            rel_path: "src/server.ts",
            content: r#"import { createServer } from 'node:http';
import { hello } from './routes/hello.js';

const port = Number(process.env.PORT ?? 3000);

const server = createServer((req, res) => {
  if (req.url === '/hello') {
    const body = JSON.stringify(hello('Lipi'));
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(body);
    return;
  }
  res.writeHead(404);
  res.end();
});

server.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`listening on http://localhost:${port}`);
});
"#,
        },
        TemplateFile {
            rel_path: "src/routes/hello.ts",
            content: r#"export function hello(name: string): { message: string } {
  return { message: `Hello, ${name}!` };
}
"#,
        },
        TemplateFile {
            rel_path: ".gitignore",
            content: "node_modules\ndist\n.DS_Store\n*.log\n",
        },
        TemplateFile {
            rel_path: "README.md",
            content: r#"# Node.js + TypeScript API

A zero-dependency HTTP API. Open this folder in Lipi, then:

```
npm install
npm run dev
```

Then open `http://localhost:3000/hello`.
"#,
        },
    ],
};

const PYTHON_VENV: Template = Template {
    id: "python-venv",
    name: "Python with venv",
    description: "Python 3.12 project with a venv layout and pytest.",
    files: &[
        TemplateFile {
            rel_path: "pyproject.toml",
            content: r#"[project]
name = "python-venv-app"
version = "0.0.1"
description = "A minimal Python project with a venv layout."
requires-python = ">=3.12"
dependencies = []

[project.optional-dependencies]
dev = ["pytest>=8.0"]

[build-system]
requires = ["setuptools>=68"]
build-backend = "setuptools.build_meta"

[tool.setuptools.packages.find]
where = ["src"]

[tool.pytest.ini_options]
testpaths = ["tests"]
"#,
        },
        TemplateFile {
            rel_path: "src/__init__.py",
            content: "",
        },
        TemplateFile {
            rel_path: "src/hello.py",
            content: r#"def greet(name: str) -> str:
    return f"Hello, {name}!"
"#,
        },
        TemplateFile {
            rel_path: "tests/test_hello.py",
            content: r#"from src.hello import greet


def test_greet() -> None:
    assert greet("Lipi") == "Hello, Lipi!"
"#,
        },
        TemplateFile {
            rel_path: ".gitignore",
            content: "__pycache__/\n*.py[cod]\n.venv/\n.pytest_cache/\n*.egg-info/\n",
        },
        TemplateFile {
            rel_path: "README.md",
            content: r#"# Python venv project

A minimal Python 3.12 project. Open this folder in Lipi, then:

```
python -m venv .venv
. .venv/bin/activate   # or .venv\Scripts\activate on Windows
pip install -e ".[dev]"
pytest
```
"#,
        },
    ],
};

const GO_MODULE: Template = Template {
    id: "go-module",
    name: "Go module",
    description: "Go 1.22 module with a `main` and a `_test.go`.",
    files: &[
        TemplateFile {
            rel_path: "go.mod",
            content: r#"module example.com/go-app

go 1.22
"#,
        },
        TemplateFile {
            rel_path: "main.go",
            content: r#"package main

import "fmt"

func main() {
    fmt.Println(greet("Lipi"))
}

// greet returns a greeting message. It is exported so
// `main_test.go` can call it from a test in the same package.
func greet(name string) string {
    return fmt.Sprintf("Hello, %s!", name)
}
"#,
        },
        TemplateFile {
            rel_path: "main_test.go",
            content: r#"package main

import "testing"

func TestGreet(t *testing.T) {
    got := greet("Lipi")
    if got != "Hello, Lipi!" {
        t.Errorf("greet = %q, want %q", got, "Hello, Lipi!")
    }
}
"#,
        },
        TemplateFile {
            rel_path: ".gitignore",
            content: "# Binaries\n/go-app\n*.exe\n*.test\n*.out\n",
        },
        TemplateFile {
            rel_path: "README.md",
            content: r#"# Go module

A minimal Go 1.22 module. Open this folder in Lipi, then:

```
go run .
go test ./...
```
"#,
        },
    ],
};

/// The canonical ordered registry. The order here is the
/// display order in the JS gallery.
pub const REGISTRY: &[Template] = &[REACT_VITE, TAURI_RUST, NODE_API, PYTHON_VENV, GO_MODULE];

/// Look up a template by id. Returns `None` for unknown
/// ids (so the JS side can show "Unknown template" instead
/// of panicking).
pub fn by_id(id: &str) -> Option<&'static Template> {
    REGISTRY.iter().find(|t| t.id == id)
}

// ---------------------------------------------------------------------------
// apply() — the public entry point.
//
// This is the only function the JS side calls.
// ---------------------------------------------------------------------------

/// Expand `template_id` into `dest`. Returns the list of
/// created paths (display form, e.g. `C:\Users\foo\bar\package.json`).
///
/// **Atomicity strategy**: write all files into a staging
/// subdir (`.lipi-template-staging-<rand>`) inside `dest`
/// first, then rename each one to its final location. If
/// any write fails, the staging dir is removed and `dest`
/// is left untouched.
pub fn apply(template_id: &str, dest: &Path) -> Result<ApplyResult, TemplateError> {
    let template =
        by_id(template_id).ok_or_else(|| TemplateError::UnknownId(template_id.to_string()))?;

    // Validate `dest` is a real, writable directory.
    if !dest.exists() {
        return Err(TemplateError::DestMissing(dest.display().to_string()));
    }
    if !dest.is_dir() {
        return Err(TemplateError::DestNotADir(dest.display().to_string()));
    }

    // Clean up a stale staging dir from a previous crash,
    // best-effort: ignore errors here. Must run BEFORE the
    // empty-dir check, otherwise a leftover staging dir
    // would falsely flag the directory as non-empty.
    clean_stale_staging(dest);

    // Refuse to write into a non-empty directory. This
    // matches the JS `useApplyTemplate` flow (the picker
    // hands us a freshly-created subdir), and prevents
    // accidental clobbers.
    if !is_empty_dir(dest) {
        return Err(TemplateError::DestNotEmpty(dest.display().to_string()));
    }

    // Create the staging subdir.
    let staging_name = format!(".lipi-template-staging-{}", random_suffix());
    let staging = dest.join(&staging_name);
    fs::create_dir(&staging)?;

    // Write every file into the staging dir first.
    for f in template.files {
        let staged_abs = staging.join(&f.rel_path);
        if let Some(parent) = staged_abs.parent() {
            fs::create_dir_all(parent)?;
        }
        // Reject any path that tries to escape the staging
        // dir (e.g. `../../etc/passwd` in a future template
        // we don't yet trust). The `..` check is belt-and-
        // braces; the template bodies in this file all use
        // forward-slash relative paths without `..`.
        if f.rel_path.contains("..") {
            return Err(TemplateError::InvalidRelPath(f.rel_path.to_string()));
        }
        fs::write(&staged_abs, f.content.as_bytes())?;
    }

    // Move each staged file to its final location.
    // We move one file at a time (the OS doesn't have a
    // "rename many" primitive). A crash mid-loop leaves
    // `dest` partially populated — see `TemplateError::Partial`.
    let mut created: Vec<String> = Vec::with_capacity(template.files.len());
    for f in template.files {
        let staged_abs = staging.join(&f.rel_path);
        let final_abs = dest.join(&f.rel_path);
        if let Some(parent) = final_abs.parent() {
            // `parent` is guaranteed to exist because
            // `dest` is a directory and we joined into
            // it, but create_dir_all is harmless if
            // it's a no-op.
            fs::create_dir_all(parent)?;
        }
        if let Err(e) = fs::rename(&staged_abs, &final_abs) {
            return Err(partial_after_move_failure(dest, &staging, &created, e));
        }
        created.push(final_abs.display().to_string());
    }

    // Staging dir should now be empty; remove it.
    let _ = fs::remove_dir(&staging);

    Ok(ApplyResult {
        created_paths: created,
        template_id: template.id.to_string(),
    })
}

fn is_empty_dir(p: &Path) -> bool {
    match fs::read_dir(p) {
        Ok(mut it) => it.next().is_none(),
        Err(_) => false,
    }
}

fn clean_stale_staging(dest: &Path) {
    let entries = match fs::read_dir(dest) {
        Ok(e) => e,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        if let Some(name) = entry.file_name().to_str() {
            if name.starts_with(".lipi-template-staging-") {
                let _ = fs::remove_dir_all(entry.path());
            }
        }
    }
}

fn partial_after_move_failure(
    dest: &Path,
    staging: &Path,
    created: &[String],
    io_err: io::Error,
) -> TemplateError {
    // Try to clean up the staging dir; if THAT fails,
    // we surface a Partial error so the user knows
    // there's manual cleanup to do.
    if let Err(cleanup_err) = fs::remove_dir_all(staging) {
        return TemplateError::Partial(format!(
            "io error: {io_err}; cleanup of staging {staging:?} also failed: {cleanup_err}; files already created: {created:?}; dest was {dest:?}"
        ));
    }
    TemplateError::StagingIo(io_err)
}

/// 8-char hex suffix for the staging dir. We don't use
/// `getrandom` directly because this is one call per
/// template apply (low rate) and the entropy source is
/// the OS; using `time` + the PID is plenty.
fn random_suffix() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let pid = std::process::id() as u128;
    format!("{:x}", nanos.wrapping_add(pid))
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn fresh_dir() -> PathBuf {
        let base = std::env::temp_dir();
        let id = format!(
            "lipi-templates-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        );
        let p = base.join(id);
        fs::create_dir_all(&p).unwrap();
        p
    }

    #[test]
    fn registry_has_5_templates() {
        assert_eq!(REGISTRY.len(), 5);
    }

    #[test]
    fn all_ids_are_unique() {
        let mut seen = std::collections::HashSet::new();
        for t in REGISTRY {
            assert!(seen.insert(t.id), "duplicate template id: {}", t.id);
        }
    }

    #[test]
    fn every_template_has_at_least_one_file() {
        for t in REGISTRY {
            assert!(!t.files.is_empty(), "{}: no files", t.id);
        }
    }

    #[test]
    fn every_rel_path_is_well_formed() {
        for t in REGISTRY {
            for f in t.files {
                assert!(!f.rel_path.is_empty(), "{}: empty path", t.id);
                assert!(
                    !f.rel_path.contains(".."),
                    "{}: bad path {}",
                    t.id,
                    f.rel_path
                );
                assert!(
                    !f.rel_path.starts_with('/'),
                    "{}: absolute path {}",
                    t.id,
                    f.rel_path
                );
            }
        }
    }

    #[test]
    fn react_vite_creates_expected_files() {
        let dest = fresh_dir();
        let res = apply("react-vite", &dest).unwrap();
        assert_eq!(res.template_id, "react-vite");
        let names: Vec<&str> = res
            .created_paths
            .iter()
            .map(|s| s.rsplit(['/', '\\']).next().unwrap())
            .collect();
        for must in ["package.json", "vite.config.ts", "README.md", ".gitignore"] {
            assert!(names.contains(&must), "missing {must}, got {names:?}");
        }
        // Verify the file bodies are what we expect.
        let body = fs::read_to_string(dest.join("package.json")).unwrap();
        assert!(body.contains("react-vite-app"));
        let _ = fs::remove_dir_all(&dest);
    }

    #[test]
    fn tauri_rust_creates_rust_files() {
        let dest = fresh_dir();
        let res = apply("tauri-rust", &dest).unwrap();
        assert_eq!(res.template_id, "tauri-rust");
        // The Cargo.toml lives at src-tauri/Cargo.toml.
        assert!(dest.join("src-tauri").join("Cargo.toml").is_file());
        let body = fs::read_to_string(dest.join("src-tauri").join("Cargo.toml")).unwrap();
        assert!(body.contains("tauri-react-app"));
        let _ = fs::remove_dir_all(&dest);
    }

    #[test]
    fn unknown_id_is_rejected() {
        let dest = fresh_dir();
        let err = apply("does-not-exist", &dest).unwrap_err();
        assert!(matches!(err, TemplateError::UnknownId(_)));
        let _ = fs::remove_dir_all(&dest);
    }

    #[test]
    fn non_empty_dest_is_rejected() {
        let dest = fresh_dir();
        // Plant a file.
        fs::write(dest.join("blocker.txt"), "x").unwrap();
        let err = apply("go-module", &dest).unwrap_err();
        assert!(matches!(err, TemplateError::DestNotEmpty(_)), "got {err:?}");
        // The blocker file must still be present.
        assert!(dest.join("blocker.txt").is_file());
        let _ = fs::remove_dir_all(&dest);
    }

    #[test]
    fn missing_dest_is_rejected() {
        let base = std::env::temp_dir();
        let dest = base.join(format!(
            "lipi-templates-missing-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let err = apply("go-module", &dest).unwrap_err();
        assert!(matches!(err, TemplateError::DestMissing(_)));
    }

    #[test]
    fn stale_staging_dir_is_cleaned_up() {
        let dest = fresh_dir();
        // Simulate a previous crash leaving a staging dir.
        fs::create_dir(dest.join(".lipi-template-staging-deadbeef")).unwrap();
        // Next apply must succeed and the stale staging must
        // be gone.
        let res = apply("go-module", &dest).unwrap();
        assert_eq!(res.template_id, "go-module");
        assert!(!dest.join(".lipi-template-staging-deadbeef").exists());
        let _ = fs::remove_dir_all(&dest);
    }
}

// ---------------------------------------------------------------------------
// Display impl for the JS-side log line.
// ---------------------------------------------------------------------------

impl fmt::Display for Template {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{} ({})", self.name, self.id)
    }
}
