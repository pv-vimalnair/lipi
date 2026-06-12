import { useCallback, useEffect, useRef } from 'react';
import type { OnMount } from '@monaco-editor/react';
import Editor, { loader } from '@monaco-editor/react';

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
import styles from './EditorPane.module.css';

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
