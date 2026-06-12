import { describe, expect, it, beforeEach } from 'vitest';
import {
  useVoicePreferencesStore,
  voicePreferencesSelectors,
  setupVoicePreferencesPersistence,
  type VoiceProvider,
} from './voicePreferencesStore';

describe('voicePreferencesStore', () => {
  beforeEach(() => {
    localStorage.clear();
    useVoicePreferencesStore.setState({ provider: 'wispr', hydrated: false });
  });

  it('defaults to wispr', () => {
    expect(useVoicePreferencesStore.getState().provider).toBe('wispr');
  });

  it('setProvider updates the value', () => {
    useVoicePreferencesStore.getState().setProvider('stub');
    expect(useVoicePreferencesStore.getState().provider).toBe('stub');
  });

  it('hydrate reads persisted state', () => {
    localStorage.setItem('lipi:voicePreferences:v1', JSON.stringify({ provider: 'stub' }));
    useVoicePreferencesStore.getState().hydrate();
    expect(useVoicePreferencesStore.getState().provider).toBe('stub');
  });

  it('hydrate ignores malformed state', () => {
    localStorage.setItem('lipi:voicePreferences:v1', JSON.stringify({ provider: 'invalid' }));
    useVoicePreferencesStore.getState().hydrate();
    expect(useVoicePreferencesStore.getState().provider).toBe('wispr');
  });

  it('hydrate falls back to default on missing key', () => {
    useVoicePreferencesStore.getState().hydrate();
    expect(useVoicePreferencesStore.getState().provider).toBe('wispr');
  });

  it('persists on setProvider after hydration', () => {
    useVoicePreferencesStore.getState().hydrate();
    setupVoicePreferencesPersistence();
    useVoicePreferencesStore.getState().setProvider('stub');
    const stored = localStorage.getItem('lipi:voicePreferences:v1');
    expect(stored).toBe(JSON.stringify({ provider: 'stub' }));
  });

  it('selector returns the current provider', () => {
    useVoicePreferencesStore.getState().setProvider('ondevice');
    expect(voicePreferencesSelectors.provider(useVoicePreferencesStore.getState())).toBe('ondevice');
  });

  it('accepts all three valid providers', () => {
    const providers: VoiceProvider[] = ['stub', 'wispr', 'ondevice'];
    for (const p of providers) {
      useVoicePreferencesStore.getState().setProvider(p);
      expect(useVoicePreferencesStore.getState().provider).toBe(p);
    }
  });
});
