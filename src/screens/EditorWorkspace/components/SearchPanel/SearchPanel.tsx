import { useCallback, useEffect, useRef, useState } from 'react';

import { Button } from '@/shared/components';
import { PaneShell } from '../PaneShell';
import {
  SearchError as SearchErrorClass,
  workspaceSearch,
  type SearchMatch,
  type SearchResult,
} from '@/ipc';
import { useWorkspaceStore } from '@/shared/state/workspaceStore';
import { useEditorTabs } from '../../hooks/useEditorTabs';
import { useEditorControllerStore } from '../../state/editorControllerStore';
import styles from './SearchPanel.module.css';

const DEBOUNCE_MS = 200;
const MAX_RESULTS_DISPLAYED = 200;

/**
 * Workspace search panel — phase S.
 *
 * Walks the current workspace and returns a
 * flat list of substring matches. The
 * results are clickable; clicking a result
 * opens the file in the editor and jumps
 * the cursor to the match's line and column.
 *
 * Debounce: we wait 200 ms after the last
 * keystroke before kicking off a search.
 * For workspaces < 10k files this is fast
 * enough that the user feels the result
 * appear as they type.
 *
 * Cap: the UI displays at most
 * `MAX_RESULTS_DISPLAYED` rows even when
 * the Rust side returned more (the IPC
 * hard-cap is 1_000; we slice for the
 * viewport). The "X more matches not
 * shown" footer is shown when we slice.
 *
 * v1 limitations (documented in the
 * HANDOFF):
 *  - No cancellation. A pathological
 *    workspace (e.g. a huge
 *    `node_modules` that wasn't ignored)
 *    blocks until done.
 *  - Case-sensitive by default. The user
 *    gets a button to toggle.
 *  - Glob patterns in `extra_ignores` are
 *    NOT supported (Rust side is exact-
 *    name match only). `.lipiignore` is a
 *    follow-up.
 */
export function SearchPanel() {
  const rootPath = useWorkspaceStore((s) => s.currentPath);
  const { openFile } = useEditorTabs();
  const setPendingReveal = useEditorControllerStore(
    (s) => s.setPendingReveal,
  );

  const [query, setQuery] = useState('');
  const [caseInsensitive, setCaseInsensitive] = useState(false);
  const [status, setStatus] = useState<
    | { kind: 'idle' }
    | { kind: 'searching' }
    | { kind: 'done'; result: SearchResult }
    | { kind: 'error'; message: string }
  >({ kind: 'idle' });
  // Tracks the most recently-submitted
  // search id so a slow earlier search
  // can't overwrite the latest results.
  const requestIdRef = useRef(0);
  // Latest debounce timer.
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const runSearch = useCallback(
    async (
      q: string,
      ci: boolean,
      root: string,
    ): Promise<void> => {
      if (!q.trim() || !root) {
        setStatus({ kind: 'idle' });
        return;
      }
      const id = ++requestIdRef.current;
      setStatus({ kind: 'searching' });
      try {
        const result = await workspaceSearch({
          query: q,
          rootPath: root,
          caseInsensitive: ci,
        });
        // A newer request may have started
        // while we were waiting — drop the
        // late result.
        if (id !== requestIdRef.current) return;
        setStatus({ kind: 'done', result });
      } catch (err) {
        if (id !== requestIdRef.current) return;
        const msg =
          err instanceof SearchErrorClass
            ? `${err.payload.kind}: ${err.payload.detail}`
            : String(err);
        setStatus({ kind: 'error', message: msg });
      }
    },
    [],
  );

  // Debounce the search on every query
  // change. We cancel the previous
  // in-flight search by bumping
  // `requestIdRef`.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim() || !rootPath) {
      setStatus({ kind: 'idle' });
      return;
    }
    debounceRef.current = setTimeout(() => {
      void runSearch(query, caseInsensitive, rootPath);
    }, DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, caseInsensitive, rootPath, runSearch]);

  const onResultClick = useCallback(
    async (match: SearchMatch) => {
      // 1) Set a pending reveal so the
      //    editor jumps to the line as
      //    soon as Monaco mounts.
      setPendingReveal({
        path: match.path,
        line: match.line,
        column: match.column,
      });
      // 2) Open the file. The EditorPane
      //    sees the new activeTab and
      //    mounts Monaco; the mount
      //    handler reads `pendingReveal`
      //    and applies it.
      await openFile(match.path);
    },
    [openFile, setPendingReveal],
  );

  const displayed = (() => {
    if (status.kind !== 'done') return [];
    return status.result.matches.slice(0, MAX_RESULTS_DISPLAYED);
  })();
  const truncatedForUi =
    status.kind === 'done' &&
    status.result.matches.length > MAX_RESULTS_DISPLAYED;

  return (
    <PaneShell label="Search" area="side" headerAction={null}>
      <div className={styles.root}>
        <div className={styles.controls}>
          <input
            type="search"
            className={styles.queryInput}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search workspace…"
            aria-label="Search query"
            data-testid="search-query-input"
            disabled={!rootPath}
          />
          <Button
            variant={caseInsensitive ? 'primary' : 'ghost'}
            size="sm"
            onClick={() => setCaseInsensitive((v) => !v)}
            aria-label={
              caseInsensitive
                ? 'Case-insensitive search (on)'
                : 'Case-insensitive search (off)'
            }
            aria-pressed={caseInsensitive}
            title="Match case"
          >
            Aa
          </Button>
        </div>
        {!rootPath && (
          <div className={styles.placeholder}>
            Open a folder to search its files.
          </div>
        )}
        {rootPath && status.kind === 'idle' && !query.trim() && (
          <div className={styles.placeholder}>
            Type a query to search <code>{rootPath}</code>.
          </div>
        )}
        {rootPath && status.kind === 'searching' && (
          <div className={styles.placeholder}>Searching…</div>
        )}
        {rootPath && status.kind === 'error' && (
          <div className={styles.placeholderError} role="alert">
            {status.message}
          </div>
        )}
        {rootPath && status.kind === 'done' && (
          <>
            <div className={styles.summary}>
              {status.result.matches.length} match
              {status.result.matches.length === 1 ? '' : 'es'} in{' '}
              {status.result.filesScanned} file
              {status.result.filesScanned === 1 ? '' : 's'}
              {(status.result.truncated || truncatedForUi) && ' (truncated)'}
            </div>
            <ul className={styles.results} data-testid="search-results">
              {displayed.map((m, i) => (
                <li key={`${m.path}:${m.line}:${m.column}:${i}`}>
                  <button
                    type="button"
                    className={styles.resultRow}
                    onClick={() => void onResultClick(m)}
                  >
                    <span className={styles.resultPath} title={m.path}>
                      {m.path}
                    </span>
                    <span className={styles.resultLineMeta}>
                      :{m.line}:{m.column}
                    </span>
                    <span className={styles.resultLineText}>
                      {m.lineText}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {(status.result.truncated || truncatedForUi) && (
              <div className={styles.truncationNote}>
                Showing first {MAX_RESULTS_DISPLAYED} matches. Refine your
                query to see more.
              </div>
            )}
            {displayed.length === 0 && (
              <div className={styles.placeholder}>
                No matches for <code>{query}</code>.
              </div>
            )}
          </>
        )}
      </div>
    </PaneShell>
  );
}
