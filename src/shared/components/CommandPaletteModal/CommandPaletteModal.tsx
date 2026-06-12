/**
 * CommandPaletteModal — the
 * `Cmd-Shift-P` /
 * `Ctrl-Shift-P` launcher.
 *
 * Visual shape:
 *
 *   ┌─ Type a command ─────────────────┐
 *   │  [ openai                       ]│
 *   │                                  │
 *   │  AI                             ▾│
 *   │  ▸ Switch AI provider: OpenAI    │
 *   │    Switch AI provider: Anthropic │
 *   │                                  │
 *   │  ↑↓ to navigate · ↵ to run · esc│
 *   └──────────────────────────────────┘
 *
 * Behaviour:
 *   - Type to filter (fuzzy
 *     subsequence — see
 *     `commands.ts`).
 *   - `ArrowUp` / `ArrowDown` move
 *     the highlight. Clamped to
 *     `[0, results.length-1]`.
 *   - `Enter` runs the highlighted
 *     command (if `isEnabled`).
 *   - `Escape` closes.
 *   - Click on a row runs the
 *     command and closes.
 *   - Mouse hover on a row updates
 *     the highlight (so keyboard
 *     `Enter` after hover runs
 *     what the user just looked
 *     at).
 *
 * Filtering dev commands: in prod
 * builds, `import.meta.env.DEV` is
 * `false` and we drop any command
 * with `isDev: true` before
 * filtering. The `Cmd-Shift-D`
 * shortcut still works (it
 * lives in its own hook, see
 * `useDeviceEmulatorShortcutWhenDev`).
 *
 * a11y:
 *   - `role="combobox"` on the
 *     input + `aria-controls` +
 *     `aria-activedescendant` on
 *     the listbox.
 *   - `role="listbox"` on the
 *     results + `role="option"` on
 *     each row + `aria-selected`.
 *   - Disabled rows get
 *     `aria-disabled="true"` (NOT
 *     the `disabled` attribute —
 *     the row is still focusable
 *     for screen readers, so the
 *     user can hear "this is
 *     disabled").
 *
 * Why not a portal? The modal is
 * always mounted in `main.tsx`
 * (above the screen router), so
 * there's no z-index escape
 * issue with screen-local
 * overlays (the
 * `ConfirmToolCallModal` is
 * `z-index: 9000`; the palette
 * uses `10000` so it wins on
 * conflicts).
 */
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  type ChangeEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react';

import { Modal, KeyHint } from '@/shared/components';
import {
  filterCommands,
  getRecentsCommands,
  type Command,
  type ScoredCommand,
} from '@/shared/commands/commands';
import {
  useCommandPaletteStore,
} from '@/shared/state/commandPaletteStore';
import {
  useWorkspaceStore,
} from '@/shared/state/workspaceStore';

import styles from './CommandPaletteModal.module.css';

const IS_DEV = import.meta.env.DEV;

/** Single-term subsequence
 *  match (case-sensitive
 *  only by convention —
 *  the caller lower-cases
 *  the haystack). Same
 *  algorithm as the static
 *  `subsequenceMatch` in
 *  `commands.ts`; we keep
 *  a copy here so the
 *  recents-scoring path
 *  doesn't pull in the
 *  whole registry. */
function subsequenceMatchInline(
  needle: string,
  haystack: string,
): boolean {
  let i = 0;
  for (let j = 0; j < haystack.length; j++) {
    if (i >= needle.length) return true;
    if (needle[i] === haystack[j]) i++;
  }
  return i >= needle.length;
}

/** Score a single command
 *  against a query using
 *  the same scheme as
 *  `filterCommands` (prefix
 *  0, exact 1, subsequence
 *  2, subtitle 3, keyword
 *  4). Returns `null` if
 *  the command doesn't
 *  match. */
function scoreOne(
  cmd: Command,
  query: string,
): ScoredCommand | null {
  const q = query.trim().toLowerCase();
  if (q === '') return { command: cmd, score: 0 };
  const terms = q.split(/\s+/).filter((t) => t.length > 0);
  const title = cmd.title.toLowerCase();
  const subtitle = (cmd.subtitle ?? '').toLowerCase();
  const keywords = (cmd.keywords ?? []).map((k) =>
    k.toLowerCase(),
  );
  let matched = true;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const term of terms) {
    let termMatched = false;
    if (subsequenceMatchInline(term, title)) {
      termMatched = true;
      if (title === term) {
        bestScore = Math.min(bestScore, 1);
      } else if (title.startsWith(term)) {
        bestScore = Math.min(bestScore, 0);
      } else {
        bestScore = Math.min(bestScore, 2);
      }
    }
    if (subsequenceMatchInline(term, subtitle)) {
      termMatched = true;
      bestScore = Math.min(bestScore, 3);
    }
    for (const kw of keywords) {
      if (subsequenceMatchInline(term, kw)) {
        termMatched = true;
        bestScore = Math.min(bestScore, 4);
        break;
      }
    }
    if (!termMatched) {
      matched = false;
      break;
    }
  }
  return matched ? { command: cmd, score: bestScore } : null;
}

function isCommandEnabled(cmd: Command): boolean {
  if (cmd.isDev && !IS_DEV) return false;
  if (cmd.isEnabled && !cmd.isEnabled()) return false;
  return true;
}

export function CommandPaletteModal(): JSX.Element | null {
  const open = useCommandPaletteStore((s) => s.open);
  const query = useCommandPaletteStore((s) => s.query);
  const selectedIndex = useCommandPaletteStore((s) => s.selectedIndex);
  const hide = useCommandPaletteStore((s) => s.hide);
  const setQuery = useCommandPaletteStore((s) => s.setQuery);
  const setSelection = useCommandPaletteStore(
    (s) => s.setSelection,
  );

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const titleId = useId();

  // Subscribe to the recents
  // list so the palette re-
  // renders when the user
  // opens / closes folders.
  // We don't use the value
  // directly here — it's
  // re-read inside
  // `getRecentsCommands()`
  // for the latest snapshot
  // — but the subscription
  // is what causes the
  // re-render.
  useWorkspaceStore((s) => s.recents);

  // Compute the filtered list.
  // The list is the union of
  // the static `COMMANDS`
  // registry and the dynamic
  // recents list. We run
  // `filterCommands` once on
  // the static registry, and
  // score the recents inline
  // (the recents are a
  // small, bounded set — max
  // 5 entries — so duplicating
  // the scoring logic is
  // cheaper than wiring up
  // a second filter call).
  const results = useMemo<ScoredCommand[]>(() => {
    const filtered = filterCommands(query);
    const recentsCmds = getRecentsCommands();
    const recentsScored: ScoredCommand[] = [];
    for (const cmd of recentsCmds) {
      const scored = scoreOne(cmd, query);
      if (scored !== null) recentsScored.push(scored);
    }
    const all = [...filtered, ...recentsScored];
    if (IS_DEV) return all;
    return all.filter((r) => !r.command.isDev);
  }, [query]);
  // The "effective" count is
  // `results.length` — used to
  // clamp the highlight.
  const effectiveCount = results.length;
  // The store's selectedIndex is
  // a pure counter (it doesn't
  // clamp). We display
  // `clampedIndex` instead.
  const clampedIndex =
    effectiveCount === 0
      ? -1
      : Math.max(0, Math.min(selectedIndex, effectiveCount - 1));
  // Track which result rows
  // are currently disabled so
  // the Enter handler can
  // skip them.
  const isEnabled = useMemo(
    () => results.map((r) => isCommandEnabled(r.command)),
    [results],
  );

  // When the modal opens, focus
  // the input and re-clamp the
  // selection.
  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
    }
  }, [open]);

  // Keep the highlighted row in
  // view as the user arrows
  // around. Without this, the
  // user can press Down past
  // the bottom of the visible
  // list and the highlight
  // scrolls off-screen.
  useEffect(() => {
    if (!open || clampedIndex < 0) return;
    const el = listRef.current?.querySelector<HTMLElement>(
      `[data-row-index="${clampedIndex}"]`,
    );
    el?.scrollIntoView({ block: 'nearest' });
  }, [open, clampedIndex]);

  // Run the highlighted command
  // and close the modal. Fire-
  // and-forget — the modal
  // doesn't await (commands can
  // be async; their errors are
  // surfaced by the called
  // store, not the palette).
  const runHighlighted = useCallback(() => {
    if (clampedIndex < 0) return;
    const result = results[clampedIndex];
    if (!result) return;
    if (!isEnabled[clampedIndex]) return;
    void result.command.run();
    hide();
  }, [clampedIndex, results, isEnabled, hide]);

  // Keyboard handler for the
  // INPUT only. The Modal
  // primitive's ESC handler
  // closes the modal; the input
  // handler deals with Up /
  // Down / Enter.
  const onInputKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (effectiveCount === 0) return;
        // Move by 1, then clamp in
        // render via `clampedIndex`.
        // We pre-clamp here too so
        // the store doesn't accumulate
        // a runaway index when the
        // list shrinks (e.g. user
        // types more).
        const next = Math.min(
          selectedIndex + 1,
          effectiveCount - 1,
        );
        setSelection(next);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (effectiveCount === 0) return;
        const next = Math.max(selectedIndex - 1, 0);
        setSelection(next);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        runHighlighted();
      } else if (e.key === 'Home') {
        // Optional nicety: jump to
        // top.
        e.preventDefault();
        setSelection(0);
      } else if (e.key === 'End') {
        e.preventDefault();
        if (effectiveCount > 0) {
          setSelection(effectiveCount - 1);
        }
      } else if (e.key === 'Tab') {
        // Trap focus in the input.
        // The Modal primitive
        // already traps focus
        // within the panel; this
        // is belt-and-braces.
        e.preventDefault();
      }
    },
    [
      effectiveCount,
      selectedIndex,
      setSelection,
      runHighlighted,
    ],
  );

  const onQueryChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      setQuery(e.target.value);
    },
    [setQuery],
  );

  // Click on a row: run + close.
  // We DON'T update the
  // highlighted index on
  // `mousedown` — only on
  // `click` — so accidental
  // drag-overs don't trigger
  // runs.
  const onRowClick = useCallback(
    (
      e: ReactMouseEvent<HTMLLIElement>,
      index: number,
    ) => {
      e.preventDefault();
      if (!isEnabled[index]) return;
      const result = results[index];
      if (!result) return;
      void result.command.run();
      hide();
    },
    [isEnabled, results, hide],
  );

  // Mouse hover: update
  // highlight so Enter after
  // hover runs the hovered
  // row. We only update on
  // `mouseenter` (not
  // `mousemove`) to avoid
  // excessive store writes.
  const onRowMouseEnter = useCallback(
    (index: number) => {
      if (!isEnabled[index]) return;
      setSelection(index);
    },
    [isEnabled, setSelection],
  );

  if (!open) return null;

  return (
    <Modal
      open={open}
      onClose={hide}
      titleId={titleId}
      label="Command palette"
      className={styles.panel}
    >
      <div className={styles.header} data-testid="cmd-palette-header">
        <span
          id={titleId}
          className={styles.headerLabel}
          data-testid="cmd-palette-title"
        >
          Type a command
        </span>
        <input
          ref={inputRef}
          type="text"
          className={styles.input}
          value={query}
          onChange={onQueryChange}
          onKeyDown={onInputKeyDown}
          placeholder="Search commands…"
          spellCheck={false}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          role="combobox"
          aria-expanded="true"
          aria-controls="cmd-palette-listbox"
          aria-autocomplete="list"
          aria-activedescendant={
            clampedIndex >= 0
              ? `cmd-palette-row-${clampedIndex}`
              : undefined
          }
          data-testid="cmd-palette-input"
        />
      </div>
      {effectiveCount === 0 ? (
        <div
          className={styles.empty}
          data-testid="cmd-palette-empty"
        >
          No matching commands
        </div>
      ) : (
        <ul
          ref={listRef}
          id="cmd-palette-listbox"
          className={styles.list}
          role="listbox"
          aria-label="Command palette results"
          data-testid="cmd-palette-list"
        >
          {results.map((r, index) => {
            const cmd = r.command;
            const enabled = isEnabled[index];
            const selected = index === clampedIndex;
            const groupChanged =
              index === 0 ||
              results[index - 1]!.command.group !== cmd.group;
            return (
              <li
                key={cmd.id}
                id={`cmd-palette-row-${index}`}
                role="option"
                aria-selected={selected}
                aria-disabled={!enabled}
                data-row-index={index}
                data-cmd-id={cmd.id}
                data-testid="cmd-palette-row"
                data-enabled={enabled ? 'true' : 'false'}
                data-selected={selected ? 'true' : 'false'}
                className={[
                  styles.row,
                  selected ? styles.rowSelected : '',
                  !enabled ? styles.rowDisabled : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                onClick={(e) => onRowClick(e, index)}
                onMouseEnter={() => onRowMouseEnter(index)}
              >
                {groupChanged && (
                  <div
                    className={styles.groupHeader}
                    data-testid="cmd-palette-group"
                    data-group={cmd.group}
                  >
                    {cmd.group}
                  </div>
                )}
                <div className={styles.rowMain}>
                  <div className={styles.rowText}>
                    <div className={styles.rowTitle}>{cmd.title}</div>
                    {cmd.subtitle && (
                      <div className={styles.rowSubtitle}>
                        {cmd.subtitle}
                      </div>
                    )}
                  </div>
                  {cmd.shortcut && (
                    <div className={styles.rowShortcut}>
                      {cmd.shortcut.map((k, i) => (
                        <KeyHint
                          key={i}
                          label={k}
                          primary={i === 0 && (k === 'Cmd' || k === 'Ctrl')}
                          shift={k === 'Shift'}
                          alt={k === 'Alt'}
                        />
                      ))}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <div
        className={styles.footer}
        data-testid="cmd-palette-footer"
      >
        <span className={styles.footerHint}>
          <KeyHint label="↑" /> <KeyHint label="↓" /> to navigate
        </span>
        <span className={styles.footerHint}>
          <KeyHint label="↵" primary /> to run
        </span>
        <span className={styles.footerHint}>
          <KeyHint label="esc" /> to close
        </span>
      </div>
    </Modal>
  );
}
