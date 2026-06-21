/**
 * useFirstRunOnboarding — the gate
 * logic for the first-run
 * "no API key" interstitial.
 *
 * The hook is intentionally
 * thin: it reads three things
 * (firstRun store, workspace
 * store, and the keychain
 * IPC), and returns the props
 * the `<FirstRunOnboarding />`
 * component needs.
 *
 * Visibility contract
 * (matches the comment on
 *  the component):
 *
 *   show  = firstRunHydrated
 *        && !dismissed
 *        && currentPath === null
 *        && configuredProviders
 *           .length === 0
 *
 * The four conditions each
 *  close one specific false
 *  positive:
 *
 *  1. `firstRunHydrated` —
 *     the persisted `dismissed`
 *     flag hasn't been read
 *     yet. Without this gate
 *     we'd show the panel for
 *     one frame to a user who
 *     already dismissed it on
 *     a previous run.
 *  2. `!dismissed` — the
 *     user's explicit "stop
 *     showing this" signal.
 *  3. `currentPath === null` —
 *     the panel belongs on
 *     the Welcome screen. If
 *     a workspace is open the
 *     user is mid-session; the
 *     AIPanel already shows a
 *     "No API key" hint in
 *     that context, and we
 *     don't want a panel
 *     covering the editor.
 *  4. `configuredProviders
 *      .length === 0` — they
 *     haven't added a key yet.
 *     The configured state is
 *     read from the keychain
 *     IPC, not persisted (it
 *     might have changed since
 *     the last run, and the
 *     IPC is the source of
 *     truth).
 *
 * The hook exposes
 * `useFirstRunOnboarding`
 * for component callers and
 * `computeShouldShow` for
 * tests.
 */

import { useCallback, useEffect, useState } from 'react';

import {
  aiGetConfiguredProviders,
  aiListProviders,
  type ProviderInfo,
} from '@/ipc/ai';
import { useAppStore } from '@/shared/state/appStore';
import {
  useFirstRunStore,
  firstRunSelectors,
} from '@/shared/state/firstRunStore';
import {
  useWorkspaceStore,
  workspaceSelectors,
} from '@/shared/state/workspaceStore';

import type { FirstRunProvider } from '@/shared/components/FirstRunOnboarding';

export interface UseFirstRunOnboardingResult {
  /** Whether the panel should
   *  render right now. The
   *  parent (`AppRoot`) is
   *  responsible for actually
   *  rendering the component
   *  — this hook just answers
   *  the question. */
  show: boolean;
  /** The provider to feature
   *  in the primary CTA. `null`
   *  if the IPC call failed
   *  or returned an empty
   *  list (production should
   *  never see this — the
   *  Rust side always returns
   *  at least OpenAI). */
  primary: FirstRunProvider | null;
  /** Click handler for the
   *  primary "Add X key" CTA.
   *  Persists `dismissed: true`
   *  and routes to Settings. */
  onAdd: (providerId: string | null) => void;
  /** Click handler for the
   *  "Skip for now" link.
   *  Persists `dismissed: true`
   *  but does NOT change
   *  screens. */
  onSkip: () => void;
}

export function useFirstRunOnboarding(): UseFirstRunOnboardingResult {
  const hydrated = useFirstRunStore(firstRunSelectors.hydrated);
  const dismissed = useFirstRunStore(firstRunSelectors.dismissed);
  const currentPath = useWorkspaceStore(workspaceSelectors.currentPath);

  // The configured-providers
  // and provider-list are
  // fetched on demand. We
  // only fetch when the
  // preconditions for
  // showing the panel are
  // close to met (i.e. not
  // dismissed, no workspace
  // open). The fetch is
  // fire-and-forget; the
  // panel simply doesn't
  // render until the data
  // is in.
  const [configuredProviders, setConfiguredProviders] = useState<string[] | null>(
    null,
  );
  const [providerList, setProviderList] = useState<ProviderInfo[] | null>(null);

  const shouldFetch =
    hydrated && !dismissed && currentPath === null;

  useEffect(() => {
    if (!shouldFetch) {
      // Clear the cached
      // values when the
      // panel is no longer
      // eligible. This
      // prevents a stale
      // "empty configured
      // providers" list
      // from keeping the
      // panel visible
      // after a dismiss +
      // re-show cycle.
      setConfiguredProviders(null);
      setProviderList(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const [configured, providers] = await Promise.all([
          aiGetConfiguredProviders(),
          aiListProviders(),
        ]);
        if (cancelled) return;
        setConfiguredProviders(configured);
        setProviderList(providers);
      } catch (err) {
        // IPC failure: we
        // don't know whether
        // a key is configured.
        // Treat as "unknown
        // → don't show the
        // panel" so we don't
        // pester the user
        // with a false
        // positive.
        if (import.meta.env.DEV) {
          // eslint-disable-next-line no-console
          console.warn(
            '[useFirstRunOnboarding] failed to read keychain state',
            err,
          );
        }
        if (cancelled) return;
        setConfiguredProviders(['__unknown__']);
        setProviderList([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [shouldFetch]);

  const dismiss = useFirstRunStore((s) => s.dismiss);
  const setActiveScreen = useAppStore((s) => s.setActiveScreen);

  const onAdd = useCallback(
    (providerId: string | null) => {
      dismiss();
      // The host (`AppRoot`) keeps
      // the currentPath-derived
      // screen as the base. By
      // switching to 'settings'
      // we overlay Settings on top
      // of the Welcome screen —
      // the SettingsProvider's
      // onBack returns to the
      // right place automatically.
      setActiveScreen('settings');
      // We deliberately ignore
      // `providerId` for now —
      // scrolling to a specific
      // card is a nice-to-have
      // for a later iteration.
      void providerId;
    },
    [dismiss, setActiveScreen],
  );

  const onSkip = useCallback(() => {
    dismiss();
  }, [dismiss]);

  const show = computeShouldShow({
    hydrated,
    dismissed,
    currentPath,
    configuredProviders,
  });

  // The "primary" provider is
  // the first one in the
  // configured list. The Rust
  // side returns the list in
  // a stable order (OpenAI
  // first), so "first" is
  // also "the one the user
  // is most likely to want".
  const primary: FirstRunProvider | null =
    providerList && providerList.length > 0
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- guarded by providerList.length > 0 check above
      ? { id: providerList[0]!.id, displayName: providerList[0]!.displayName }
      : null;

  return { show, primary, onAdd, onSkip };
}

/** Pure gate logic — exposed for
 *  tests and for any future
 *  consumer that wants to
 *  answer the same question
 *  from a different code path
 *  (e.g. a non-React test of
 *  AppRoot's router). */
export function computeShouldShow(args: {
  hydrated: boolean;
  dismissed: boolean;
  currentPath: string | null;
  configuredProviders: string[] | null;
}): boolean {
  if (!args.hydrated) return false;
  if (args.dismissed) return false;
  if (args.currentPath !== null) return false;
  if (args.configuredProviders === null) return false;
  // The IPC-failure
  // sentinel: we set this
  // to ['__unknown__']
  // to mean "we tried
  // and failed". We
  // never want to show
  // the panel in that
  // case.
  if (args.configuredProviders.length === 0) return true;
  if (args.configuredProviders[0] === '__unknown__') return false;
  return false;
}
