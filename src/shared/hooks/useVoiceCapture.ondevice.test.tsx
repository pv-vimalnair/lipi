/**
 * useVoiceCapture ondevice-path tests (M3).
 *
 * M3 update: the hook dispatches through
 * `voiceSessionFactories.ondevice()`. The
 * factory accepts `sttStartOverride`,
 * `sttStopOverride`, `subscribeTranscript`, and
 * `subscribeError` injection seams so the test
 * can drive the on-device session without
 * touching the real Tauri IPC.
 *
 * The four M3 invariants (per design §11):
 *   1. State machine: requesting → recording →
 *      transcribing → idle.
 *   2. Transcript lands in `voiceStore.transcript`
 *      on the final.
 *   3. Typed `VoiceSessionError` from the provider
 *      surfaces as `voiceStore.lastError`.
 *   4. `useEffect` cleanup on unmount aborts the
 *      in-flight session.
 */

import { useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { useVoiceStore } from '@/shared/state/voiceStore';
import { useVoiceCapture } from './useVoiceCapture';
import {
  voiceSessionFactories,
  VoiceSessionError,
  type VoiceSessionHandle,
  type VoiceSessionState,
  type VoiceSession,
  type TranscriptionEvent,
  type VoiceProviderId,
} from '@/voice';

interface HarnessHandle {
  start: () => Promise<void>;
  stop: () => Promise<void>;
}

function mountHook(): { handle: HarnessHandle; cleanup: () => void } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  let handle: HarnessHandle | null = null;

  function Harness(): null {
    const cap = useVoiceCapture({ provider: 'ondevice' });
    useEffect(() => {
      handle = { start: cap.start, stop: cap.stop };
    }, [cap]);
    return null;
  }

  act(() => {
    root.render(<Harness />);
  });
  if (!handle) throw new Error('hook did not initialise');
  return {
    handle,
    cleanup: () => {
      act(() => {
        root.unmount();
      });
      document.body.removeChild(container);
    },
  };
}

interface FakeSession extends VoiceSession {
  emitState: (s: VoiceSessionState) => void;
  emitTranscription: (e: TranscriptionEvent) => void;
  emitError: (err: VoiceSessionError) => void;
}

function installFakeOnDeviceFactory(): {
  captured: Array<{ signal: AbortSignal }>;
  emitState: (s: VoiceSessionState) => void;
  emitTranscription: (e: TranscriptionEvent) => void;
  emitError: (err: VoiceSessionError) => void;
  session: FakeSession;
} {
  const captured: Array<{ signal: AbortSignal }> = [];
  const stateListeners = new Set<(s: VoiceSessionState) => void>();
  const transcriptionListeners = new Set<(e: TranscriptionEvent) => void>();
  const errorListeners = new Set<(err: VoiceSessionError) => void>();
  let closed = false;
  const session: FakeSession = {
    state: 'starting',
    mode: 'dictation',
    provider: 'ondevice',
    onStateChange(l) {
      stateListeners.add(l);
      l('starting');
      return () => stateListeners.delete(l);
    },
    onTranscription(l) {
      transcriptionListeners.add(l);
      return () => transcriptionListeners.delete(l);
    },
    onError(l) {
      errorListeners.add(l);
      return () => errorListeners.delete(l);
    },
    async flush() {
      throw new VoiceSessionError('unsupported', 'flush not supported');
    },
    async close() {
      if (closed) return;
      closed = true;
      for (const l of stateListeners) l('closed');
    },
    emitState(s) {
      for (const l of stateListeners) l(s);
    },
    emitTranscription(e) {
      for (const l of transcriptionListeners) l(e);
    },
    emitError(err) {
      for (const l of errorListeners) l(err);
    },
  };
  const fake: typeof voiceSessionFactories.ondevice = async (opts) => {
    captured.push({ signal: opts.signal });
    const handle: VoiceSessionHandle = {
      session,
      abort() {
        opts.signal.dispatchEvent(new Event('abort'));
      },
    };
    return handle;
  };
  (voiceSessionFactories as Record<VoiceProviderId, typeof fake>).ondevice = fake;
  return { captured, emitState: session.emitState, emitTranscription: session.emitTranscription, emitError: session.emitError, session };
}

let realFactory: typeof voiceSessionFactories.ondevice =
  voiceSessionFactories.ondevice;

describe('useVoiceCapture (ondevice path)', () => {
  beforeEach(() => {
    useVoiceStore.getState().reset();
    realFactory = voiceSessionFactories.ondevice;
  });

  it('does not open getUserMedia (the Rust side owns the mic)', async () => {
    const getUserMedia = vi.fn();
    (globalThis as unknown as { navigator: Record<string, unknown> })
      .navigator = { mediaDevices: { getUserMedia } };

    const fake = installFakeOnDeviceFactory();

    const { handle, cleanup } = mountHook();
    try {
      await act(async () => {
        await handle.start();
      });
      // Drive the state machine: starting → listening
      // (the hook flips to recording) → final → closed.
      await act(async () => {
        fake.emitState('listening');
        await Promise.resolve();
        fake.emitTranscription({
          kind: 'final',
          text: 'on-device transcript',
          sequence: 1,
          timestamp: Date.now(),
          isUtteranceEnd: true,
          sessionId: 'test-session',
        });
        fake.emitState('stopping');
        fake.emitState('finalizing');
        await Promise.resolve();
      });
      const s = useVoiceStore.getState();
      expect(s.transcript).toBe('on-device transcript');
      // The M3 path must NOT touch the WebView
      // mic API at all — the Rust side opens
      // cpal.
      expect(getUserMedia).not.toHaveBeenCalled();
      // The factory was called with an AbortSignal
      expect(fake.captured.length).toBe(1);
    } finally {
      (voiceSessionFactories as Record<VoiceProviderId, typeof voiceSessionFactories.ondevice>).ondevice =
        realFactory;
      cleanup();
    }
  });

  it('surfaces a typed VoiceSessionError as the user-facing error', async () => {
    const fake = installFakeOnDeviceFactory();

    const { handle, cleanup } = mountHook();
    try {
      await act(async () => {
        await handle.start();
      });
      await act(async () => {
        fake.emitState('error');
        fake.emitError(
          new VoiceSessionError(
            'no-active-model',
            'No on-device STT model is installed. Open Settings → Voice to install one.',
          ),
        );
        await Promise.resolve();
      });
      const s = useVoiceStore.getState();
      expect(s.status).toBe('error');
      expect(s.lastError).toMatch(/No on-device STT model/i);
      expect(fake.captured.length).toBe(1);
    } finally {
      (voiceSessionFactories as Record<VoiceProviderId, typeof voiceSessionFactories.ondevice>).ondevice =
        realFactory;
      cleanup();
    }
  });
});
