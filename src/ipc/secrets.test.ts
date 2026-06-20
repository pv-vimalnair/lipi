import { afterEach, describe, expect, it, vi } from 'vitest';

const invokeMock = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import {
  SecretError,
  secretsDeleteApiKey,
  secretsGetApiKey,
  secretsHasApiKey,
  secretsSetApiKey,
} from './secrets';

afterEach(() => {
  invokeMock.mockReset();
});

describe('secrets IPC wrappers', () => {
  it('sets a provider key without returning the value', async () => {
    invokeMock.mockResolvedValueOnce(undefined);
    await secretsSetApiKey('openai', 'sk-test');
    expect(invokeMock).toHaveBeenCalledWith('secrets_set_api_key', {
      provider: 'openai',
      key: 'sk-test',
    });
  });

  it('checks whether a provider key exists', async () => {
    invokeMock.mockResolvedValueOnce(true);
    await expect(secretsHasApiKey('openai')).resolves.toBe(true);
    expect(invokeMock).toHaveBeenCalledWith('secrets_has_api_key', {
      provider: 'openai',
    });
  });

  it('deletes a provider key', async () => {
    invokeMock.mockResolvedValueOnce(undefined);
    await secretsDeleteApiKey('openrouter');
    expect(invokeMock).toHaveBeenCalledWith('secrets_delete_api_key', {
      provider: 'openrouter',
    });
  });

  it('gets only the renderer-readable Wispr key through the raw-key wrapper', async () => {
    invokeMock.mockResolvedValueOnce('wispr-key');
    await expect(secretsGetApiKey('wispr')).resolves.toBe('wispr-key');
    expect(invokeMock).toHaveBeenCalledWith('secrets_get_api_key', {
      provider: 'wispr',
    });
  });

  it('surfaces Rust allowlist failures as SecretError', async () => {
    invokeMock.mockRejectedValueOnce({
      kind: 'invalidInput',
      detail: 'raw key access is only allowed for wispr',
    });
    await expect(secretsGetApiKey('wispr')).rejects.toMatchObject({
      payload: {
        kind: 'invalidInput',
        detail: 'raw key access is only allowed for wispr',
      },
    });
  });

  it('wraps typed secret errors', async () => {
    invokeMock.mockRejectedValueOnce({
      kind: 'keychainUnavailable',
      detail: 'locked',
    });
    await expect(secretsHasApiKey('openai')).rejects.toBeInstanceOf(
      SecretError,
    );
  });
});
