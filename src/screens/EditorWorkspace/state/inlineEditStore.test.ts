/**
 * Tests for `inlineEditStore.ts` — the Zustand
 * store that drives the Phase 8 `Cmd+K` inline
 * AI edit flow.
 *
 * Carries over the 5b-5 `cmdKStore.test.ts`
 * coverage (now: 9 tests, renamed to match the
 * new action names) and adds the two new
 * Phase 8 actions:
 *   - `accept()` calls `editor.executeEdits` +
 *     `pushUndoStop` (verified by mocking the
 *     `editorControllerStore`)
 *   - `reject()` clears state without calling
 *     `executeEdits`
 *
 * Phase 8.1 added 9 more tests covering the
 * streaming-content fields:
 *   - initial empty value
 *   - `open` / `beginStream` reset to ""
 *   - `appendStreaming` appends / no-op on empty / caps at the cap
 *   - `setStreamingContent` replaces / caps at the cap
 *   - `accept` / `reject` / `close` / `resetToIdle` all clear it
 *
 * Coverage:
 *   1. starts idle, null selection
 *   2. `open({ text, range })` sets selection + status
 *   3. `setInstruction` updates the instruction string
 *   4. `beginStream(messageId)` transitions to `'streaming'`
 *   5. `sealProposal(text)` transitions to `'done'` + stores the proposal
 *   6. `fail(kind, message)` transitions to `'error'`
 *   7. `accept()` calls both `pushUndoStop` and `executeEdits`, clears state
 *   8. `reject()` clears state, does NOT call `executeEdits`
 *   9. `close()` is an alias for `reject` (no executeEdits)
 *   10–18. Phase 8.1 streaming-content coverage
 */

import { afterEach, describe, expect, it } from 'vitest';

import { useEditorControllerStore } from './editorControllerStore';
import {
  useInlineEditStore,
  STREAMING_PREVIEW_MAX_CHARS,
  type InlineEditSelection,
} from './inlineEditStore';

const SAMPLE_SELECTION: InlineEditSelection = {
  text: 'const x = 1;',
  range: {
    startLineNumber: 1,
    startColumn: 1,
    endLineNumber: 1,
    endColumn: 14,
  },
};

describe('inlineEditStore (Phase 8)', () => {
  afterEach(() => {
    useInlineEditStore.setState({
      selection: null,
      instruction: '',
      streamingMessageId: null,
      status: 'idle',
      proposal: null,
      streamingContent: '',
      error: null,
    });
    useEditorControllerStore.setState({ editor: null });
  });

  it('starts idle with a null selection', () => {
    const s = useInlineEditStore.getState();
    expect(s.selection).toBeNull();
    expect(s.instruction).toBe('');
    expect(s.streamingMessageId).toBeNull();
    expect(s.status).toBe('idle');
    expect(s.proposal).toBeNull();
    expect(s.error).toBeNull();
  });

  it('open() sets the selection + status and clears any previous instruction', () => {
    useInlineEditStore.setState({ instruction: 'leftover from before' });
    useInlineEditStore.getState().open(SAMPLE_SELECTION);
    const s = useInlineEditStore.getState();
    expect(s.selection).toEqual(SAMPLE_SELECTION);
    expect(s.instruction).toBe('');
    expect(s.status).toBe('idle');
    expect(s.streamingMessageId).toBeNull();
    expect(s.proposal).toBeNull();
    expect(s.error).toBeNull();
  });

  it('setInstruction updates the instruction string', () => {
    useInlineEditStore.getState().open(SAMPLE_SELECTION);
    useInlineEditStore.getState().setInstruction('add a JSDoc comment');
    expect(useInlineEditStore.getState().instruction).toBe(
      'add a JSDoc comment',
    );
  });

  it('beginStream(messageId) transitions to streaming and stores the message id', () => {
    useInlineEditStore.getState().open(SAMPLE_SELECTION);
    useInlineEditStore.getState().beginStream('msg_abc');
    const s = useInlineEditStore.getState();
    expect(s.status).toBe('streaming');
    expect(s.streamingMessageId).toBe('msg_abc');
  });

  it('sealProposal(text) transitions to done and stores the proposal', () => {
    useInlineEditStore.getState().open(SAMPLE_SELECTION);
    useInlineEditStore.getState().beginStream('msg_abc');
    useInlineEditStore
      .getState()
      .sealProposal('const x: number = 1;');
    const s = useInlineEditStore.getState();
    expect(s.status).toBe('done');
    expect(s.proposal).toBe('const x: number = 1;');
    // The streaming message id is preserved
    // (the consumer can still look up the
    // original aiStore message for context).
    expect(s.streamingMessageId).toBe('msg_abc');
  });

  it('fail(kind, message) transitions to error and stores the error', () => {
    useInlineEditStore.getState().open(SAMPLE_SELECTION);
    useInlineEditStore.getState().beginStream('msg_abc');
    useInlineEditStore
      .getState()
      .fail('rate_limit', 'Too many requests, try again later.');
    const s = useInlineEditStore.getState();
    expect(s.status).toBe('error');
    expect(s.error).toEqual({
      kind: 'rate_limit',
      message: 'Too many requests, try again later.',
    });
  });

  it('accept() calls pushUndoStop + executeEdits and clears state', () => {
    useInlineEditStore.getState().open(SAMPLE_SELECTION);
    useInlineEditStore.getState().beginStream('msg_abc');
    useInlineEditStore.getState().sealProposal('const x: number = 1;');

    // Mock the live editor on the controller
    // store. We track the call order so we
    // can assert the undo-stop bracket
    // (pushUndoStop → executeEdits →
    // pushUndoStop) is preserved.
    const calls: string[] = [];
    const mockEditor = {
      pushUndoStop: () => {
        calls.push('pushUndoStop');
      },
      executeEdits: (
        _source: string,
        _edits: Array<{ range: unknown; text: string }>,
      ) => {
        calls.push('executeEdits');
        return null;
      },
    };
    useEditorControllerStore.setState({ editor: mockEditor });

    useInlineEditStore.getState().accept();

    // The bracket: a leading pushUndoStop,
    // then the edit, then a trailing
    // pushUndoStop. This is the Phase 8
    // improvement over 5b-5: a single
    // Cmd+Z cleanly undoes the AI change.
    expect(calls).toEqual([
      'pushUndoStop',
      'executeEdits',
      'pushUndoStop',
    ]);

    // State is cleared (selection, status,
    // proposal all reset).
    const s = useInlineEditStore.getState();
    expect(s.selection).toBeNull();
    expect(s.status).toBe('idle');
    expect(s.proposal).toBeNull();
    expect(s.streamingMessageId).toBeNull();
  });

  it('reject() clears state but does NOT call executeEdits', () => {
    useInlineEditStore.getState().open(SAMPLE_SELECTION);
    useInlineEditStore.getState().beginStream('msg_abc');
    useInlineEditStore.getState().sealProposal('const x: number = 1;');

    let executeEditsCalled = false;
    const mockEditor = {
      pushUndoStop: () => undefined,
      executeEdits: () => {
        executeEditsCalled = true;
        return null;
      },
    };
    useEditorControllerStore.setState({ editor: mockEditor });

    useInlineEditStore.getState().reject();

    expect(executeEditsCalled).toBe(false);
    const s = useInlineEditStore.getState();
    expect(s.selection).toBeNull();
    expect(s.status).toBe('idle');
    expect(s.proposal).toBeNull();
  });

  it('close() is an alias for reject() (no executeEdits)', () => {
    useInlineEditStore.getState().open(SAMPLE_SELECTION);
    useInlineEditStore.getState().beginStream('msg_abc');
    useInlineEditStore.getState().sealProposal('const x: number = 1;');

    let executeEditsCalled = false;
    const mockEditor = {
      pushUndoStop: () => undefined,
      executeEdits: () => {
        executeEditsCalled = true;
        return null;
      },
    };
    useEditorControllerStore.setState({ editor: mockEditor });

    useInlineEditStore.getState().close();

    expect(executeEditsCalled).toBe(false);
    const s = useInlineEditStore.getState();
    expect(s.selection).toBeNull();
    expect(s.status).toBe('idle');
    expect(s.proposal).toBeNull();
  });

  // --- Phase 8.1 — streaming preview text accumulation --------------

  it('starts with empty streamingContent', () => {
    const s = useInlineEditStore.getState();
    expect(s.streamingContent).toBe('');
  });

  it('open() resets streamingContent to ""', () => {
    useInlineEditStore.setState({ streamingContent: 'leftover' });
    useInlineEditStore.getState().open(SAMPLE_SELECTION);
    expect(useInlineEditStore.getState().streamingContent).toBe('');
  });

  it('beginStream() resets streamingContent to ""', () => {
    useInlineEditStore.setState({ streamingContent: 'leftover' });
    useInlineEditStore.getState().beginStream('msg_abc');
    const s = useInlineEditStore.getState();
    expect(s.streamingContent).toBe('');
    expect(s.status).toBe('streaming');
  });

  it('appendStreaming() appends a single chunk', () => {
    useInlineEditStore.getState().beginStream('msg_abc');
    useInlineEditStore.getState().appendStreaming('Hello, ');
    useInlineEditStore.getState().appendStreaming('world!');
    expect(useInlineEditStore.getState().streamingContent).toBe(
      'Hello, world!',
    );
  });

  it('appendStreaming() is a no-op on an empty delta', () => {
    useInlineEditStore.getState().beginStream('msg_abc');
    useInlineEditStore.getState().appendStreaming('foo');
    useInlineEditStore.getState().appendStreaming('');
    expect(useInlineEditStore.getState().streamingContent).toBe('foo');
  });

  it('appendStreaming() caps at STREAMING_PREVIEW_MAX_CHARS (newest wins)', () => {
    useInlineEditStore.getState().beginStream('msg_abc');
    // Build a string that's larger than the cap, in one shot.
    const huge = 'x'.repeat(STREAMING_PREVIEW_MAX_CHARS * 2);
    useInlineEditStore.getState().appendStreaming(huge);
    const s = useInlineEditStore.getState();
    // Newest-wins: the cap is the length of the
    // tail, not the leading bytes.
    expect(s.streamingContent.length).toBe(STREAMING_PREVIEW_MAX_CHARS);
    // All 'x' (the leading bytes were dropped, the
    // tail is 'x' repeated up to the cap).
    expect(s.streamingContent).toBe('x'.repeat(STREAMING_PREVIEW_MAX_CHARS));
  });

  it('setStreamingContent() replaces the whole value (snapshot path)', () => {
    useInlineEditStore.getState().beginStream('msg_abc');
    useInlineEditStore.getState().setStreamingContent('partial');
    expect(useInlineEditStore.getState().streamingContent).toBe('partial');
    useInlineEditStore.getState().setStreamingContent('rewound');
    expect(useInlineEditStore.getState().streamingContent).toBe('rewound');
  });

  it('setStreamingContent() caps at STREAMING_PREVIEW_MAX_CHARS', () => {
    useInlineEditStore.getState().beginStream('msg_abc');
    const huge = 'y'.repeat(STREAMING_PREVIEW_MAX_CHARS * 2);
    useInlineEditStore.getState().setStreamingContent(huge);
    expect(useInlineEditStore.getState().streamingContent.length).toBe(
      STREAMING_PREVIEW_MAX_CHARS,
    );
  });

  it('accept() / reject() / close() / resetToIdle() all clear streamingContent', () => {
    // accept — needs a mock editor (applyProposalToEditor
    // bails on null) AND an open selection
    // (`accept` bails when selection is null).
    // We don't care about the editor call here;
    // we only care that the store fields are
    // cleared on success.
    useEditorControllerStore.setState({
      editor: {
        pushUndoStop: () => undefined,
        executeEdits: () => null,
      },
    });
    useInlineEditStore.getState().open(SAMPLE_SELECTION);
    useInlineEditStore.getState().beginStream('msg_abc');
    useInlineEditStore.getState().appendStreaming('partial text');
    useInlineEditStore.getState().sealProposal('final');
    useInlineEditStore.getState().accept();
    expect(useInlineEditStore.getState().streamingContent).toBe('');

    // reject
    useInlineEditStore.getState().open(SAMPLE_SELECTION);
    useInlineEditStore.getState().beginStream('msg_def');
    useInlineEditStore.getState().appendStreaming('partial text');
    useInlineEditStore.getState().reject();
    expect(useInlineEditStore.getState().streamingContent).toBe('');

    // close
    useInlineEditStore.getState().open(SAMPLE_SELECTION);
    useInlineEditStore.getState().beginStream('msg_ghi');
    useInlineEditStore.getState().appendStreaming('partial text');
    useInlineEditStore.getState().close();
    expect(useInlineEditStore.getState().streamingContent).toBe('');

    // resetToIdle (from 'error' state)
    useInlineEditStore.getState().open(SAMPLE_SELECTION);
    useInlineEditStore.getState().beginStream('msg_jkl');
    useInlineEditStore.getState().appendStreaming('partial text');
    useInlineEditStore.getState().fail('rate_limit', 'slow down');
    useInlineEditStore.getState().resetToIdle();
    expect(useInlineEditStore.getState().streamingContent).toBe('');
  });
});
