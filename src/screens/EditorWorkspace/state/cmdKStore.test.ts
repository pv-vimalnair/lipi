/**
 * Tests for `cmdKStore.ts` — the Zustand store
 * driving the Cmd-K modal (5b-5).
 *
 * The store is a small state machine:
 *   idle → streaming → done | error → idle
 *
 * We test each transition and the reset
 * semantics on close.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { useCmdKStore } from './cmdKStore';

const SAMPLE_SELECTION = {
  text: 'const x = 1;',
  range: {
    startLineNumber: 1,
    startColumn: 1,
    endLineNumber: 1,
    endColumn: 14,
  },
};

describe('cmdKStore (5b-5)', () => {
  beforeEach(() => {
    // Reset to the initial state between
    // tests — the store is a module
    // singleton.
    useCmdKStore.setState({
      open: false,
      selection: null,
      instruction: '',
      streamingMessageId: null,
      status: 'idle',
    });
  });

  it('starts closed with no selection', () => {
    const s = useCmdKStore.getState();
    expect(s.open).toBe(false);
    expect(s.selection).toBeNull();
    expect(s.instruction).toBe('');
    expect(s.streamingMessageId).toBeNull();
    expect(s.status).toBe('idle');
  });

  it('openCmdK opens the modal and stores the selection (clearing any previous instruction)', () => {
    useCmdKStore.setState({ instruction: 'leftover from before' });
    useCmdKStore.getState().openCmdK(SAMPLE_SELECTION);
    const s = useCmdKStore.getState();
    expect(s.open).toBe(true);
    expect(s.selection).toEqual(SAMPLE_SELECTION);
    expect(s.instruction).toBe('');
    expect(s.status).toBe('idle');
    expect(s.streamingMessageId).toBeNull();
  });

  it('setInstruction updates the instruction text', () => {
    useCmdKStore.getState().openCmdK(SAMPLE_SELECTION);
    useCmdKStore.getState().setInstruction('add a JSDoc comment');
    expect(useCmdKStore.getState().instruction).toBe(
      'add a JSDoc comment',
    );
  });

  it('setStreaming moves to the streaming status and stores the message id', () => {
    useCmdKStore.getState().openCmdK(SAMPLE_SELECTION);
    useCmdKStore.getState().setStreaming('msg_abc');
    const s = useCmdKStore.getState();
    expect(s.status).toBe('streaming');
    expect(s.streamingMessageId).toBe('msg_abc');
  });

  it('setDone moves from streaming to done (keeps the message id for the result view)', () => {
    useCmdKStore.getState().openCmdK(SAMPLE_SELECTION);
    useCmdKStore.getState().setStreaming('msg_abc');
    useCmdKStore.getState().setDone();
    const s = useCmdKStore.getState();
    expect(s.status).toBe('done');
    expect(s.streamingMessageId).toBe('msg_abc');
  });

  it('setError moves from streaming to error (keeps the message id)', () => {
    useCmdKStore.getState().openCmdK(SAMPLE_SELECTION);
    useCmdKStore.getState().setStreaming('msg_abc');
    useCmdKStore.getState().setError();
    const s = useCmdKStore.getState();
    expect(s.status).toBe('error');
    expect(s.streamingMessageId).toBe('msg_abc');
  });

  it('resetToIdle moves from error back to idle (preserves the instruction for re-try)', () => {
    useCmdKStore.getState().openCmdK(SAMPLE_SELECTION);
    useCmdKStore.getState().setInstruction('convert to async');
    useCmdKStore.getState().setStreaming('msg_abc');
    useCmdKStore.getState().setError();
    useCmdKStore.getState().resetToIdle();
    const s = useCmdKStore.getState();
    expect(s.status).toBe('idle');
    expect(s.instruction).toBe('convert to async');
    expect(s.selection).toEqual(SAMPLE_SELECTION);
    expect(s.streamingMessageId).toBeNull();
  });

  it('resetToIdle is a no-op when not in the error state', () => {
    useCmdKStore.getState().openCmdK(SAMPLE_SELECTION);
    useCmdKStore.getState().setStreaming('msg_abc');
    useCmdKStore.getState().setDone();
    useCmdKStore.getState().resetToIdle();
    // Still 'done' — resetToIdle only acts on
    // 'error'.
    expect(useCmdKStore.getState().status).toBe('done');
  });

  it('closeCmdK resets every transient field', () => {
    useCmdKStore.getState().openCmdK(SAMPLE_SELECTION);
    useCmdKStore.getState().setInstruction('add a JSDoc comment');
    useCmdKStore.getState().setStreaming('msg_abc');
    useCmdKStore.getState().setDone();
    useCmdKStore.getState().closeCmdK();
    const s = useCmdKStore.getState();
    expect(s.open).toBe(false);
    expect(s.selection).toBeNull();
    expect(s.instruction).toBe('');
    expect(s.streamingMessageId).toBeNull();
    expect(s.status).toBe('idle');
  });
});
