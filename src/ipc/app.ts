/**
 * App-level IPC surface.
 *
 * Mirrors the F.4 / F.5 Rust commands in
 * `src-tauri/src/lib.rs`:
 *   - `get_app_version` -> returns the product name and
 *      the `Cargo.toml` version string (both `&'static
 *      str` on the Rust side, so this is essentially a
 *      constant read of the embedded metadata).
 *   - `open_devtools` -> opens the WebView developer
 *      tools. The Tauri 2 JS webview API does not expose
 *      this directly; we wrap `WebviewWindow::open_devtools()`
 *      in a one-line IPC. Used by the F.4
 *      View > Toggle Developer Tools menu item, routed
 *      through `useMenuEvents`.
 *
 * Used by the F.5 About modal to render the version line
 * without baking a hard-coded value into the JS bundle
 * (so the bundled app always reports its own version).
 *
 * No error type: the Rust side never errors. The promise
 * rejects only on IPC plumbing failures (no Tauri runtime,
 * bridge disconnected, etc.) — those bubble up as
 * `unknown` from the modal's `.catch`.
 */

import { invoke } from '@tauri-apps/api/core';

export interface AppVersion {
  productName: string;
  version: string;
}

export async function getAppVersion(): Promise<AppVersion> {
  return invoke<AppVersion>('get_app_version');
}

export async function openDevtools(): Promise<void> {
  return invoke<void>('open_devtools');
}

