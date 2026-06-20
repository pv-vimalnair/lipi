import { lazy, Suspense, useEffect } from 'react';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { EditorWorkspace } from '@/screens/EditorWorkspace';
// Settings is a self-contained screen that the user
// opens on demand (via the titlebar gear, the Welcome
// header, or a deep link). It's not needed for the
// initial editor render — code-split it via `React.lazy`
// so its ~8 KB of component code (provider cards, voice
// cards, language-server card, privacy card, custom tool
// editor, plus their CSS modules) only ships when the
// user actually opens Settings. The License screen
// already imports `humanizeInvalidReason` / `statusLine`
// from `@/screens/SettingsProvider/components/LicenseCard`
// directly, so LicenseCard stays in the eager bundle
// regardless — only the rest of SettingsProvider is
// deferred.
const SettingsProvider = lazy(() =>
  import('@/screens/SettingsProvider').then((m) => ({
    default: m.SettingsProvider,
  })),
);
import { Welcome } from '@/screens/Welcome';
import { License } from '@/screens/License/License';
import { useAppStore } from '@/shared/state/appStore';
import { useAboutStore, aboutSelectors } from '@/shared/state/aboutStore';
import { useFirstRunStore } from '@/shared/state/firstRunStore';
import { useTourStore } from '@/shared/state/tourStore';
import { useLicenseStore } from '@/shared/state/licenseStore';
import { setupThemePersistence, useThemeStore } from '@/shared/state/themeStore';
import {
  useWorkspaceStore,
  workspaceSelectors,
} from '@/shared/state/workspaceStore';
import { Button } from '@/shared/components/Button';
import {
  AboutModal,
  CommandPaletteModal,
  FirstRunOnboarding,
  OnboardingTour,
  VoiceAnnouncer,
} from '@/shared/components';
import { LicenseGate } from '@/shared/components/LicenseGate';
import {
  useCommandPaletteShortcut,
  useDeepLinkRouting,
  useFirstRunOnboarding,
  useMenuEvents,
  useOpenFolderShortcut,
  useWorkspaceSync,
} from '@/shared/hooks';
import '@xterm/xterm/css/xterm.css';
import '@/shared/styles/tokens.css';
import '@/shared/styles/global.css';
// Phase 7: register Monaco's language-service Web Workers
// (TypeScript, JSON, CSS, HTML) before any `monaco-editor`
// module is evaluated. Side-effect import — see the file's
// header comment for why ordering matters.
import '@/screens/EditorWorkspace/workers/getMonacoWorker';

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root container #root not found in index.html');
}

/** Settings button rendered in the Welcome screen header.
 *  Reuses the same `setActiveScreen('settings')` action
 *  that the editor's titlebar ⚙ uses. */
function WelcomeHeaderActions(): JSX.Element {
  const setActiveScreen = useAppStore((s) => s.setActiveScreen);
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => setActiveScreen('settings')}
      aria-label="Open settings"
    >
      Settings
    </Button>
  );
}

/**
 * Top-level screen router.
 *
 * Two-axis routing:
 * - **Workspace axis** (workspace store): if the user
 *   hasn't opened a folder, the Welcome screen is the
 *   base. If they have, the Editor is the base.
 * - **Overlay axis** (app store): Settings can sit on
 *   top of either base, so the user can tweak their
 *   AI keys from the Welcome screen too (useful for
 *   first-run).
 *
 * Both stores are read in priority order:
 * 1. If the app store says "settings", show Settings.
 *    (Settings is reachable from anywhere; in the
 *    Welcome screen, it overlays the hero so the
 *    user can configure API keys before opening a
 *    folder.)
 * 2. Else, fall back to the workspace axis: Welcome
 *    if no folder, Editor if a folder is open.
 */
function ScreenRoot() {
  const activeScreen = useAppStore((s) => s.activeScreen);
  const hydrated = useWorkspaceStore((s) => s.hydrated);
  // M6a: read the active path via
  // the `useActivePath` selector
  // (the v1 `currentPath` field no
  // longer exists on the store).
  const currentPath = useWorkspaceStore(workspaceSelectors.currentPath);
  const firstRun = useFirstRunOnboarding();

  if (activeScreen === 'settings') {
    // The Settings screen
    // overlays whatever the
    // workspace state is.
    // The SettingsProvider
    // already has its own
    // back button that
    // returns to 'welcome'
    // or 'editor'.
    // Wrapped in <Suspense>
    // because SettingsProvider
    // is loaded via React.lazy
    // (code-split out of the
    // initial bundle — see the
    // import at the top of this
    // file). The fallback is
    // the same `appBoot`
    // placeholder used during
    // the workspace hydration
    // window, so the user
    // sees no flash when
    // opening Settings.
    return (
      <Suspense
        fallback={<div className="appBoot" aria-hidden="true" />}
      >
        <SettingsProvider />
      </Suspense>
    );
  }

  if (activeScreen === 'license') {
    // Phase 3: the License activation screen is
    // an overlay reachable from the title-bar
    // trial badge, the editor's expiry banner,
    // the License gate's "Activate a license"
    // CTA, and the LicenseCard's "Transfer"
    // button. It overlays the editor AND the
    // welcome screen, same isolation rule as
    // Settings. The screen's own `renderActions`
    // slot is omitted (the License screen is
    // modal-ish; we don't want a "back to
    // settings" link in the corner).
    return <License />;
  }

  // While the workspace
  // store is still
  // hydrating from
  // localStorage, render
  // a minimal placeholder
  // so we don't flash the
  // Welcome screen when
  // there's actually a
  // saved workspace to
  // open. (The hydration
  // itself is synchronous
  // — see the `useEffect`
  // in `AppRoot` — so this
  // is just one frame
  // either way.)
  if (!hydrated) {
    return <div className="appBoot" aria-hidden="true" />;
  }

  if (currentPath === null) {
    // The first-run
    // "no API key"
    // interstitial is
    // rendered above the
    // hero when the gate
    // conditions are met.
    // The component itself
    // is dumb about the
    // gate — the hook
    // handles all four
    // preconditions
    // (hydrated, !dismissed,
    // no workspace, no
    // configured keys)
    // and tells us whether
    // to render. The
    // Welcome screen
    // accepts a `firstRunPanel`
    // slot prop and renders
    // it between the header
    // and the hero — same
    // isolation pattern as
    // `renderActions`.
    return (
      <Welcome
        renderActions={() => <WelcomeHeaderActions />}
        firstRunPanel={
          firstRun.show ? (
            <FirstRunOnboarding
              primary={firstRun.primary}
              onAdd={firstRun.onAdd}
              onSkip={firstRun.onSkip}
            />
          ) : null
        }
      />
    );
  }

  return <EditorWorkspace />;
}

/**
 * AppRoot — the topmost component.
 * - Hydrates the workspace store
 *   and the first-run store from
 *   `localStorage` once on mount.
 * - Mounts the cross-screen
 *   `CommandPaletteModal` + its
 *   `Cmd-Shift-P` /
 *   `Ctrl-Shift-P` shortcut
 *   listener, so the launcher is
 *   always reachable regardless of
 *   which screen is active.
 */
function AppRoot() {
  useCommandPaletteShortcut();
  useOpenFolderShortcut();
  useMenuEvents();
  useWorkspaceSync();
  // Phase I: subscribe to `lipi://open?path=...` URLs the OS
  // hands the app. Mounted here (not inside ScreenRoot) so the
  // listener is alive for the full app lifetime, including the
  // hydration window before the workspace store has been read.
  useDeepLinkRouting();
  const aboutOpen = useAboutStore(aboutSelectors.isOpen);
  const hideAbout = useAboutStore(aboutSelectors.hide);
  useEffect(() => {
    useWorkspaceStore.getState().hydrate();
    useFirstRunStore.getState().hydrate();
    useTourStore.getState().hydrate();
    // Phase 2: hydrate the license store once on
    // app start. The store's `hydrate` is
    // idempotent (a second call is a no-op), so
    // StrictMode's double-effect in dev is safe.
    // The Rust side auto-generates a 14-day trial
    // on first call, so the user always sees a
    // non-null status after this resolves.
    useLicenseStore.getState().hydrate();
    // Phase 4: hydrate the theme store + wire the
    // side effects (localStorage persist + CSS-variable
    // apply). `hydrate()` reads `lipi:theme:v1` and
    // seeds the store; `setupThemePersistence()`
    // subscribes the store to localStorage writes
    // and pushes --theme-img / --theme-img-crop /
    // --theme-accent onto :root so the active
    // editor tab paints the user's selected scene.
    // Both are idempotent — safe under StrictMode's
    // double-effect in dev.
    useThemeStore.getState().hydrate();
    setupThemePersistence();
    // F.3: dismiss the cold-start splash. The splash is a pure-CSS
    // surface in index.html that shows from page load until the
    // first React commit; setting the `splash-done` class on the
    // <html> element triggers a 200ms fade-out via the CSS rule
    // `html.splash-done #splash { opacity: 0; ... }`. We do this
    // inside the AppRoot effect (not after `createRoot().render()`)
    // so React's first commit is fully visible before the fade
    // starts - avoids a flash of empty <div id="root">.
    document.documentElement.classList.add('splash-done');
  }, []);
  return (
    <>
      <ScreenRoot />
      <CommandPaletteModal />
      {/* Phase 3: the license gate. Mounted at the
          AppRoot level so it overlays EVERY screen
          (Settings, Welcome, License, editor) when
          the status is `expired` or `invalid`. The
          gate's nag mode (for `gracePeriod`) is also
          rendered here so the nag floats above the
          editor's content. */}
      <LicenseGate />
      {/* M5: voice a11y announcer. Mounted at the
          AppRoot level so the live region is
          present on every screen (the user can
          start a recording from the Welcome
          screen's future mic affordance, and
          from the editor's VoiceButton). One
          global live region, one source of
          truth (the voiceStore). */}
      <VoiceAnnouncer />
      {/* F.5: About modal. Reachable from any screen via the
          native Help > About menu (routed by `useMenuEvents`)
          and the Command Palette (added in F.6). Mounted at
          the AppRoot level so it overlays Settings, the
          Welcome screen, AND the editor - same isolation rule
          as CommandPaletteModal. */}
      <AboutModal open={aboutOpen} onClose={hideAbout} />
      {/* K: onboarding tour. Mounted at the AppRoot
          level so the overlay can highlight editor
          features. The auto-start effect (inside
          OnboardingTour) reads both the tour store
          and the workspace store; it starts the
          tour only when both have hydrated AND the
          user has a workspace open AND they
          haven't dismissed the tour on a previous
          launch. */}
      <OnboardingTour />
    </>
  );
}

createRoot(container).render(
  <StrictMode>
    <AppRoot />
  </StrictMode>,
);
