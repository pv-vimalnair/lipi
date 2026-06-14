import { useCallback, useEffect, useRef } from 'react';
import type { OnMount } from '@monaco-editor/react';
import Editor, { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';

import { useKeyboardShortcut } from '@/shared/hooks';
import { KeyHint } from '@/shared/components/KeyHint';
import { PaneShell } from '../PaneShell';
import { TabStrip } from '../TabStrip';
import {
  editorTabsSelectors,
  isDirty,
  useEditorTabsStore,
} from '../../state/editorTabsStore';
import { useEditorTabs } from '../../hooks/useEditorTabs';
import { useEditorControllerStore } from '../../state/editorControllerStore';
import { useTsConfigStore } from '../../state/tsConfigStore';
import {
  useWorkspaceStore,
} from '@/shared/state/workspaceStore';
import styles from './EditorPane.module.css';

// Phase 7: module-level guard for the one-time
// TypeScript service configuration. Monaco keeps a
// single TS service for the whole renderer process;
// calling `setCompilerOptions` / `setDiagnosticsOptions`
// is global and idempotent but not free (it re-emits
// diagnostics for every model in the project). We do
// it once on the first `handleMount` invocation and
// then never touch `typescriptDefaults` /
// `javascriptDefaults` again — subsequent `tsconfig.json`
// changes (workspace switch, external edit) are applied
// via the `applyDiscoveredTsConfig` function below, which
// only swaps the compiler options without re-touching
// the diagnostic toggles.
let tsServiceConfigured = false;
function configureTsServiceOnce() {
  if (tsServiceConfigured) return;
  tsServiceConfigured = true;
  monaco.languages.typescript.typescriptDefaults.setCompilerOptions({
    target: monaco.languages.typescript.ScriptTarget.ES2020,
    module: monaco.languages.typescript.ModuleKind.ESNext,
    moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
    strict: true,
    esModuleInterop: true,
    skipLibCheck: true,
    allowNonTsExtensions: true,
    allowJs: true,
    jsx: monaco.languages.typescript.JsxEmit.ReactJSX,
  });
  monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions({
    noSemanticValidation: false,
    noSyntaxValidation: false,
    noSuggestionDiagnostics: false,
  });
  monaco.languages.typescript.javascriptDefaults.setCompilerOptions({
    target: monaco.languages.typescript.ScriptTarget.ES2020,
    allowJs: true,
    checkJs: false,
  });
}

// Phase 7: apply the workspace's discovered
// `compilerOptions` (or `null` to reset to the
// defaults installed by `configureTsServiceOnce`).
// Called on every `handleMount` AND on every
// `tsConfigStore` change (the `useEffect` in
// `ActiveEditor` subscribes to `updatedAt`).
function applyDiscoveredTsConfig() {
  const { compilerOptions } = useTsConfigStore.getState();
  if (compilerOptions) {
    // The store hands us the raw `compilerOptions`
    // object from the user's `tsconfig.json`. Monaco's
    // type expects a fully-typed shape, but it
    // actually only checks the fields it cares
    // about — passing the raw object is the
    // documented escape hatch for "I don't want to
    // model every TS compiler option".
    monaco.languages.typescript.typescriptDefaults.setCompilerOptions(
      compilerOptions as monaco.languages.typescript.CompilerOptions,
    );
  }
  // If `compilerOptions` is `null` (no tsconfig in
  // workspace), we leave the defaults in place —
  // they were installed by `configureTsServiceOnce`
  // and are correct for "no project config".
}

// Tell the monaco-react loader where the bundled monaco lives. Without
// this, it tries to fetch from a CDN at runtime, which fails offline
// and adds a startup cost we don't need.
loader.config({
  paths: {
    vs: new URL(
      'monaco-editor/esm/vs/editor/editor.api',
      import.meta.url,
    ).toString(),
  },
});

/**
 * Editor pane — Monaco + tabs + dirty + Ctrl+S save.
 *
 * Phase 2c wiring:
 *   - TabStrip is owned by the editor pane (not the screen) so the
 *     strip and the editor always move together.
 *   - When the active tab changes, we mount a fresh Monaco instance
 *     pointed at that tab's content. We use `onChange` to push edits
 *     back to the store; the store recomputes the dirty bit.
 *   - Ctrl/Cmd+S calls `useEditorTabs().saveActive()`. We register
 *     the shortcut here (not in the workspace) so it only fires
 *     when the editor pane is mounted.
 *
 * Phase 5b-5 wiring:
 *   - On `onMount` we also write the live Monaco instance to the
 *     `editorControllerStore` so features outside the pane
 *     (currently `AIPanel/CmdKModal`, later the command palette
 *     and the diff view) can read the current selection, replace
 *     text, and call other editor methods. We clear the handle
 *     in the `onMount`-pair cleanup so a stale editor from a
 *     closed tab doesn't leak. The local `editorRef` is still
 *     used for the `useEffect` that syncs external content
 *     into Monaco on tab switch.
 */
export function EditorPane() {
  const activeTab = useEditorTabsStore(editorTabsSelectors.activeTab);
  const tabsCount = useEditorTabsStore(
    (s: ReturnType<typeof useEditorTabsStore.getState>) => Object.keys(s.tabs).length,
  );
  const { saveActive, setContent } = useEditorTabs();

  useKeyboardShortcut(
    { ctrl: true, key: 's' },
    () => {
      void saveActive();
    },
    { enabled: tabsCount > 0 },
  );

  const dirty = activeTab ? isDirty(activeTab) : false;

  // Phase 7: feed the active workspace root into
  // `tsConfigStore` whenever the user switches
  // workspace tabs (or opens / closes one). The store
  // reads + parses `tsconfig.json` (or falls back to
  // defaults) and the `handleMount` callback below
  // applies the resulting `compilerOptions` to
  // Monaco. On workspace close, the store is cleared.
  //
  // The selector returns `null` when no tab is active
  // — the store's `setFromWorkspace` is short-circuited
  // on a no-op and `clear` is the explicit teardown
  // path for "no workspace".
  const activeWorkspaceRoot = useWorkspaceStore((s) =>
    s.activeId ? s.workspaces.find((w) => w.id === s.activeId)?.path ?? null : null,
  );
  useEffect(() => {
    if (activeWorkspaceRoot) {
      void useTsConfigStore.getState().setFromWorkspace(activeWorkspaceRoot);
    } else {
      useTsConfigStore.getState().clear();
    }
  }, [activeWorkspaceRoot]);

  return (
    <PaneShell
      label="Editor"
      area="editor"
      hint={
        activeTab
          ? `${activeTab.language} · ${activeTab.path}`
          : undefined
      }
      headerAction={
        activeTab ? (
          <span className={styles.headerRight} aria-live="polite">
            {dirty ? (
              <>
                <span className={styles.dirtyDot} aria-hidden="true" />
                <span className={styles.dirtyText}>unsaved</span>
              </>
            ) : (
              <span className={styles.cleanText}>saved</span>
            )}
            <KeyHint label="S" primary />
          </span>
        ) : undefined
      }
    >
      <div className={styles.root}>
        <TabStrip position="top" />
        <div className={styles.body}>
          {activeTab ? (
            <ActiveEditor
              key={activeTab.id}
              tabId={activeTab.id}
              path={activeTab.path}
              language={activeTab.language}
              content={activeTab.content}
              load={activeTab.load}
              onChange={(next) => setContent(activeTab.id, next)}
            />
          ) : (
            <div className={styles.placeholder}>
              <span className={styles.placeholderTitle}>No file open</span>
              <span className={styles.placeholderHint}>
                Pick a file from the Explorer to start editing.
              </span>
            </div>
          )}
        </div>
      </div>
    </PaneShell>
  );
}

interface ActiveEditorProps {
  tabId: string;
  path: string;
  language: string;
  content: string;
  load: import('../../state/editorTabsStore').TabLoadStatus;
  onChange: (next: string) => void;
}

function ActiveEditor({
  path,
  language,
  content,
  load,
  onChange,
}: ActiveEditorProps) {
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
  const suppressNextChange = useRef(false);
  // 5b-5: write the live editor to the screen-level
  // controller store so the CmdKModal (and any
  // future cross-pane feature) can read the current
  // selection and call `executeEdits`.
  const setControllerEditor = useEditorControllerStore(
    (s) => s.setEditor,
  );
  // Phase S: apply a pending reveal request
  // (set by the workspace-search panel) when
  // Monaco mounts for the matching path.
  const setPendingReveal = useEditorControllerStore(
    (s) => s.setPendingReveal,
  );

  // Push external content into Monaco (e.g. when switching tabs and
  // the new content is different from what Monaco has internally).
  useEffect(() => {
    if (!editorRef.current) return;
    if (editorRef.current.getValue() === content) return;
    suppressNextChange.current = true;
    editorRef.current.setValue(content);
  }, [content]);

  const handleMount: OnMount = useCallback((editor) => {
    editorRef.current = editor;
    // 5b-5: also expose the live instance to the
    // screen-level controller store so non-editor
    // panes (e.g. CmdKModal) can read the current
    // selection and replace text. We pass the
    // instance as `unknown` to keep the store
    // monaco-agnostic; consumers cast at the
    // call site.
    setControllerEditor(editor);
    // Phase 7: configure the TS service once on
    // the first mount (idempotent), then apply
    // whatever `compilerOptions` the
    // `tsConfigStore` has for the active
    // workspace. Re-runs on every tab switch
    // (the new editor instance may need the
    // same options re-applied — `setCompilerOptions`
    // is global state, so this is technically a
    // no-op for the second+ invocation, but it's
    // defensive and cheap).
    configureTsServiceOnce();
    applyDiscoveredTsConfig();
    // Phase S: if a `pendingReveal` is queued
    // for this exact path, apply it now and
    // clear the request. We compare paths
    // exactly (the JS side uses the absolute
    // path the search returned, which is the
    // same one Monaco just mounted).
    const pending = useEditorControllerStore.getState().pendingReveal;
    if (pending && pending.path === path) {
      const line = Math.max(1, pending.line);
      const column = Math.max(1, pending.column);
      editor.revealLineInCenter(line);
      editor.setPosition({ lineNumber: line, column });
      editor.focus();
      setPendingReveal(null);
    }
  }, [path, setControllerEditor, setPendingReveal]);

  // Phase 7: re-apply the discovered `compilerOptions`
  // whenever the `tsConfigStore` updates — that covers
  // workspace switch, external `tsconfig.json` save
  // (debounced 500ms by the store's fs watcher), and
  // any future "reload project config" action. The
  // store's `updatedAt` is a monotonic timestamp that
  // bumps on every successful re-read; using it as the
  // effect dep means we don't need to deep-compare the
  // `compilerOptions` object.
  const tsConfigUpdatedAt = useTsConfigStore((s) => s.updatedAt);
  useEffect(() => {
    applyDiscoveredTsConfig();
  }, [tsConfigUpdatedAt]);

  // 5b-5: clear the controller-store handle when
  // the active editor unmounts (tab switch,
  // screen navigation). Without this a closed
  // tab's editor would still be reachable via
  // the store, leading to "apply" buttons that
  // operate on stale data.
  useEffect(() => {
    return () => {
      setControllerEditor(null);
    };
  }, [setControllerEditor]);

  if (load.kind === 'loading') {
    return (
      <div className={styles.placeholder}>
        <span>Loading…</span>
      </div>
    );
  }
  if (load.kind === 'error') {
    return (
      <div className={styles.placeholder} role="alert">
        <span className={styles.placeholderTitle}>Couldn’t open this file</span>
        <span className={styles.placeholderHint}>{load.message}</span>
      </div>
    );
  }
  if (load.kind === 'loaded' && load.encoding === 'binary') {
    return (
      <div className={styles.placeholder}>
        <span className={styles.placeholderTitle}>Binary file</span>
        <span className={styles.placeholderHint}>
          {path} — binary content can’t be edited here.
        </span>
      </div>
    );
  }

  return (
    <Editor
      path={path}
      language={language}
      value={content}
      theme="vs-dark"
      onMount={handleMount}
      onChange={(value) => {
        if (suppressNextChange.current) {
          suppressNextChange.current = false;
          return;
        }
        if (value !== undefined) onChange(value);
      }}
      options={{
        minimap: { enabled: true },
        fontSize: 13,
        fontFamily:
          'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
        lineNumbers: 'on',
        renderWhitespace: 'selection',
        tabSize: 2,
        automaticLayout: true,
        scrollBeyondLastLine: false,
        wordWrap: 'off',
      }}
    />
  );
}
