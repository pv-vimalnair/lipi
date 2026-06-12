import { useEffect } from 'react';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { EditorWorkspace } from '@/screens/EditorWorkspace';
import { SettingsProvider } from '@/screens/SettingsProvider';
import { Welcome } from '@/screens/Welcome';
import { useAppStore } from '@/shared/state/appStore';
import { useAboutStore, aboutSelectors } from '@/shared/state/aboutStore';
import { useFirstRunStore } from '@/shared/state/firstRunStore';
import {
  useWorkspaceStore,
} from '@/shared/state/workspaceStore';
import { Button } from '@/shared/components/Button';
import {
  AboutModal,
  CommandPaletteModal,
  FirstRunOnboarding,
  VoiceAnnouncer,
} from '@/shared/components';
import {
  useCommandPaletteShortcut,
  useFirstRunOnboarding,
  useMenuEvents,
  useOpenFolderShortcut,
  useWorkspaceSync,
} from '@/shared/hooks';
import '@xterm/xterm/css/xterm.css';
import '@/shared/styles/tokens.css';
import '@/shared/styles/global.css';

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
  const currentPath = useWorkspaceStore((s) => s.currentPath);
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
    return <SettingsProvider />;
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
  const aboutOpen = useAboutStore(aboutSelectors.isOpen);
  const hideAbout = useAboutStore(aboutSelectors.hide);
  useEffect(() => {
    useWorkspaceStore.getState().hydrate();
    useFirstRunStore.getState().hydrate();
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
    </>
  );
}

createRoot(container).render(
  <StrictMode>
    <AppRoot />
  </StrictMode>,
);
