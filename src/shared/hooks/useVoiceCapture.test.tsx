/**
 * useVoiceCapture tests (M2a).
 *
 * The hook is the bridge between the store and the
 * browser's audio APIs. The store itself is tested
 * in `voiceStore.test.ts`; the button's visual
 * mapping is tested in `VoiceButton.test.tsx`. This
 * file is the contract test for the audio plumbing:
 *
 *   - `start()` calls `getUserMedia` and transitions
 *     the store to `recording`.
 *   - `stop()` flips the store to `transcribing` and
 *     then to `idle` with a populated `transcript`.
 *   - Permission denied (rejected promise with
 *     `NotAllowedError`) surfaces a friendly message
 *     in `lastError` and flips the store to `error`.
 *   - The hook cleans up the MediaStream tracks on
 *     teardown so the OS mic LED goes off.
 *
 * We render the hook in a tiny React harness
 * (`createRoot` + `act` from `react-dom/test-utils`)
 * and stub the audio globals on `globalThis` so the
 * production code sees a working
 * `navigator.mediaDevices` and `MediaRecorder`.
 */

import { useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import { useVoiceStore } from '@/shared/state/voiceStore';
import { useVoiceCapture } from './useVoiceCapture';

// --- stubs for the audio APIs -------------------------------------------

interface MockTrack {
  stop: () => void;
  kind: string;
}

class MockMediaStream {
  tracks: MockTrack[];
  constructor() {
    this.tracks = [{ stop: vi.fn(), kind: 'audio' }];
  }
  getTracks(): MockTrack[] {
    return this.tracks;
  }
  getAudioTracks(): MockTrack[] {
    return this.tracks;
  }
}

class MockMediaRecorder {
  state: 'inactive' | 'recording' | 'stopped' = 'inactive';
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  static isTypeSupported(_mime: string): boolean {
    return true;
  }
  // The real MediaRecorder constructor accepts
  // (stream, options). The hook only passes the
  // stream, so we accept just the stream here.
  constructor(public stream: MockMediaStream) {}
  start(): void {
    this.state = 'recording';
  }
  stop(): void {
    this.state = 'inactive';
    if (this.ondataavailable) {
      this.ondataavailable({ data: new Blob(['audio-bytes'], { type: 'audio/webm' }) });
    }
    if (this.onstop) {
      this.onstop();
    }
  }
}

interface StubbedAudio {
  getUserMedia: ReturnType<typeof vi.fn>;
  /** Returns the number of times the mocked
   *  track's `stop` has been called. We expose
   *  this as a function (not a number) because
   *  the stub is created before any test code
   *  runs, and tests need to read the count
   *  after the fact. */
  getTrackStopCount: () => number;
}

function installAudioStub(opts: {
  getUserMediaImpl?: () => Promise<MockMediaStream>;
} = {}): StubbedAudio {
  const stream = new MockMediaStream();
  const getUserMedia = vi.fn(
    opts.getUserMediaImpl ??
      (() => Promise.resolve(stream)),
  );
  // Mutate the existing navigator object so
  // subsequent reads in the hook see the stub.
  const nav = (globalThis as unknown as { navigator: Record<string, unknown> }).navigator;
  nav.mediaDevices = { getUserMedia };
  const win = (globalThis as unknown as { window: Record<string, unknown> }).window;
  win.MediaRecorder = MockMediaRecorder;
  return {
    getUserMedia,
    getTrackStopCount: () => {
      let count = 0;
      for (const t of stream.tracks) {
        const fn = t.stop as unknown as { mock?: { calls: unknown[] } };
        if (fn.mock) count += fn.mock.calls.length;
      }
      return count;
    },
  };
}

/**
 * Tear down the audio API. Used to test the "no
 * mediaDevices support" path.
 */
function uninstallAudioStub(): void {
  const nav = (globalThis as unknown as { navigator: Record<string, unknown> }).navigator;
  delete nav.mediaDevices;
  const win = (globalThis as unknown as { window: Record<string, unknown> }).window;
  delete win.MediaRecorder;
}

// --- harness --------------------------------------------------------------

interface HarnessHandle {
  start: () => Promise<void>;
  stop: () => Promise<void>;
}

function mountHook(opts: { provider?: 'stub' | 'wispr' | 'ondevice' } = {}): {
  handle: HarnessHandle;
  cleanup: () => void;
} {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  let handle: HarnessHandle | null = null;

  function Harness(): null {
    const cap = useVoiceCapture({ provider: opts.provider });
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

// --- tests ----------------------------------------------------------------

describe('useVoiceCapture', () => {
  beforeEach(() => {
    useVoiceStore.getState().reset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    // Reinstall the audio stub for the next
    // test. uninstallAudioStub() removes the
    // stubs; tests that want them back need
    // installAudioStub() to be called.
    // (Each test that uses the audio APIs
    // calls installAudioStub() at the top.)
  });

  it('start() calls getUserMedia and transitions to recording', async () => {
    const stub = installAudioStub();
    const { handle, cleanup } = mountHook();
    try {
      await act(async () => {
        await handle.start();
      });
      const s = useVoiceStore.getState();
      expect(s.status).toBe('recording');
      expect(stub.getUserMedia).toHaveBeenCalledOnce();
      expect(s.durationMs).toBeGreaterThanOrEqual(0);
    } finally {
      cleanup();
    }
  });

  it('stop() flips to transcribing and then to idle with a stub transcript', async () => {
    const stub = installAudioStub();
    const { handle, cleanup } = mountHook();
    try {
      await act(async () => {
        await handle.start();
      });
      await act(async () => {
        await handle.stop();
      });
      // Advance the stub STT delay (200ms) so
      // the promise in the hook resolves.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(250);
      });
      const s = useVoiceStore.getState();
      expect(s.status).toBe('idle');
      expect(s.transcript).toMatch(/voice transcript \(/);
      // The mic track was stopped during the
      // onstop callback.
      expect(stub.getTrackStopCount()).toBeGreaterThanOrEqual(1);
    } finally {
      cleanup();
    }
  });

  it('permission denied (NotAllowedError) surfaces a friendly error', async () => {
    installAudioStub({
      getUserMediaImpl: () => {
        const e = new Error('Permission denied');
        e.name = 'NotAllowedError';
        return Promise.reject(e);
      },
    });
    const { handle, cleanup } = mountHook();
    try {
      await act(async () => {
        await handle.start();
      });
      const s = useVoiceStore.getState();
      expect(s.status).toBe('error');
      expect(s.lastError).toMatch(/blocked/i);
      expect(s.durationMs).toBe(0);
    } finally {
      cleanup();
    }
  });

  it('NotFoundError surfaces a "no microphone was found" error', async () => {
    installAudioStub({
      getUserMediaImpl: () => {
        const e = new Error('No mic');
        e.name = 'NotFoundError';
        return Promise.reject(e);
      },
    });
    const { handle, cleanup } = mountHook();
    try {
      await act(async () => {
        await handle.start();
      });
      const s = useVoiceStore.getState();
      expect(s.status).toBe('error');
      expect(s.lastError).toMatch(/no microphone/i);
    } finally {
      cleanup();
    }
  });

  it('NotReadableError surfaces a "microphone is busy" error', async () => {
    installAudioStub({
      getUserMediaImpl: () => {
        const e = new Error('busy');
        e.name = 'NotReadableError';
        return Promise.reject(e);
      },
    });
    const { handle, cleanup } = mountHook();
    try {
      await act(async () => {
        await handle.start();
      });
      const s = useVoiceStore.getState();
      expect(s.status).toBe('error');
      expect(s.lastError).toMatch(/busy/i);
    } finally {
      cleanup();
    }
  });

  it('start() while already recording is a no-op (idempotent)', async () => {
    const stub = installAudioStub();
    const { handle, cleanup } = mountHook();
    try {
      await act(async () => {
        await handle.start();
      });
      await act(async () => {
        await handle.start();
      });
      expect(stub.getUserMedia).toHaveBeenCalledOnce();
    } finally {
      cleanup();
    }
  });

  it('cleanup on unmount stops the mic tracks', async () => {
    const stub = installAudioStub();
    const { handle, cleanup } = mountHook();
    await act(async () => {
      await handle.start();
    });
    cleanup();
    expect(stub.getTrackStopCount()).toBeGreaterThanOrEqual(1);
  });

  it('start() with no mediaDevices support surfaces a clear error', async () => {
    uninstallAudioStub();
    const { handle, cleanup } = mountHook();
    try {
      await act(async () => {
        await handle.start();
      });
      const s = useVoiceStore.getState();
      expect(s.status).toBe('error');
      expect(s.lastError).toMatch(/not available/i);
    } finally {
      cleanup();
    }
  });
});
