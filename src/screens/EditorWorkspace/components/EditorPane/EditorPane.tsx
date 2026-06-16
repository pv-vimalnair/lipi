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
import { useInlineEditOverlay } from '../../hooks/useInlineEditOverlay';
import { useMonacoLspBridge } from '../../hooks/useMonacoLspBridge';
import { useTsConfigStore } from '../../state/tsConfigStore';
import { configureLanguageServices } from '../../workers/configureLanguageServices';
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
 *   - D-145: a single Monaco instance is mounted for
 *     the lifetime of the pane. When the active tab
 *     changes, the `<Editor>` component's `path` prop
 *     triggers an in-place `editor.setModel(model)`
 *     (no remount, no instance swap). We use `onChange`
 *     to push edits back to the store; the store
 *     recomputes the dirty bit.
 *   - Ctrl/Cmd+S calls `useEditorTabs().saveActive()`. We register
 *     the shortcut here (not in the workspace) so it only fires
 *     when the editor pane is mounted.
 *
 * Phase 5b-5 wiring:
 *   - On `onMount` we also write the live Monaco instance to the
 *     `editorControllerStore` so features outside the pane
 *     (currently `AIPanel/CmdKModal`, later the command palette
 *     and the diff view) can read the current selection, replace
 *     text, and call other editor methods.
 *
 * D-145 (Phase 9.2f follow-up) — single Monaco instance:
 *   The pre-D-145 design keyed `<ActiveEditor>` on
 *   `key={activeTab.id}` so the Monaco instance was destroyed
 *   and remounted on every tab switch. That was correct but
 *   expensive: the controller store flashed `null` between
 *   unmount + remount (CmdKModal briefly lost its handle), the
 *   `useMonacoLspBridge` effect re-ran (re-discovering all
 *   models, re-registering per-kind provider sets), and
 *   `useInlineEditOverlay` tore down + re-mounted its
 *   widget / decorations / keybindings.
 *
 *   D-145 drops the `key={activeTab.id}`. The
 *   `@monaco-editor/react` `Editor` component handles the
 *   model swap in place — when the `path` prop changes, it
 *   looks up an existing model by URI, restores the saved
 *   view state (scroll / selection / undo stack), and calls
 *   `editor.setModel(model)`. No instance swap, no effect
 *   re-run, no store flash. The 9.2f bridge aggregator
 *   tracks models globally via `monaco.editor.getModels()` +
 *   `onDidCreateModel`, so the persistent-editor design is
 *   fully forward-compatible with the bridge.
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
            // D-145: no `key={activeTab.id}` — the
            // Monaco instance persists across tab
            // switches. The `@monaco-editor/react`
            // `Editor` component handles the model
            // swap in place when the `path` prop
            // changes (looks up the model by URI,
            // restores view state, calls
            // `editor.setModel(model)`). This is the
            // whole point of D-145 — no instance
            // remount, no effect re-run, no
            // controller-store flash.
            <ActiveEditor
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

  // Push external content into Monaco (e.g. when the
  // active file is reloaded from disk by the file
  // watcher, or when the AI panel applies an edit).
  //
  // D-145: this effect is now ONLY for "external
  // content update while the active tab is the same".
  // Tab switches go through the `<Editor>` component's
  // `path` prop, which calls `editor.setModel(model)`
  // internally with the new tab's pre-existing model
  // (already loaded with B's content). The `[content,
  // path]` dep + the "path changed" early-return makes
  // the two code paths non-overlapping: the
  // `setValue` branch only fires for a same-tab
  // content change (e.g. external reload), and the
  // tab-switch path is owned entirely by the
  // `Editor` component's internal model swap.
  useEffect(() => {
    if (!editorRef.current) return;
    // D-145: skip on tab switch. The `<Editor>`
    // component's `path`-driven `setModel` is the
    // authority on what content Monaco shows; the
    // `setValue` below is only for same-tab external
    // updates (file-watcher reload, AI panel apply).
    const currentPath = editorRef.current.getModel()?.uri.path;
    if (currentPath !== path) return;
    if (editorRef.current.getValue() === content) return;
    suppressNextChange.current = true;
    editorRef.current.setValue(content);
  }, [content, path]);

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
    // workspace. D-145: this runs only on the
    // first mount now (the editor instance
    // persists across tab switches), so the
    // "re-applies on every tab switch" comment
    // is stale — the TS service is global state
    // and the model swap doesn't need a
    // re-configure.
    configureTsServiceOnce();
    // Phase 7.1.1: same idempotency pattern
    // for JSON / CSS / HTML defaults. The
    // defaults are also global Monaco state,
    // so configuring them on the first mount
    // is enough — model swaps don't re-trigger
    // the configuration.
    configureLanguageServices();
    applyDiscoveredTsConfig();
  }, [setControllerEditor]);

  // Phase S: apply a `pendingReveal` request when the
  // active tab's path matches the queued request.
  // D-145: this used to live inside `handleMount`
  // (which only fires once now, on first mount).
  // We now subscribe to the editor's
  // `onDidChangeModel` event so we fire whenever
  // Monaco swaps models (i.e. whenever the
  // `<Editor>` component's internal `useUpdate`
  // calls `editor.setModel(newModel)` in response
  // to the `path` prop changing). This is the
  // exact "model swap just happened" event we
  // need — checking `path` against the new
  // model's URI is robust to whatever order the
  // `Editor` component's effects run in.
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const subscription = editor.onDidChangeModel(() => {
      const pending = useEditorControllerStore.getState().pendingReveal;
      const currentPath = editor.getModel()?.uri.path;
      // `currentPath` is the Monaco URI's `.path`
      // (e.g. `/c:/path/to/file.ts` on Windows,
      // `/path/to/file.ts` on POSIX). The search
      // panel stores the absolute path it received
      // from `findInFiles`, which Monaco uses
      // verbatim to construct the URI. We compare
      // suffixes: the pending path is the
      // workspace-relative-or-absolute path the
      // user searched for; the model URI's path
      // includes the scheme-stripped absolute.
      // The pre-D-145 code compared full paths
      // verbatim; the new code is `endsWith` to
      // handle Windows drive-letter differences
      // between the search hit and the URI
      // construction.
      if (
        pending &&
        currentPath &&
        (currentPath === pending.path ||
          currentPath.endsWith(pending.path))
      ) {
        const line = Math.max(1, pending.line);
        const column = Math.max(1, pending.column);
        editor.revealLineInCenter(line);
        editor.setPosition({ lineNumber: line, column });
        editor.focus();
        setPendingReveal(null);
      }
    });
    return () => subscription.dispose();
  }, [setPendingReveal]);

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
  // the active editor unmounts. D-145: with the
  // single-Monaco refactor, `ActiveEditor` no
  // longer remounts on tab switch — the cleanup
  // below now only fires on real screen
  // navigation (when the whole `EditorPane`
  // dies), which is exactly the case it was
  // designed to handle. Pre-D-145 this effect
  // also fired on every tab switch, briefly
  // flashing the controller store to `null` and
  // forcing `CmdKModal` + `useInlineEditOverlay`
  // to re-mount; D-145 fixes that.
  useEffect(() => {
    return () => {
      setControllerEditor(null);
    };
  }, [setControllerEditor]);

  // Phase 8: mount the inline-edit overlay +
  // decoration collection + Tab/Esc keybindings
  // for the live editor. The hook is a no-op
  // when `editor` is null (e.g. before the first
  // mount, or after a tab switch). On every
  // `handleMount`, a new editor instance is
  // written to the controller store, and the
  // `useInlineEditOverlay` hook tears down the
  // previous instance's widget / decorations
  // / keybindings (the effect's cleanup
  // function) and sets up the new instance's
  // — the same pattern as the 5b-5 controller-
  // store write above.
  //
  // We read the live editor from the
  // controller store on every render (instead
  // of taking it from `handleMount`'s closure)
  // so the hook's `useEffect` can react to
  // tab switches without us having to wire
  // a custom event.
  const liveEditor = useEditorControllerStore((s) => s.editor);
  useInlineEditOverlay({ editor: liveEditor });
  // Phase 9 (Tiniest scope) — wire the live
  // Monaco editor to the real
  // `typescript-language-server` for
  // cross-file go-to-def, find-references,
  // rename, code actions, etc. The bridge
  // is a no-op when the user has flipped
  // the kill switch in settings or when
  // the LSP server isn't on PATH.
  useMonacoLspBridge({
    editor: liveEditor,
  });

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
