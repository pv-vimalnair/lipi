/**
 * Tests for `useCommandPaletteStore` (the
 * Cmd-Shift-P / Ctrl-Shift-P command
 * palette).
 *
 * Per project convention, one test file
 * per store. The tests are
 * store-state-only — no React, no
 * rendering. The modal component is
 * covered by manual QA + the broader
 * editor smoke checks.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { useCommandPaletteStore } from './commandPaletteStore';

const initial = () => ({
  open: false,
  query: '',
  selectedIndex: 0,
});

describe('useCommandPaletteStore', () => {
  beforeEach(() => {
    useCommandPaletteStore.setState(initial());
  });
  afterEach(() => {
    useCommandPaletteStore.setState(initial());
  });

  it('starts closed with an empty query and selectedIndex 0', () => {
    const s = useCommandPaletteStore.getState();
    expect(s.open).toBe(false);
    expect(s.query).toBe('');
    expect(s.selectedIndex).toBe(0);
  });

  it('show() opens the palette and clears stale state', () => {
    // Pre-populate stale state to
    // verify `show` clears it.
    useCommandPaletteStore.setState({
      open: false,
      query: 'old',
      selectedIndex: 5,
    });
    useCommandPaletteStore.getState().show();
    expect(useCommandPaletteStore.getState()).toMatchObject({
      open: true,
      query: '',
      selectedIndex: 0,
    });
  });

  it('hide() closes the palette but preserves query / selection (so reopening keeps context)', () => {
    useCommandPaletteStore.setState({
      open: true,
      query: 'openai',
      selectedIndex: 2,
    });
    useCommandPaletteStore.getState().hide();
    const s = useCommandPaletteStore.getState();
    expect(s.open).toBe(false);
    // We deliberately preserve
    // `query` and `selectedIndex`
    // — the user might want to
    // re-open and continue. The
    // modal renders nothing when
    // `open === false` so the
    // values are inert.
    expect(s.query).toBe('openai');
    expect(s.selectedIndex).toBe(2);
  });

  it('setQuery updates the query AND resets selectedIndex to 0', () => {
    useCommandPaletteStore.setState({ selectedIndex: 7 });
    useCommandPaletteStore.getState().setQuery('open');
    const s = useCommandPaletteStore.getState();
    expect(s.query).toBe('open');
    expect(s.selectedIndex).toBe(0);
  });

  it('setQuery("") (clearing) also resets selectedIndex', () => {
    useCommandPaletteStore.setState({ selectedIndex: 3 });
    useCommandPaletteStore.getState().setQuery('');
    const s = useCommandPaletteStore.getState();
    expect(s.query).toBe('');
    expect(s.selectedIndex).toBe(0);
  });

  it('moveSelection(1) increments by 1', () => {
    useCommandPaletteStore.setState({ selectedIndex: 2 });
    useCommandPaletteStore.getState().moveSelection(1);
    expect(useCommandPaletteStore.getState().selectedIndex).toBe(3);
  });

  it('moveSelection(-1) decrements by 1', () => {
    useCommandPaletteStore.setState({ selectedIndex: 2 });
    useCommandPaletteStore.getState().moveSelection(-1);
    expect(useCommandPaletteStore.getState().selectedIndex).toBe(1);
  });

  it('moveSelection does NOT clamp — the modal does that against the filtered list length', () => {
    // The store is a pure state
    // primitive; it doesn't know
    // how many results the filter
    // returned. The modal is
    // responsible for clamping to
    // [0, results.length-1]. We
    // can move beyond those bounds
    // — the modal will treat any
    // out-of-range value as "no
    // selection" (negative) or
    // "clamp to last" (over-max).
    useCommandPaletteStore.setState({ selectedIndex: 0 });
    useCommandPaletteStore.getState().moveSelection(-1);
    expect(useCommandPaletteStore.getState().selectedIndex).toBe(-1);
  });

  it('setSelection sets an explicit index', () => {
    useCommandPaletteStore.getState().setSelection(4);
    expect(useCommandPaletteStore.getState().selectedIndex).toBe(4);
  });

  it('full lifecycle: show -> type -> navigate -> hide', () => {
    useCommandPaletteStore.getState().show();
    expect(useCommandPaletteStore.getState().open).toBe(true);
    useCommandPaletteStore.getState().setQuery('openai');
    useCommandPaletteStore.getState().moveSelection(1);
    useCommandPaletteStore.getState().moveSelection(1);
    useCommandPaletteStore.getState().hide();
    const s = useCommandPaletteStore.getState();
    expect(s.open).toBe(false);
    expect(s.query).toBe('openai');
    expect(s.selectedIndex).toBe(2);
  });
});
