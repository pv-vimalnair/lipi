import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/shared/components/Button';
import {
  SecretError,
  secretsDeleteApiKey,
  secretsGetApiKey,
  secretsHasApiKey,
  secretsSetApiKey,
} from '@/ipc';
import type { SaveState } from './ProviderCards';
import styles from '../SettingsProvider.module.css';

type WisprSaveState = SaveState;

type TestState =
  | { kind: 'idle' }
  | { kind: 'testing' }
  | { kind: 'ok' }
  | { kind: 'error'; message: string };

export function WisprCard(): JSX.Element {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [draft, setDraft] = useState('');
  const [showDraft, setShowDraft] = useState(false);
  const [saveState, setSaveState] = useState<WisprSaveState>({ kind: 'idle' });
  const [removing, setRemoving] = useState(false);
  const [testState, setTestState] = useState<TestState>({ kind: 'idle' });

  const refresh = useCallback(async () => {
    try {
      const has = await secretsHasApiKey('wispr');
      setConfigured(has);
    } catch (err) {
      setSaveState({
        kind: 'error',
        message: err instanceof SecretError ? err.payload.detail : String(err),
      });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const onSave = useCallback(async () => {
    if (!draft) return;
    setSaveState({ kind: 'saving' });
    try {
      await secretsSetApiKey('wispr', draft);
      setDraft('');
      setShowDraft(false);
      setSaveState({ kind: 'saved' });
      setTimeout(() => {
        setSaveState((s) => (s.kind === 'saved' ? { kind: 'idle' } : s));
      }, 2000);
      await refresh();
    } catch (err) {
      setSaveState({
        kind: 'error',
        message: err instanceof SecretError ? err.payload.detail : String(err),
      });
    }
  }, [draft, refresh]);

  const onRemove = useCallback(async () => {
    setRemoving(true);
    try {
      await secretsDeleteApiKey('wispr');
      setTestState({ kind: 'idle' });
      await refresh();
    } catch (err) {
      setSaveState({
        kind: 'error',
        message: err instanceof SecretError ? err.payload.detail : String(err),
      });
    } finally {
      setRemoving(false);
    }
  }, [refresh]);

  const onTestConnection = useCallback(async () => {
    setTestState({ kind: 'testing' });
    try {
      const key = await secretsGetApiKey('wispr');
      if (!key) {
        setTestState({ kind: 'error', message: 'No key in keychain.' });
        return;
      }
      setTestState({ kind: 'ok' });
      setTimeout(() => {
        setTestState((s) => (s.kind === 'ok' ? { kind: 'idle' } : s));
      }, 2000);
    } catch (err) {
      setTestState({
        kind: 'error',
        message: err instanceof SecretError ? err.payload.detail : String(err),
      });
    }
  }, []);

  return (
    <article className={styles.card}>
      <header className={styles.cardHeader}>
        <div className={styles.cardTitleRow}>
          <h2 className={styles.cardTitle}>Wispr Flow</h2>
          <span
            className={styles.badge}
            data-configured={configured || undefined}
          >
            {configured === null
              ? 'Checking…'
              : configured
                ? 'Configured'
                : 'Not configured'}
          </span>
        </div>
        <a
          className={styles.keyLink}
          href="https://platform.wisprflow.ai"
          target="_blank"
          rel="noreferrer noopener"
        >
          Get a key →
        </a>
      </header>
      <p className={styles.cardDescription}>
        Wispr Flow is the recommended voice-to-text provider. Code-aware
        dictation (it knows &ldquo;open paren&rdquo; is punctuation, &ldquo;React&rdquo; is a
        word, &ldquo;three backticks&rdquo; is a fence), with auto-formatting and
        filler-word removal. Enterprise approval is required for an API
        key — apply at{' '}
        <a
          href="mailto:enterprise@wisprflow.ai"
          className={styles.keyLink}
        >
          enterprise@wisprflow.ai
        </a>{' '}
        if you don&apos;t have one yet. While you wait, the on-device
        fallback ships in M2c.
      </p>
      <div className={styles.keyRow}>
        <input
          type={showDraft ? 'text' : 'password'}
          className={styles.keyInput}
          placeholder={
            configured
              ? 'Paste a new key to replace the saved one'
              : 'Paste your Wispr API key'
          }
          autoComplete="off"
          spellCheck={false}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            if (saveState.kind === 'error') {
              setSaveState({ kind: 'idle' });
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && draft && saveState.kind !== 'saving') {
              void onSave();
            }
          }}
          disabled={saveState.kind === 'saving'}
          aria-label="Wispr Flow API key"
        />
        <Button
          variant="ghost"
          size="md"
          onClick={() => setShowDraft((s) => !s)}
          disabled={!draft}
          title={showDraft ? 'Hide the key' : 'Show the key'}
        >
          {showDraft ? 'Hide' : 'Show'}
        </Button>
        <Button
          variant="primary"
          size="md"
          onClick={() => void onSave()}
          loading={saveState.kind === 'saving'}
          disabled={!draft || saveState.kind === 'saving'}
        >
          Save
        </Button>
        {configured && (
          <Button
            variant="ghost"
            size="md"
            onClick={() => void onRemove()}
            loading={removing}
            disabled={removing}
          >
            Remove
          </Button>
        )}
      </div>
      {configured && (
        <div className={styles.testRow}>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void onTestConnection()}
            loading={testState.kind === 'testing'}
            disabled={testState.kind === 'testing'}
          >
            Test connection
          </Button>
          {testState.kind === 'ok' && (
            <span className={styles.statusOk} role="status">
              Key reachable from the WebView. The mic button will open a
              WebSocket to Wispr when you click it.
            </span>
          )}
          {testState.kind === 'error' && (
            <span className={styles.statusError} role="alert">
              {testState.message}
            </span>
          )}
        </div>
      )}
      {saveState.kind === 'saved' && (
        <span className={styles.statusOk} role="status">
          Saved to keychain.
        </span>
      )}
      {saveState.kind === 'error' && (
        <span className={styles.statusError} role="alert">
          {saveState.message}
        </span>
      )}
    </article>
  );
}
