/**
 * capabilities tests (M2c mobile — Decision #46).
 *
 * The capabilities wrapper is a one-shot cache: the
 * first call invokes the `voice_platform_get_capabilities`
 * IPC, every subsequent call returns the same cached
 * promise. The cache survives a rejection (a future
 * session can only "fix" the rejection by restarting
 * the process — the IPC is a compile-time decision
 * on the Rust side; the user can't make it succeed
 * by retrying at runtime).
 *
 * The test uses the test-only reset escape hatch
 * (`__resetVoicePlatformCapabilitiesCacheForTests`)
 * to drive the "first call / second call" assertions
 * from a clean cache per test.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  voicePlatformGetCapabilities: vi.fn(),
}));

vi.mock('@/ipc/voicePlatform', () => ({
  voicePlatformGetCapabilities: mocks.voicePlatformGetCapabilities,
}));

import {
  __resetVoicePlatformCapabilitiesCacheForTests,
  getVoicePlatformCapabilities,
} from './capabilities';
import type { VoicePlatformCapabilities } from '@/ipc/voicePlatform';

function makeCaps(overrides: Partial<VoicePlatformCapabilities> = {}): VoicePlatformCapabilities {
  return {
    ondevice: true,
    webSpeech: true,
    nativeDictation: false,
    osFamily: 'windows',
    ...overrides,
  };
}

describe('voice platform capabilities cache', () => {
  beforeEach(() => {
    mocks.voicePlatformGetCapabilities.mockReset();
    __resetVoicePlatformCapabilitiesCacheForTests();
  });

  afterEach(() => {
    __resetVoicePlatformCapabilitiesCacheForTests();
  });

  it('invokes the IPC exactly once on the first call', async () => {
    mocks.voicePlatformGetCapabilities.mockResolvedValue(
      makeCaps({ osFamily: 'windows' }),
    );
    const result = await getVoicePlatformCapabilities();
    expect(result.osFamily).toBe('windows');
    expect(mocks.voicePlatformGetCapabilities).toHaveBeenCalledTimes(1);
  });

  it('returns the cached promise on subsequent calls without re-invoking the IPC', async () => {
    mocks.voicePlatformGetCapabilities.mockResolvedValue(
      makeCaps({ osFamily: 'macos' }),
    );
    const first = await getVoicePlatformCapabilities();
    const second = await getVoicePlatformCapabilities();
    const third = await getVoicePlatformCapabilities();
    expect(first).toBe(second);
    expect(second).toBe(third);
    expect(mocks.voicePlatformGetCapabilities).toHaveBeenCalledTimes(1);
  });

  it('deduplicates concurrent callers onto the same in-flight promise', async () => {
    // The cache promise is the SAME instance for
    // every caller until the underlying IPC
    // resolves. Two parallel `await` calls share
    // one IPC round-trip.
    let resolveIpc!: (caps: VoicePlatformCapabilities) => void;
    mocks.voicePlatformGetCapabilities.mockImplementation(
      () => new Promise<VoicePlatformCapabilities>((resolve) => {
        resolveIpc = resolve;
      }),
    );
    const p1 = getVoicePlatformCapabilities();
    const p2 = getVoicePlatformCapabilities();
    expect(mocks.voicePlatformGetCapabilities).toHaveBeenCalledTimes(1);
    resolveIpc(makeCaps({ osFamily: 'ios' }));
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1.osFamily).toBe('ios');
    expect(r2.osFamily).toBe('ios');
  });

  it('caches a rejection and does not retry on subsequent calls', async () => {
    mocks.voicePlatformGetCapabilities.mockRejectedValue(
      new Error('IPC channel closed'),
    );
    await expect(getVoicePlatformCapabilities()).rejects.toThrow(/IPC channel closed/);
    // The cache holds a rejected promise; the
    // second call returns the SAME rejected
    // promise (the underlying IPC is not retried).
    // We assert by checking that a second await
    // also rejects — but the IPC mock was still
    // only called once.
    await expect(getVoicePlatformCapabilities()).rejects.toThrow(/IPC channel closed/);
    expect(mocks.voicePlatformGetCapabilities).toHaveBeenCalledTimes(1);
  });

  it('forwards the IPC result to all callers (no mutation between calls)', async () => {
    mocks.voicePlatformGetCapabilities.mockResolvedValue(
      makeCaps({ ondevice: true, webSpeech: false, osFamily: 'linux-gtk' }),
    );
    const a = await getVoicePlatformCapabilities();
    const b = await getVoicePlatformCapabilities();
    expect(a.ondevice).toBe(true);
    expect(a.webSpeech).toBe(false);
    expect(a.osFamily).toBe('linux-gtk');
    expect(b.ondevice).toBe(true);
    expect(b.webSpeech).toBe(false);
    expect(b.osFamily).toBe('linux-gtk');
  });

  it('re-invokes the IPC after the test-only reset escape hatch is called', async () => {
    mocks.voicePlatformGetCapabilities.mockResolvedValueOnce(
      makeCaps({ osFamily: 'windows' }),
    );
    const first = await getVoicePlatformCapabilities();
    expect(first.osFamily).toBe('windows');
    __resetVoicePlatformCapabilitiesCacheForTests();
    mocks.voicePlatformGetCapabilities.mockResolvedValueOnce(
      makeCaps({ osFamily: 'macos' }),
    );
    const second = await getVoicePlatformCapabilities();
    expect(second.osFamily).toBe('macos');
    expect(mocks.voicePlatformGetCapabilities).toHaveBeenCalledTimes(2);
  });
});
