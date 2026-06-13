/**
 * licenseStore — Phase 2 (offline licensing layer).
 *
 * A small Zustand store that caches the license status
 * in memory. The status is fetched once on app startup
 * via `licenseGetStatus()`; subsequent reads are
 * synchronous from the store. The Rust side re-verifies
 * the license signature on every IPC call (the verify is
 * microseconds), but caching the *result* in the store
 * avoids an IPC round-trip on every render.
 *
 * Why a store (and not a one-shot `getStatus()` helper):
 *
 *   - The activation screen, the settings card, and the
 *     (Phase 3) full-screen gate all need synchronous
 *     access to the current status. The IPC is async, the
 *     status is read-mostly, and there's no other write
 *     side (the IPC is the only writer) — a Zustand store
 *     is the minimal-shape fit. Same pattern as
 *     `voiceCapabilitiesStore`.
 *
 *   - The `status` field starts as `null` and flips to a
 *     populated `LicenseStatusPayload` once the IPC
 *     resolves. The activation screen and settings card
 *     read `useLicenseStore(s => s.status)` and render a
 *     "Loading…" placeholder while `null`.
 *
 * Hydration:
 *
 *   - Call `hydrate()` once at app startup. The store is
 *     idempotent: a second call is a no-op (the IPC
 *     result is process-lifetime-cached after the first
 *     successful hydrate).
 *   - Call `refresh()` after `activate()` or `deactivate()`
 *     to re-read the status from the Rust side. (The IPC
 *     re-verifies the signature, so a tamper attempt
 *     between calls is caught on the next refresh.)
 *   - Call `refresh()` on every app start. (The Rust
 *     status command always re-verifies; the TS cache
 *     just avoids a round-trip per render.)
 *
 * Why no persistence:
 *
 *   - The status is a derivation of the keychain entry
 *     (which IS persisted in the OS keychain). The store
 *     holds the *current* view; a stale view from
 *     localStorage would be worse than a re-fetch on
 *     startup. Mirrors the rationale for the
 *     `voiceCapabilitiesStore` (capabilities are also
 *     not persisted).
 */

import { create } from 'zustand';
import {
  licenseActivate,
  licenseDeactivate,
  licenseGetMachineFingerprint,
  licenseGetStatus,
  type LicenseStatusPayload,
} from '@/ipc/licensing';

export interface LicenseState {
  /**
   * The current license status, or `null` before the
   * hydration IPC resolves. The activation screen and
   * settings card render a loading placeholder while
   * `null`; after hydration, they re-render with the
   * real status.
   */
  status: LicenseStatusPayload | null;

  /**
   * The machine fingerprint, fetched lazily by
   * `loadMachineFingerprint()`. Used by the activation
   * screen so the user can include it in a "please
   * issue me a license" support email.
   *
   * `null` means "not yet fetched" (the fingerprint is
   * fetched on-demand, not on hydrate — the typical user
   * flow is: paste a license key, no need to ever show
   * the fingerprint). The settings card's "Show
   * fingerprint" button triggers the fetch.
   */
  machineFingerprint: string | null;

  /**
   * Hydrate the store. Idempotent: subsequent calls are
   * no-ops (a second call after the first successful
   * hydrate is a no-op; a second call after a failed
   * hydrate retries).
   *
   * Call once at app startup, next to
   * `setupVoicePreferencesPersistence()`.
   */
  hydrate: () => Promise<void>;

  /**
   * Re-read the status from the Rust side. Call after
   * `activate()` or `deactivate()` to refresh the cached
   * value. The Rust side re-verifies the signature on
   * every call, so a tamper attempt between calls is
   * caught here.
   */
  refresh: () => Promise<void>;

  /**
   * Activate a license key. The IPC is called; on success,
   * the store's `status` is updated to the returned value.
   * On failure (the IPC returned an `invalid` status), the
   * store's `status` is updated to the `invalid` variant
   * so the activation screen can show the error.
   *
   * The store never throws — a bad key is a normal user
   * error, surfaced via the `status` field.
   */
  activate: (key: string) => Promise<LicenseStatusPayload>;

  /**
   * Deactivate (delete the keychain entry). The IPC is
   * called and the returned status (typically
   * `unactivated`) is set on the store.
   */
  deactivate: () => Promise<LicenseStatusPayload>;

  /**
   * Fetch the machine fingerprint from the Rust side. The
   * result is cached in the store. Called on-demand by
   * the settings card.
   */
  loadMachineFingerprint: () => Promise<string>;
}

export const useLicenseStore = create<LicenseState>((set, get) => ({
  status: null,
  machineFingerprint: null,

  hydrate: async (): Promise<void> => {
    // Idempotency: a second call after a successful
    // hydrate is a no-op. A second call after a failed
    // hydrate retries.
    if (get().status !== null) return;
    try {
      const status = await licenseGetStatus();
      set({ status });
    } catch (err) {
      // The Rust side never throws in practice — the
      // IPC command returns the status payload (even
      // `invalid` is a valid payload, not an error). If
      // we get here, something is very wrong (Tauri
      // bridge disconnected, command not registered, …).
      // We swallow the error and leave `status: null` so
      // the activation screen shows a "Loading…" state
      // rather than crashing.
      //
      // A console.warn gives a developer a clue without
      // flooding the user.
      console.warn('[license] hydrate failed; status will stay null', err);
    }
  },

  refresh: async (): Promise<void> => {
    try {
      const status = await licenseGetStatus();
      set({ status });
    } catch (err) {
      console.warn('[license] refresh failed; status will stay stale', err);
    }
  },

  activate: async (key: string): Promise<LicenseStatusPayload> => {
    const trimmed = key.trim();
    const status = await licenseActivate(trimmed);
    set({ status });
    return status;
  },

  deactivate: async (): Promise<LicenseStatusPayload> => {
    const status = await licenseDeactivate();
    set({ status });
    return status;
  },

  loadMachineFingerprint: async (): Promise<string> => {
    const cached = get().machineFingerprint;
    if (cached !== null) return cached;
    const fp = await licenseGetMachineFingerprint();
    set({ machineFingerprint: fp });
    return fp;
  },
}));

export const licenseSelectors = {
  status: (s: LicenseState) => s.status,
  machineFingerprint: (s: LicenseState) => s.machineFingerprint,
};
