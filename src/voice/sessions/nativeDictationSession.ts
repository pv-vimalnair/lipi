/**
 * nativeDictationSession — M3 `VoiceSession` factory stub
 * for the `'nativeDictation'` provider (iOS Swift /
 * Android Kotlin plugins).
 *
 * Per Decision #6, the M3 PR adds ONLY the factory stub
 * (this file). The actual Swift / Kotlin plugins land in
 * their own repositories; the JS side just needs a typed
 * factory to dispatch against. Adding the Settings card
 * and Command Palette entry is deferred until the
 * plugins are ready.
 *
 * Behaviour: any `start()` call rejects with
 * `VoiceSessionError('not-configured')`. The
 * `useVoiceCapture` hook will surface that as a
 * `voiceStore.lastError` ("On-device STT is not
 * configured…").
 */
import { voiceSessionErrorMessage } from '../session';
import { VoiceSessionError } from '../session';
import type { VoiceSessionHandle } from '../session';
import type { VoiceSessionFactoryOptions } from '../sessionFactory';

export function createNativeDictationSession(
  _opts: VoiceSessionFactoryOptions,
): Promise<VoiceSessionHandle> {
  return Promise.resolve().then(() => {
    throw new VoiceSessionError(
      'not-configured',
      voiceSessionErrorMessage('not-configured'),
      { retryable: false },
    );
  });
}
