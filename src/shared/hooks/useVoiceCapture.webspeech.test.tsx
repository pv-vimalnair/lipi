/**
 * useVoiceCapture webspeech-path tests (M3).
 *
 * M3 update: the hook dispatches through
 * `voiceSessionFactories.webSpeech()`. The factory
 * accepts a `webSpeechCtor` injection seam so the
 * test can drive the Web Speech API through a
 * fake constructor (parallels the M2a
 * `WebSpeechSttError` test, but at the
 * `VoiceSession` listener layer).
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
import { useVoicePreferencesStore } from '@/shared/state/voicePreferencesStore';
import { useVoiceCapture } from './useVoiceCapture';
import {
  voiceSessionFactories,
  type VoiceProviderId,
} from '@/voice';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface FakeRecognition {
  onresult: ((e: unknown) => void) | null;
  onerror: ((e: unknown) => void) | null;
  onend: (() => void) | null;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  abort: ReturnType<typeof vi.fn>;
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
}

let recognizer: FakeRecognition | null = null;

function installWebSpeechStub(): new () => FakeRecognition {
  function Ctor(): FakeRecognition {
    const r: FakeRecognition = {
      onresult: null,
      onerror: null,
      onend: null,
      start: vi.fn(),
      stop: vi.fn(),
      abort: vi.fn(),
      lang: '',
      continuous: false,
      interimResults: false,
      maxAlternatives: 0,
    };
    recognizer = r;
    return r;
  }
  return Ctor as unknown as new () => FakeRecognition;
}

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
    const cap = useVoiceCapture({ provider: 'webSpeech' });
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

let realFactory: typeof voiceSessionFactories.webSpeech =
  voiceSessionFactories.webSpeech;

function installFakeWebSpeechFactory(
  ctor: new () => unknown,
): { language: string | undefined } {
  const captured: { language: string | undefined } = {
    language: undefined,
  };
  const fake: typeof voiceSessionFactories.webSpeech = async (opts) => {
    captured.language = opts.language;
    // Build a session that just routes the
    // webSpeechCtor through our fake.
    const factoryOpts = { ...opts, webSpeechCtor: ctor };
    return realFactory(factoryOpts);
  };
  (voiceSessionFactories as Record<VoiceProviderId, typeof fake>).webSpeech = fake;
  return captured;
}

describe('useVoiceCapture (webSpeech path)', () => {
  beforeEach(() => {
    useVoiceStore.getState().reset();
    useVoicePreferencesStore.setState({
      provider: 'webSpeech',
      language: 'en-US',
      hydrated: true,
    });
    realFactory = voiceSessionFactories.webSpeech;
    recognizer = null;
  });

  it('threads the user-preferred language into the factory', async () => {
    useVoicePreferencesStore.getState().setLanguage('fr-FR');
    const stub = installWebSpeechStub();
    const captured = installFakeWebSpeechFactory(stub);
    const { handle, cleanup } = mountHook();
    try {
      await act(async () => {
        await handle.start();
      });
      // Drain the queued events.
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(captured.language).toBe('fr-FR');
    } finally {
      (voiceSessionFactories as Record<VoiceProviderId, typeof voiceSessionFactories.webSpeech>).webSpeech =
        realFactory;
      cleanup();
    }
  });

  it('forwards the transcript to the store when the recognizer fires onend', async () => {
    const stub = installWebSpeechStub();
    installFakeWebSpeechFactory(stub);
    const { handle, cleanup } = mountHook();
    try {
      await act(async () => {
        await handle.start();
      });
      // Simulate the recognizer firing onresult
      // with a final transcript.
      await act(async () => {
        if (recognizer && recognizer.onresult) {
          recognizer.onresult({
            results: [
              {
                isFinal: true,
                length: 1,
                0: { transcript: 'hello webspeech', confidence: 0.99 },
              },
            ],
            resultIndex: 0,
          });
        }
        await Promise.resolve();
      });
      // Simulate the recognizer firing onend.
      await act(async () => {
        if (recognizer && recognizer.onend) {
          recognizer.onend();
        }
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });
      const s = useVoiceStore.getState();
      expect(s.transcript).toBe('hello webspeech');
    } finally {
      (voiceSessionFactories as Record<VoiceProviderId, typeof voiceSessionFactories.webSpeech>).webSpeech =
        realFactory;
      cleanup();
    }
  });

  it('surfaces a typed VoiceSessionError as the user-facing error', async () => {
    const stub = installWebSpeechStub();
    installFakeWebSpeechFactory(stub);
    const { handle, cleanup } = mountHook();
    try {
      await act(async () => {
        await handle.start();
      });
      // Simulate the recognizer firing a
      // `not-allowed` error.
      await act(async () => {
        if (recognizer && recognizer.onerror) {
          recognizer.onerror({ error: 'not-allowed' });
        }
        await Promise.resolve();
      });
      const s = useVoiceStore.getState();
      expect(s.status).toBe('error');
      expect(s.lastError).toMatch(/Microphone access was blocked/i);
    } finally {
      (voiceSessionFactories as Record<VoiceProviderId, typeof voiceSessionFactories.webSpeech>).webSpeech =
        realFactory;
      cleanup();
    }
  });

  it('does not call getUserMedia (the WebView owns the mic)', async () => {
    const getUserMedia = vi.fn();
    (globalThis as unknown as { navigator: Record<string, unknown> })
      .navigator = { mediaDevices: { getUserMedia } };
    const stub = installWebSpeechStub();
    installFakeWebSpeechFactory(stub);
    const { handle, cleanup } = mountHook();
    try {
      await act(async () => {
        await handle.start();
      });
      expect(getUserMedia).not.toHaveBeenCalled();
    } finally {
      (voiceSessionFactories as Record<VoiceProviderId, typeof voiceSessionFactories.webSpeech>).webSpeech =
        realFactory;
      cleanup();
    }
  });
});
