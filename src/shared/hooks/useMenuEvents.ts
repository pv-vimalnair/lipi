/**
 * useMenuEvents — F.4/F.6 wiring for native menu events.
 *
 * Listens once for the `lipi://menu` Tauri event that the
 * Rust `on_menu_event` handler emits. The event payload
 * is a `MenuEventPayload { commandId: string }` mirroring
 * the Rust `serde(rename_all = "camelCase")` struct.
 *
 * For each `commandId`, the hook routes to the right
 * action:
 *   - `menu.help.about` -> `useAboutStore.show()`
 *   - `menu.file.openFolder` -> reuse the existing
 *     `fsPickFolder` IPC and `useWorkspaceStore.open()`
 *   - `menu.file.closeFolder` -> `useWorkspaceStore.close()`
 *   - `menu.file.settings` -> `useAppStore.setActiveScreen('settings')`
 *   - `menu.file.commandPalette` -> `useCommandPaletteStore.show()`
 *   - `menu.view.reload` -> `window.location.reload()`
 *     (in a Tauri webview, this also re-runs the IPC setup
 *     because the JS context is re-created)
 *   - `menu.view.devTools` -> opens the WebView2 devtools
 *     via Tauri's `getCurrent().toggleDevtools()` (the
 *     webview toolkit's `webview.openDevTools()` is
 *     available via `@tauri-apps/api/webview`)
 *
 * The hook does NOT mount the modal — `main.tsx` renders
 * `<AboutModal open={isOpen} onClose={hide} />` separately.
 * Splitting the two means the menu event handler can be
 * unit-tested without React.
 *
 * Edit / Window submenus (cut/copy/paste/etc.) and the
 * macOS predefines (hide/quit/services) are handled by the
 * OS directly and never reach this hook.
 */

import { useEffect } from 'react';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { pickFolder } from '@/ipc/fs';
import { openDevtools } from '@/ipc/app';
import { useAppStore } from '@/shared/state/appStore';
import { useAboutStore } from '@/shared/state/aboutStore';
import { useCommandPaletteStore } from '@/shared/state/commandPaletteStore';
import { useWorkspaceStore } from '@/shared/state/workspaceStore';

const MENU_EVENT = 'lipi://menu';

interface MenuEventPayload {
  commandId: string;
}

export function useMenuEvents(): void {
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;

    const setup = async (): Promise<void> => {
      // The webview API is the canonical way to subscribe to
      // Tauri-emitted events in v2 (the older `event.listen` is
      // deprecated). We only run inside a Tauri webview —
      // `getCurrentWebview()` throws in a plain browser.
      try {
        const webview = getCurrentWebview();
        const handle = await webview.listen<MenuEventPayload>(MENU_EVENT, (event) => {
          const { commandId } = event.payload;
          void routeMenuCommand(commandId);
        });
        if (cancelled) {
          // The effect was cleaned up before listen() resolved —
          // immediately tear down to avoid a leak.
          handle();
        } else {
          unlisten = handle;
        }
      } catch (e) {
        // Outside a Tauri webview (tests, browser preview). The
        // command palette + the in-app Settings button still
        // work; only the native menu is missing. Log once.
        // eslint-disable-next-line no-console
        console.warn('useMenuEvents: not in a Tauri webview, menu events disabled', e);
      }
    };

    void setup();

    return () => {
      cancelled = true;
      if (unlisten) unlisten();
    };
  }, []);
}

async function routeMenuCommand(commandId: string): Promise<void> {
  switch (commandId) {
    case 'menu.help.about':
      useAboutStore.getState().show();
      return;
    case 'menu.file.openFolder': {
      const path = await pickFolder();
      if (path) {
        useWorkspaceStore.getState().open(path);
      }
      return;
    }
    case 'menu.file.closeFolder':
      useWorkspaceStore.getState().close();
      return;
    case 'menu.file.settings':
      useAppStore.getState().setActiveScreen('settings');
      return;
    case 'menu.file.commandPalette':
      useCommandPaletteStore.getState().show();
      return;
    case 'menu.view.reload':
      // The Tauri webview's `window.location.reload()` restarts
      // the JS context (the same as a hard refresh in a regular
      // browser). The Tauri bridge is re-established by the
      // `setup()` above on next mount.
      window.location.reload();
      return;
    case 'menu.view.devTools':
      try {
        // F.4: devtools open via Rust IPC (the Tauri JS webview
        // module doesn't expose this directly; the Rust
        // `open_devtools` command wraps `WebviewWindow::open_devtools()`).
        await openDevtools();
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('failed to open devtools', e);
      }
      return;
    default:
      // Unknown command id — likely a future menu item we
      // haven't wired yet, or a typo in the Rust side.
      // eslint-disable-next-line no-console
      console.warn('useMenuEvents: unknown commandId', commandId);
  }
}
