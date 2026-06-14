import { useCallback, useEffect, useRef } from 'react';
import { FileTreePane } from './components/FileTreePane';
import { EditorPane } from './components/EditorPane';
import { SidePanelPane } from './components/SidePanelPane';
import { TitleBar } from './components/TitleBar';
import { StatusBar } from './components/StatusBar';
import { ExpiryBanner } from '@/shared/components/ExpiryBanner';
import { MobileShell } from './components/MobileShell';
import { ConfirmToolCallModal } from './components/ConfirmToolCallModal';
import { WorkspaceTabs } from './components/WorkspaceTabs';
import { DeviceEmulator } from '@/dev/DeviceEmulator';
import { useDeviceEmulatorShortcutWhenDev } from '@/dev/useDeviceEmulatorShortcut';
import { useDeviceEmulatorStore } from '@/dev/state/deviceEmulatorStore';
import { useViewport } from './hooks/useViewport';
import { useFileTreeStore } from './state/fileTreeStore';
import { useGitStatus } from './hooks/useGitStatus';
import { useGitStore } from './state/gitStore';
import {
  editorTabsSelectors,
  isDirty,
  useEditorTabsStore,
} from './state/editorTabsStore';
import { useEditorTabs } from './hooks/useEditorTabs';
import { useCmdKStore } from './state/cmdKStore';
import { useEditorControllerStore } from './state/editorControllerStore';
import { registerToolExecutor } from './state/aiStore';
import { executeToolCall } from './state/toolRegistry';
import { useKeyboardShortcut } from '@/shared/hooks';
import styles from './EditorWorkspace.module.css';

/**
 * EditorWorkspace — the primary screen.
 *
 * Switches between the desktop 3-pane grid and the mobile stacked shell
 * based on the active viewport bucket.
 *
 * Desktop layout is a 5-area CSS grid:
 *
 *   | titlebar  titlebar    titlebar  |
 *   | tree      editor      side      |
 *   | statusbar statusbar   statusbar |
 *
 * On mobile (width <= 480px) the grid is replaced by the MobileShell
 * with its own tab bar. The desktop panes are still mounted (so a
 * browser-side resize back to desktop shows the right state) but
 * visually hidden. This avoids remount-cost on rotation.
 *
 * Cross-feature wiring (Rule 6): when the file tree records a
 * selected path, this screen dispatches to the editor to open it.
 * The two stores never know about each other — wiring lives at the
 * screen level where both are mounted.
 *
 * 5b-5 wiring:
 *   - The `Cmd-K` / `Ctrl-K` global shortcut is
 *     bound HERE (not in the EditorPane) so it
 *     fires regardless of which pane has focus.
 *     The handler reads the live Monaco editor
 *     from the `editorControllerStore`, extracts
 *     the current selection, and dispatches
 *     `cmdKStore.openCmdK(sel)`. The modal
 *     itself is rendered inside the AIPanel;
 *     this screen is the single hand-off
 *     point between the keyboard event and
 *     the modal's open-state. The handler
 *     is a no-op when no editor is mounted
 *     (mobile, no file open).
 *
 * 5b-6 wiring:
 *   - Registers the `toolRegistry`'s
 *     `executeToolCall` as the `aiStore`'s
 *     tool executor on mount. This is the
 *     bridge between the two stores: the
 *     `aiStore` knows about the model and
 *     the thread, the `toolRegistry` knows
 *     about the tools and how to run them.
 *     Neither knows about the other —
 *     `EditorWorkspace` is the wiring
 *     point (Rule 6). Tests can call
 *     `registerToolExecutor(mock)` to swap
 *     in a mock.
 */
export function EditorWorkspace() {
  const viewport = useViewport();
  const isMobile = viewport === 'mobile';
  const isDev = import.meta.env.DEV;

  // File-tree → editor wiring.
  const selectedPath = useFileTreeStore((s) => s.selectedPath);
  const lastOpenedPath = useRef<string | null>(null);
  const { openFile } = useEditorTabs();
  useEffect(() => {
    if (
      selectedPath &&
      selectedPath !== lastOpenedPath.current
    ) {
      lastOpenedPath.current = selectedPath;
      void openFile(selectedPath);
    }
  }, [openFile, selectedPath]);

  // File-tree → git panel wiring (Phase 3b). When the user opens a
  // different folder, the git store is reset and a fresh status is
  // probed. When the file tree is closed (rootPath -> null), the
  // git store is reset to idle.
  const rootPath = useFileTreeStore((s) => s.rootPath);
  const gitRootPath = useGitStore((s) => s.rootPath);
  const { openRoot: openGitRoot, close: closeGit } = useGitStatus();
  useEffect(() => {
    if (rootPath && rootPath !== gitRootPath) {
      void openGitRoot(rootPath);
    } else if (!rootPath && gitRootPath) {
      closeGit();
    }
  }, [closeGit, gitRootPath, openGitRoot, rootPath]);

  // 5b-6: register the tool executor on
  // mount. The `aiStore` calls into
  // this whenever the model emits a
  // tool call. We register the
  // production `executeToolCall`
  // (which looks up the tool in the
  // `toolRegistry` and runs it);
  // tests can call `registerToolExecutor`
  // with a mock to inject deterministic
  // behaviour. The registration is a
  // module-level singleton — we
  // intentionally do NOT unregister
  // on unmount (the workspace is the
  // root screen; if it unmounts, the
  // app is being torn down).
  useEffect(() => {
    registerToolExecutor(executeToolCall);
  }, []);

  // Status bar dirty indicator (Phase 2c).
  const activeTab = useEditorTabsStore(editorTabsSelectors.activeTab);
  const dirty = activeTab ? isDirty(activeTab) : false;
  const language = activeTab?.language ?? 'Plain Text';

  // 5b-5: global Cmd-K / Ctrl-K handler for
  // inline edit. Reads the live Monaco editor
  // from the controller store, extracts the
  // current selection, and dispatches
  // `cmdKStore.openCmdK(sel)`. The handler is
  // a no-op when no editor is mounted — in
  // that case the controller store's `editor`
  // is null and we just bail.
  const openCmdK = useCmdKStore((s) => s.openCmdK);
  const handleCmdK = useCallback(() => {
    const editor = useEditorControllerStore.getState().editor as
      | {
          getSelection: () => unknown;
          getModel: () => {
            getValueInRange: (sel: unknown) => string;
          } | null;
        }
      | null;
    if (!editor) return;
    const sel = editor.getSelection();
    if (!sel) return;
    const model = editor.getModel();
    if (!model) return;
    const text = model.getValueInRange(sel);
    if (!text) return; // no selection — nothing to edit
    // Cast the selection to the shape
    // `CmdKSelection.range` expects. The
    // selection shape is monaco's `IRange`
    // (start/end line + column) which lines
    // up with our hand-rolled type.
    const range = sel as {
      startLineNumber: number;
      startColumn: number;
      endLineNumber: number;
      endColumn: number;
    };
    openCmdK({ text, range });
  }, [openCmdK]);

  // 5b-5: bind the shortcut. The
  // `useKeyboardShortcut` hook already allows
  // shortcuts inside the Monaco editor surface
  // (it only skips non-Monaco text inputs) —
  // so this fires whether the editor or the
  // AI panel has focus. The `enabled` flag
  // gates the handler when no editor is
  // mounted (the user can still hit Cmd-K
  // but nothing happens — the same UX as
  // hitting Cmd-K on a closed tab in VS
  // Code).
  useKeyboardShortcut(
    { ctrl: true, key: 'k' },
    handleCmdK,
    { enabled: true },
  );

  // M1: device emulator
  // toggle. Dev-only —
  // the hook is called
  // unconditionally
  // (React's rule of
  // hooks), but the
  // effect inside the
  // hook is a no-op
  // when `isDev` is
  // false. The hook
  // itself is cheap
  // (it only registers
  // a keydown listener
  // when `isDev` is
  // true).
  useDeviceEmulatorShortcutWhenDev(isDev);
  // Hydrate the device
  // emulator store
  // (reads the
  // sessionStorage
  // value). Safe to
  // call in prod —
  // the store is
  // inert in prod
  // because the
  // emulator
  // component is
  // never mounted.
  useDeviceEmulatorStore.getState().hydrate();

  return (
    <div className={styles.root} data-viewport={viewport}>
      <div
        className={styles.desktop}
        data-visible={!isMobile}
        aria-hidden={isMobile}
      >
        <TitleBar subtitle={isDev ? 'dev · M6a' : undefined} />
        {/* Phase 3: the trial-expiry banner. Renders
            nothing for the default (>7 days) state;
            shows a red banner with an "Activate now"
            CTA when the trial is in its final 3 days
            or the user is in the grace period. The
            banner sits between the title bar and the
            workspace tabs so it's visible regardless
            of which tab is active. */}
        <ExpiryBanner />
        <WorkspaceTabs />
        <FileTreePane />
        <EditorPane />
        <SidePanelPane />
        <StatusBar dirty={dirty} language={capitalize(language)} />
      </div>
      {isMobile && <MobileShell />}
      {isDev && !isMobile && <DeviceEmulator />}
      {/* 5d: per-tool invocation
          confirmation prompt. Mounted
          at the workspace root so the
          modal survives panel
          collapse/expand. Renders
          nothing when no tool is
          awaiting approval. */}
      <ConfirmToolCallModal />
    </div>
  );
}

function capitalize(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}
