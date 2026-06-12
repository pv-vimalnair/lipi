/**
 * voiceCapabilitiesStore tests (M2c mobile — Decision #46).
 *
 * The store holds the platform's STT capability flags
 * and is hydrated once at app startup. The test
 * exercises the `null → populated` transition and
 * the idempotency of the `hydrate` action.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getVoicePlatformCapabilities: vi.fn(),
}));

vi.mock('@/voice/capabilities', () => ({
  getVoicePlatformCapabilities: mocks.getVoicePlatformCapabilities,
}));

import {
  useVoiceCapabilitiesStore,
} from './voiceCapabilitiesStore';
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

describe('voiceCapabilitiesStore', () => {
  beforeEach(() => {
    mocks.getVoicePlatformCapabilities.mockReset();
    useVoiceCapabilitiesStore.setState({ capabilities: null });
  });

  afterEach(() => {
    useVoiceCapabilitiesStore.setState({ capabilities: null });
  });

  it('starts with capabilities=null', () => {
    expect(useVoiceCapabilitiesStore.getState().capabilities).toBeNull();
  });

  it('transitions capabilities from null to populated on hydrate', async () => {
    mocks.getVoicePlatformCapabilities.mockResolvedValue(
      makeCaps({ osFamily: 'macos' }),
    );
    expect(useVoiceCapabilitiesStore.getState().capabilities).toBeNull();
    await useVoiceCapabilitiesStore.getState().hydrate();
    const caps = useVoiceCapabilitiesStore.getState().capabilities;
    expect(caps).not.toBeNull();
    expect(caps?.osFamily).toBe('macos');
    expect(caps?.ondevice).toBe(true);
  });

  it('hydrate is idempotent — a second call is a no-op', async () => {
    mocks.getVoicePlatformCapabilities.mockResolvedValue(
      makeCaps({ osFamily: 'windows' }),
    );
    await useVoiceCapabilitiesStore.getState().hydrate();
    await useVoiceCapabilitiesStore.getState().hydrate();
    await useVoiceCapabilitiesStore.getState().hydrate();
    // The IPC wrapper is called at most once
    // per hydrate (and the store's idempotency
    // guard short-circuits the second + third
    // call before touching the IPC at all).
    // The exact count depends on whether the
    // underlying capabilities.ts cache layer is
    // active; we assert it is at MOST 1.
    expect(mocks.getVoicePlatformCapabilities).toHaveBeenCalledTimes(1);
  });

  it('keeps capabilities=null when the IPC rejects (defensive swallow)', async () => {
    // The Rust side never errors in practice.
    // When it does, we silently swallow the
    // error so the Command Palette predicates
    // (which read `?.webSpeech` and get
    // `undefined`) stay safe.
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {
      // suppress the warn during this test
    });
    mocks.getVoicePlatformCapabilities.mockRejectedValue(
      new Error('IPC channel closed'),
    );
    await useVoiceCapabilitiesStore.getState().hydrate();
    expect(useVoiceCapabilitiesStore.getState().capabilities).toBeNull();
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it('records the exact capability flags from the IPC result', async () => {
    mocks.getVoicePlatformCapabilities.mockResolvedValue({
      ondevice: false,
      webSpeech: false,
      nativeDictation: true,
      osFamily: 'ios',
    });
    await useVoiceCapabilitiesStore.getState().hydrate();
    const caps = useVoiceCapabilitiesStore.getState().capabilities;
    expect(caps).toEqual({
      ondevice: false,
      webSpeech: false,
      nativeDictation: true,
      osFamily: 'ios',
    });
  });

  it('records the linux-gtk osFamily (no SpeechRecognition on WebKitGTK)', async () => {
    mocks.getVoicePlatformCapabilities.mockResolvedValue(
      makeCaps({ ondevice: true, webSpeech: false, osFamily: 'linux-gtk' }),
    );
    await useVoiceCapabilitiesStore.getState().hydrate();
    const caps = useVoiceCapabilitiesStore.getState().capabilities;
    expect(caps?.osFamily).toBe('linux-gtk');
    expect(caps?.webSpeech).toBe(false);
    expect(caps?.ondevice).toBe(true);
  });
});
