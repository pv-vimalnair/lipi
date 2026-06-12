import { describe, expect, it, beforeEach } from 'vitest';
import {
  useVoicePreferencesStore,
  voicePreferencesSelectors,
  setupVoicePreferencesPersistence,
  DEFAULT_LANGUAGE,
  type VoiceProviderId,
} from './voicePreferencesStore';

describe('voicePreferencesStore', () => {
  beforeEach(() => {
    localStorage.clear();
    useVoicePreferencesStore.setState({
      provider: 'wispr',
      language: DEFAULT_LANGUAGE,
      hydrated: false,
    });
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
    expect(stored).toBe(JSON.stringify({ provider: 'stub', language: DEFAULT_LANGUAGE }));
  });

  it('selector returns the current provider', () => {
    useVoicePreferencesStore.getState().setProvider('ondevice');
    expect(voicePreferencesSelectors.provider(useVoicePreferencesStore.getState())).toBe('ondevice');
  });

  it('accepts all four valid providers', () => {
    const providers: VoiceProviderId[] = ['stub', 'wispr', 'ondevice', 'webSpeech', 'nativeDictation'];
    for (const p of providers) {
      useVoicePreferencesStore.getState().setProvider(p);
      expect(useVoicePreferencesStore.getState().provider).toBe(p);
    }
  });

  it('accepts webSpeech as a valid persisted provider', () => {
    localStorage.setItem(
      'lipi:voicePreferences:v1',
      JSON.stringify({ provider: 'webSpeech', language: 'en-US' }),
    );
    useVoicePreferencesStore.getState().hydrate();
    expect(useVoicePreferencesStore.getState().provider).toBe('webSpeech');
  });

  it('defaults language to en-US', () => {
    expect(useVoicePreferencesStore.getState().language).toBe('en-US');
  });

  it('setLanguage updates the value', () => {
    useVoicePreferencesStore.getState().setLanguage('fr-FR');
    expect(useVoicePreferencesStore.getState().language).toBe('fr-FR');
  });

  it('setLanguage rejects empty strings (defensive)', () => {
    useVoicePreferencesStore.getState().setLanguage('en-US');
    useVoicePreferencesStore.getState().setLanguage('');
    // The empty string is rejected silently —
    // the store keeps the previous valid value.
    expect(useVoicePreferencesStore.getState().language).toBe('en-US');
  });

  it('setLanguage rejects non-string values (defensive)', () => {
    useVoicePreferencesStore.getState().setLanguage('en-US');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    useVoicePreferencesStore.getState().setLanguage(123 as unknown as any);
    expect(useVoicePreferencesStore.getState().language).toBe('en-US');
  });

  it('persists language alongside provider after hydration', () => {
    useVoicePreferencesStore.getState().hydrate();
    setupVoicePreferencesPersistence();
    useVoicePreferencesStore.getState().setLanguage('de-DE');
    const stored = localStorage.getItem('lipi:voicePreferences:v1');
    expect(stored).toBe(JSON.stringify({ provider: 'wispr', language: 'de-DE' }));
  });

  it('hydrate back-fills a missing language with the default', () => {
    // Older persisted payloads (pre-M2c-mobile)
    // don't have a `language` field. The store
    // should back-fill with DEFAULT_LANGUAGE.
    localStorage.setItem(
      'lipi:voicePreferences:v1',
      JSON.stringify({ provider: 'stub' }),
    );
    useVoicePreferencesStore.getState().hydrate();
    expect(useVoicePreferencesStore.getState().language).toBe(DEFAULT_LANGUAGE);
  });

  it('hydrate ignores a malformed language and uses the default', () => {
    localStorage.setItem(
      'lipi:voicePreferences:v1',
      JSON.stringify({ provider: 'stub', language: '' }),
    );
    useVoicePreferencesStore.getState().hydrate();
    expect(useVoicePreferencesStore.getState().language).toBe(DEFAULT_LANGUAGE);
  });

  it('language selector returns the current value', () => {
    useVoicePreferencesStore.getState().setLanguage('ja-JP');
    expect(voicePreferencesSelectors.language(useVoicePreferencesStore.getState())).toBe('ja-JP');
  });
});
