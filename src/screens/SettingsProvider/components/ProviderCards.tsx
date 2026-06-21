import { useCallback, useEffect, useState } from 'react';
import { Stack } from '@/shared/components/Stack';
import { Button } from '@/shared/components/Button';
import {
  aiGetConfiguredProviders,
  aiListProviders,
  type ProviderInfo,
} from '@/ipc';
import {
  SecretError,
  secretsDeleteApiKey,
  secretsHasApiKey,
  secretsSetApiKey,
} from '@/ipc';
import styles from '../SettingsProvider.module.css';

export type SaveState =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'saved' }
  | { kind: 'error'; message: string };

export function ProviderCards() {
  const [providers, setProviders] = useState<ProviderInfo[] | null>(null);
  const [configured, setConfigured] = useState<Set<string>>(new Set());
  const [loadError, setLoadError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [list, configuredIds] = await Promise.all([
        aiListProviders(),
        aiGetConfiguredProviders(),
      ]);
      setProviders(list);
      setConfigured(new Set(configuredIds));
      setLoadError(null);
    } catch (err) {
      setLoadError(
        err instanceof Error ? err.message : 'Failed to load providers',
      );
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (loadError) {
    return (
      <div className={styles.errorCard} role="alert">
        <span className={styles.errorTitle}>
          Couldn't load provider list
        </span>
        <span className={styles.errorDetail}>{loadError}</span>
        <div>
          <Button variant="ghost" size="sm" onClick={() => void refresh()}>
            Retry
          </Button>
        </div>
      </div>
    );
  }

  if (!providers) {
    return (
      <div className={styles.placeholder}>
        <span>Loading providers…</span>
      </div>
    );
  }

  return (
    <Stack direction="column" gap={4}>
      {providers.map((p) => (
        <ProviderCard
          key={p.id}
          provider={p}
          configured={configured.has(p.id)}
          onChanged={() => void refresh()}
        />
      ))}
    </Stack>
  );
}

interface ProviderCardProps {
  provider: ProviderInfo;
  configured: boolean;
  onChanged: () => void;
}

function ProviderCard({ provider, configured, onChanged }: ProviderCardProps) {
  const [draft, setDraft] = useState('');
  const [saveState, setSaveState] = useState<SaveState>({ kind: 'idle' });
  const [removing, setRemoving] = useState(false);

  const onSave = useCallback(async () => {
    if (!draft) return;
    setSaveState({ kind: 'saving' });
    try {
      await secretsSetApiKey(provider.id, draft);
      setDraft('');
      setSaveState({ kind: 'saved' });
      onChanged();
      setTimeout(() => {
        setSaveState((s) => (s.kind === 'saved' ? { kind: 'idle' } : s));
      }, 2000);
    } catch (err) {
      setSaveState({
        kind: 'error',
        message: err instanceof SecretError ? err.payload.detail : String(err),
      });
    }
  }, [draft, onChanged, provider.id]);

  const onRemove = useCallback(async () => {
    setRemoving(true);
    try {
      await secretsDeleteApiKey(provider.id);
      onChanged();
    } catch (err) {
      setSaveState({
        kind: 'error',
        message: err instanceof SecretError ? err.payload.detail : String(err),
      });
    } finally {
      setRemoving(false);
    }
  }, [onChanged, provider.id]);

  const onCheckHas = useCallback(async () => {
    try {
      const has = await secretsHasApiKey(provider.id);
      if (has) onChanged();
    } catch {
      // Already reflected in the configured badge via the
      // parent refresh; nothing to do here.
    }
  }, [onChanged, provider.id]);

  return (
    <article
      className={styles.card}
      data-configured={configured || undefined}
    >
      <header className={styles.cardHeader}>
        <div className={styles.cardTitleRow}>
          <h2 className={styles.cardTitle}>{provider.displayName}</h2>
          <span
            className={styles.badge}
            data-configured={configured || undefined}
          >
            {configured ? 'Configured' : 'Not configured'}
          </span>
        </div>
        <a
          className={styles.keyLink}
          href={provider.keyUrl}
          target="_blank"
          rel="noreferrer noopener"
        >
          Get a key →
        </a>
      </header>
      <p className={styles.cardDescription}>{provider.description}</p>
      <div className={styles.keyRow}>
        <input
          type="password"
          className={styles.keyInput}
          placeholder={
            configured
              ? 'Paste a new key to replace the saved one'
              : 'Paste your API key'
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
          aria-label={`${provider.displayName} API key`}
        />
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
      {saveState.kind === 'saved' && (
        <span className={styles.statusOk} role="status">
          Saved to keychain.
        </span>
      )}
      {saveState.kind === 'error' && (
        <span className={styles.statusError} role="alert">
          {saveState.message}{' '}
          <button
            type="button"
            className={styles.statusLink}
            onClick={() => void onCheckHas()}
          >
            Retry
          </button>
        </span>
      )}
    </article>
  );
}
