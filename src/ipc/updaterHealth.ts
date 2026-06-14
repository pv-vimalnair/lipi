/**
 * Phase 5: the updater endpoint health check.
 *
 * The frontend's About screen calls
 * `updaterHealthCheck()` on mount to display
 * "Updater: ✓ reachable" or "Updater: ✗
 * unreachable — …" so users on restricted
 * networks (corporate firewalls, China's GFW)
 * can self-diagnose "the updater doesn't work"
 * issues.
 *
 * See `src-tauri/src/updater_health.rs` for the
 * Rust side and
 * `docs/plans/prod-p5-release-pipeline-design.md`
 * for the design rationale.
 */

import { invoke } from "@tauri-apps/api/core";

/**
 * The result of probing the updater endpoint.
 *
 * Discriminated union with `kind` as the tag —
 * matches the Rust `UpdaterHealth` enum's
 * `#[serde(rename_all = "camelCase", tag = "kind")]`
 * attribute.
 */
export type UpdaterHealth =
  | { kind: "reachable"; status: number }
  | { kind: "unreachable"; reason: string };

/**
 * Probe the configured updater endpoint and
 * return its health status. The probe is a
 * single HTTP GET with a 5-second timeout.
 *
 * @example
 * ```ts
 * const health = await updaterHealthCheck();
 * if (health.kind === "reachable") {
 *   console.log(`Updater is reachable (HTTP ${health.status})`);
 * } else {
 *   console.warn(`Updater is unreachable: ${health.reason}`);
 * }
 * ```
 */
export async function updaterHealthCheck(): Promise<UpdaterHealth> {
  return await invoke<UpdaterHealth>("updater_health_check");
}
