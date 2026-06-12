/**
 * useVoiceCapture wispr-path tests (M2b).
 *
 * The M2a tests cover the stub provider (`MediaRecorder`
 * + placeholder transcript). This file covers the
 * Wispr path (`AudioContext` + `ScriptProcessorNode` →
 * 16kHz mono Int16 → WebSocket → final text).
 *
 * We mock the @/ipc and @/voice/wisprClient modules
 * via vi.mock at the top of the file, then mutate the
 * implementations per-test with mockReturnValue /
 * mockImplementation. This is the standard vitest
 * pattern for module-level mocks.
 */
import { useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { describe, expect, it, vi, beforeEach, afterEach, type Mock } from 'vitest';

// Module-level mocks. These get hoisted by vitest.
// The `vi.hoisted` factory runs before any imports,
// and the returned `mocks` object is shared between
// the mock factories and the per-test code.
const mocks = vi.hoisted(() => ({
  secretsGetApiKey: vi.fn(),
  transcribeViaWispr: vi.fn(),
}));

vi.mock('@/ipc', () => ({
  secretsGetApiKey: mocks.secretsGetApiKey,
}));

// The hook imports `transcribeViaWispr` from
// `@/voice` (a barrel re-export). Mocking the
// inner `@/voice/wisprClient` doesn't intercept
// the re-export cleanly in vitest — mock the
// barrel so the hook sees our function.
vi.mock('@/voice', async () => {
  const actual = await vi.importActual<typeof import('@/voice')>('@/voice');
  return {
    ...actual,
    transcribeViaWispr: mocks.transcribeViaWispr,
  };
});

import { useVoiceStore } from '@/shared/state/voiceStore';
import { useVoiceCapture } from './useVoiceCapture';

// --- audio-API stubs (M2b path) ----------------------------------------

let scriptProcessorCallback:
  | ((event: { inputBuffer: { getChannelData: (n: number) => Float32Array } }) => void)
  | null = null;

class MockMediaStreamAudioSourceNode {
  connect = vi.fn();
  disconnect = vi.fn();
}

class MockScriptProcessorNode {
  onaudioprocess: ((e: { inputBuffer: { getChannelData: (n: number) => Float32Array } }) => void) | null = null;
  connect = vi.fn();
  disconnect = vi.fn();
  constructor() {
    scriptProcessorCallback = (e) => {
      if (this.onaudioprocess) this.onaudioprocess(e);
    };
  }
}

class MockAudioContext {
  state: 'running' | 'closed' = 'running';
  createMediaStreamSource(): MockMediaStreamAudioSourceNode {
    return new MockMediaStreamAudioSourceNode();
  }
  createScriptProcessor(): MockScriptProcessorNode {
    return new MockScriptProcessorNode();
  }
  destination: Record<string, never> = {};
  close = vi.fn(async () => {
    this.state = 'closed';
  });
}

function installAudioStubs(opts: {
  getUserMediaImpl?: () => Promise<MediaStream>;
} = {}): {
  fireAudioChunk: (samples: number) => void;
  audioTrack: { stop: ReturnType<typeof vi.fn>; getSettings: () => MediaTrackSettings };
  getUserMedia: ReturnType<typeof vi.fn>;
  getTrackStopCount: () => number;
} {
  scriptProcessorCallback = null;
  const audioTrack: { stop: ReturnType<typeof vi.fn>; getSettings: () => MediaTrackSettings } = {
    stop: vi.fn(),
    getSettings: () => ({ sampleRate: 16_000, channelCount: 1 } as MediaTrackSettings),
  };
  const stream = {
    getTracks: () => [audioTrack],
    getAudioTracks: () => [audioTrack],
  } as unknown as MediaStream;
  const getUserMedia = vi.fn(opts.getUserMediaImpl ?? (() => Promise.resolve(stream)));

  const nav = (globalThis as unknown as { navigator: Record<string, unknown> }).navigator;
  nav.mediaDevices = { getUserMedia };
  const win = (globalThis as unknown as { window: Record<string, unknown> }).window;
  win.AudioContext = MockAudioContext as unknown as typeof AudioContext;
  // The hook's stub path also feature-detects
  // MediaRecorder; we don't want it to interfere.
  win.MediaRecorder = class {} as unknown as typeof MediaRecorder;

  return {
    fireAudioChunk: (samples: number) => {
      if (!scriptProcessorCallback) {
        throw new Error('audio context was never constructed');
      }
      const data = new Float32Array(samples);
      for (let i = 0; i < samples; i++) data[i] = 0.1;
      scriptProcessorCallback({
        inputBuffer: { getChannelData: () => data },
      });
    },
    audioTrack,
    getUserMedia,
    getTrackStopCount: () => {
      return (audioTrack.stop as unknown as { mock: { calls: unknown[] } }).mock.calls.length;
    },
  };
}

function uninstallAudioStubs(): void {
  const nav = (globalThis as unknown as { navigator: Record<string, unknown> }).navigator;
  delete nav.mediaDevices;
  const win = (globalThis as unknown as { window: Record<string, unknown> }).window;
  delete win.AudioContext;
  delete win.MediaRecorder;
}

interface HarnessHandle {
  start: () => Promise<void>;
  stop: () => Promise<void>;
}

function mountHook(provider: 'wispr' | 'stub' | 'ondevice'): {
  handle: HarnessHandle;
  cleanup: () => void;
} {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  let handle: HarnessHandle | null = null;

  function Harness(): null {
    const cap = useVoiceCapture({ provider });
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

// --- Tests ----------------------------------------------------------------

describe('useVoiceCapture (wispr path)', () => {
  beforeEach(() => {
    useVoiceStore.getState().reset();
    mocks.secretsGetApiKey.mockReset();
    mocks.transcribeViaWispr.mockReset();
  });
  afterEach(() => {
    uninstallAudioStubs();
  });

  it('surfaces a no-key error when the keychain has no Wispr key', async () => {
    (mocks.secretsGetApiKey as Mock).mockResolvedValue(null);
    const stub = installAudioStubs();
    const { handle, cleanup } = mountHook('wispr');
    try {
      await act(async () => {
        await handle.start();
      });
      const s = useVoiceStore.getState();
      expect(s.status).toBe('error');
      expect(s.lastError).toMatch(/No Wispr API key/i);
      // The mic should NOT have been opened (the
      // key check happens first, deliberately,
      // to avoid a permission prompt the user
      // then has to dismiss).
      expect(stub.getUserMedia).not.toHaveBeenCalled();
    } finally {
      cleanup();
    }
  });

  it('opens the mic, starts the duration timer, and reaches recording state', async () => {
    (mocks.secretsGetApiKey as Mock).mockResolvedValue('wispr-test-key');
    // The Wispr client promise should never
    // resolve (the test ends before we call
    // stop()); that's fine — the hook is in
    // 'recording' and stays there.
    (mocks.transcribeViaWispr as Mock).mockImplementation(
      () => new Promise<string>(() => { /* never resolves */ }),
    );
    const stub = installAudioStubs();
    const { handle, cleanup } = mountHook('wispr');
    try {
      await act(async () => {
        await handle.start();
      });
      const s = useVoiceStore.getState();
      expect(s.status).toBe('recording');
      expect(stub.getUserMedia).toHaveBeenCalledOnce();
    } finally {
      cleanup();
    }
  });

  it('resolves to the transcript when the Wispr client returns text', async () => {
    (mocks.secretsGetApiKey as Mock).mockResolvedValue('wispr-test-key');
    // Defer the mock resolution so the test drives
    // the order: start -> fire audio -> stop ->
    // promise resolves with the transcript. The
    // real Wispr client behaves the same way: it
    // resolves when the server sends `final: true`
    // after the client commits.
    let resolveStt!: (value: string) => void;
    (mocks.transcribeViaWispr as Mock).mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          resolveStt = resolve;
        }),
    );
    const stub = installAudioStubs();
    const { handle, cleanup } = mountHook('wispr');
    try {
      await act(async () => {
        await handle.start();
      });
      // Fire enough audio samples to produce at
      // least one PCM chunk (800 samples per
      // chunk).
      await act(async () => {
        stub.fireAudioChunk(800);
      });
      // Stop — the iterator ends, the WS
      // promise resolves.
      await act(async () => {
        await handle.stop();
      });
      // Now resolve the mock transcription. This
      // mirrors the server's `final: true` reply
      // that arrives after the commit.
      await act(async () => {
        resolveStt('def my_function');
      });
      // Drain microtasks so the .then handler
      // runs.
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });
      const s = useVoiceStore.getState();
      expect(s.transcript).toBe('def my_function');
      expect(s.status).toBe('idle');
    } finally {
      cleanup();
    }
  });

  it('releases the audio track on unmount', async () => {
    (mocks.secretsGetApiKey as Mock).mockResolvedValue('wispr-test-key');
    (mocks.transcribeViaWispr as Mock).mockImplementation(
      () => new Promise<string>(() => { /* never resolves */ }),
    );
    const stub = installAudioStubs();
    const { handle, cleanup } = mountHook('wispr');
    await act(async () => {
      await handle.start();
    });
    cleanup();
    expect(stub.getTrackStopCount()).toBeGreaterThanOrEqual(1);
  });
});
