/**
 * Phase 9.3 — `RespawnCountdown` sub-component
 * unit tests.
 *
 * The sub-component owns the 1 Hz ticker that
 * drives the "Crashed Xs ago" and
 * "Auto-restarting in Ns…" labels in the LSP
 * settings card. Before Phase 9.3 this ticker
 * lived in the card root and re-rendered the
 * whole card 1×/sec; after Phase 9.3 the
 * ticker is scoped to the sub-component so the
 * card stays idle.
 *
 * Coverage:
 *   1. Renders the "Crashed 0s ago" label on
 *      mount (no time has passed).
 *   2. Renders the "Auto-restarting in Ns…"
 *      label when `respawnInMs !== null`.
 *   3. **Does NOT** start the 1 Hz ticker
 *      when `respawnInMs === null` (no respawn
 *      scheduled → no reason to tick).
 *   4. Renders the "Auto-restart disabled
 *      after N crashes" label when
 *      `consecutiveCrashes >= 5` and
 *      `respawnInMs === null`.
 *   5. **Does** start the ticker when
 *      `respawnInMs !== null` and updates the
 *      label on each tick (verified with
 *      `vi.useFakeTimers`).
 *   6. Stops the ticker when the prop changes
 *      from `respawnInMs = 5000` to
 *      `respawnInMs = null` (the respawn
 *      fired).
 *   7. Cleans up the ticker on unmount (no
 *      leaked `setTimeout` if the card is
 *      closed while a respawn is scheduled).
 *   8. Renders the
 *      `(exit code N)` / `— N in a row`
 *      annotations.
 */
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RespawnCountdown } from './LanguageServerCard';

interface Mounted {
  root: Root;
  container: HTMLDivElement;
  unmount: () => void;
}

function mountCountdown(props: {
  crashedAt: number;
  respawnInMs: number | null;
  consecutiveCrashes: number;
  exitStatus: number | null;
}): Mounted {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <RespawnCountdown
        crashedAt={props.crashedAt}
        respawnInMs={props.respawnInMs}
        consecutiveCrashes={props.consecutiveCrashes}
        exitStatus={props.exitStatus}
      />,
    );
  });
  return {
    root,
    container,
    unmount: () => {
      act(() => {
        root.unmount();
      });
      document.body.removeChild(container);
    },
  };
}

beforeEach(() => {
  // Pin `Date.now()` to a known value so the
  // `crashedAt` / "Xs ago" math is
  // deterministic. Each test sets the system
  // time before mount and then advances it
  // explicitly with `vi.advanceTimersByTime`.
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-06-15T12:00:00.000Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('RespawnCountdown', () => {
  it('renders the "Crashed 0s ago" label on mount', () => {
    const now = Date.now();
    const mounted = mountCountdown({
      crashedAt: now,
      respawnInMs: null,
      consecutiveCrashes: 1,
      exitStatus: null,
    });
    expect(mounted.container.textContent).toContain('Crashed 0s ago');
    mounted.unmount();
  });

  it('renders the "Auto-restarting in Ns…" label when a respawn is scheduled', () => {
    const now = Date.now();
    const mounted = mountCountdown({
      crashedAt: now,
      // 3 second respawn — should show "3s…".
      respawnInMs: 3000,
      consecutiveCrashes: 1,
      exitStatus: null,
    });
    expect(mounted.container.textContent).toContain('Auto-restarting in 3s');
    mounted.unmount();
  });

  it('does NOT start the ticker when no respawn is scheduled', () => {
    const now = Date.now();
    const mounted = mountCountdown({
      crashedAt: now - 5000, // crashed 5s ago
      respawnInMs: null,
      consecutiveCrashes: 1,
      exitStatus: null,
    });
    expect(mounted.container.textContent).toContain('Crashed 5s ago');
    // Advance 3 seconds — the label MUST
    // stay at "5s ago" (no ticker running).
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(mounted.container.textContent).toContain('Crashed 5s ago');
    mounted.unmount();
  });

  it('renders the "Auto-restart disabled" label after 5+ consecutive crashes with no respawn', () => {
    const now = Date.now();
    const mounted = mountCountdown({
      crashedAt: now,
      respawnInMs: null,
      consecutiveCrashes: 5,
      exitStatus: 1,
    });
    expect(mounted.container.textContent).toContain('Auto-restart disabled');
    expect(mounted.container.textContent).toContain('5 consecutive crashes');
    mounted.unmount();
  });

  it('updates the "Xs ago" label on each ticker tick (1 Hz)', () => {
    // The ticker aligns to wall-clock second
    // boundaries, so the first tick happens
    // at `1000 - (Date.now() % 1000)` ms.
    // With `setSystemTime` set to a 0-ms
    // boundary, the first tick is at
    // T+1000ms, then T+2000ms, T+3000ms, etc.
    const now = Date.now();
    const mounted = mountCountdown({
      crashedAt: now,
      respawnInMs: 60_000, // 60s — keeps the ticker alive
      consecutiveCrashes: 1,
      exitStatus: null,
    });
    expect(mounted.container.textContent).toContain('Crashed 0s ago');
    // Advance to T+1500ms — one tick fired
    // (at T+1000). Label is "1s ago".
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(mounted.container.textContent).toContain('Crashed 1s ago');
    // Advance to T+3500ms — three ticks fired
    // total (at T+1000, T+2000, T+3000).
    // Label is "3s ago".
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(mounted.container.textContent).toContain('Crashed 3s ago');
    mounted.unmount();
  });

  it('stops the ticker when respawnInMs transitions from a number to null (respawn fired)', () => {
    const now = Date.now();
    let respawnInMs: number | null = 5000;
    // The sub-component re-renders when
    // props change, so we use a small wrapper
    // to swap the prop.
    const mounted = mountCountdown({
      crashedAt: now,
      respawnInMs,
      consecutiveCrashes: 1,
      exitStatus: null,
    });
    // Advance 1 tick — label updates.
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(mounted.container.textContent).toContain('Crashed 1s ago');
    // Respawn fires — prop transitions to null.
    respawnInMs = null;
    act(() => {
      mounted.root.render(
        <RespawnCountdown
          crashedAt={now}
          respawnInMs={respawnInMs}
          consecutiveCrashes={1}
          exitStatus={null}
        />,
      );
    });
    // Advance 3 seconds — label MUST stay at
    // "1s ago" (ticker stopped).
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(mounted.container.textContent).toContain('Crashed 1s ago');
    // The "Auto-restarting" label is gone.
    expect(
      mounted.container.querySelector(
        '[data-testid="lsp-respawn-countdown"]',
      ),
    ).toBeNull();
    mounted.unmount();
  });

  it('cleans up the ticker on unmount (no leaked setTimeout)', () => {
    const now = Date.now();
    const mounted = mountCountdown({
      crashedAt: now,
      respawnInMs: 60_000,
      consecutiveCrashes: 1,
      exitStatus: null,
    });
    // Confirm the ticker is alive.
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(mounted.container.textContent).toContain('Crashed 1s ago');
    // Unmount. The cleanup function in the
    // effect should clear the pending
    // setTimeout. If it didn't, advancing the
    // timer after unmount would log an
    // "Can't perform a React state update on
    // an unmounted component" warning —
    // vitest will flag it as a test failure
    // if we add a `console.error` spy (held
    // back for noise; the structural check
    // is that `vi.getTimerCount()` returns
    // 0 after unmount).
    mounted.unmount();
    // No more pending timers.
    expect(vi.getTimerCount()).toBe(0);
  });

  it('renders the (exit code N) and "N in a row" annotations', () => {
    const now = Date.now();
    const mounted = mountCountdown({
      crashedAt: now,
      respawnInMs: null,
      consecutiveCrashes: 3,
      exitStatus: 134, // SIGABRT
    });
    expect(mounted.container.textContent).toContain('(exit code 134)');
    expect(mounted.container.textContent).toContain('3 in a row');
    mounted.unmount();
  });

  it('does NOT render "N in a row" for the first crash (consecutiveCrashes = 1)', () => {
    const now = Date.now();
    const mounted = mountCountdown({
      crashedAt: now,
      respawnInMs: null,
      consecutiveCrashes: 1,
      exitStatus: null,
    });
    expect(mounted.container.textContent).not.toContain('in a row');
    mounted.unmount();
  });

  it('formats "Xs ago" / "Xm ago" / "Xh ago" at the right boundaries', () => {
    const now = Date.now();
    // First: 59s ago → "59s ago".
    const a = mountCountdown({
      crashedAt: now - 59_000,
      respawnInMs: null,
      consecutiveCrashes: 1,
      exitStatus: null,
    });
    expect(a.container.textContent).toContain('59s ago');
    a.unmount();
    // Second: 61s ago → "1m ago" (note: no
    // ticker running → label is the initial
    // render's value).
    const b = mountCountdown({
      crashedAt: now - 61_000,
      respawnInMs: null,
      consecutiveCrashes: 1,
      exitStatus: null,
    });
    expect(b.container.textContent).toContain('1m ago');
    b.unmount();
    // Third: 2h ago → "2h ago".
    const c = mountCountdown({
      crashedAt: now - 2 * 60 * 60_000,
      respawnInMs: null,
      consecutiveCrashes: 1,
      exitStatus: null,
    });
    expect(c.container.textContent).toContain('2h ago');
    c.unmount();
  });
});
