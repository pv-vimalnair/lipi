/**
 * Phase I — `useDeepLinkRouting`.
 *
 * Mounted once at the app root (`main.tsx`). Subscribes to
 * the `lipi://deep-link` event from the Rust side, parses the
 * URL, validates the path, and calls `openWorkspace(path)`.
 *
 * The hook is intentionally tiny: it composes the existing
 * `onDeepLink` IPC subscription, the pure `parseOpenUrl`
 * helper, and the existing `openWorkspace` flow. The same
 * path-validation rules used here are unit-tested in
 * `deepLink.test.ts`; this hook's tests only assert the
 * wiring (subscribe → parse → openWorkspace, or
 * subscribe → parse → setStatus error).
 *
 * Idempotent: if the same URL arrives twice (some platforms
 * re-deliver the cold-start URL when the window regains
 * focus), the workspace store's own deduplication of
 * `recents` makes the open a no-op.
 */
import { useEffect } from 'react';

import {
  friendlyRejectionReason,
  getUserDirs,
  onDeepLink,
  parseOpenUrl,
  rejectionReasonFromValidationError,
  validateDeepLinkPath,
} from '@/ipc';
import { logger } from '@/shared/logger';
import { useWorkspaceStore } from '@/shared/state/workspaceStore';
import { openWorkspace } from '@/screens/Welcome/hooks/useOpenWorkspace';

export function useDeepLinkRouting(): void {
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;

    const setup = async (): Promise<void> => {
      try {
        const userDirs = await getUserDirs();
        const handle = await onDeepLink((rawUrl) => {
          routeDeepLink(rawUrl, userDirs);
        });
        if (cancelled) {
          handle();
        } else {
          unlisten = handle;
        }
      } catch (e) {
        // Outside a Tauri webview (tests, browser preview) the
        // `getCurrentWebview()` call inside `onDeepLink` throws.
        // The Welcome / Editor UIs still work; only the
        // deep-link path is missing. Log once and move on.
        logger.warn('useDeepLinkRouting: not in a Tauri webview, deep links disabled', e);
      }
    };

    void setup();

    return () => {
      cancelled = true;
      if (unlisten) unlisten();
    };
  }, []);
}

/** Pure routing — exported for unit tests so they can
 *  drive the path rules without a React tree. */
export async function routeDeepLink(
  rawUrl: string,
  userDirs: {
    home: string;
    documents: string | null;
    desktop: string | null;
  },
  validatePath: (path: string) => Promise<string> = validateDeepLinkPath,
): Promise<void> {
  const result = parseOpenUrl(rawUrl, userDirs);
  if (result.kind === 'reject') {
    useWorkspaceStore.getState().setStatus({
      kind: 'error',
      message: friendlyRejectionReason(result.reason),
    });
    return;
  }
  try {
    const canonicalPath = await validatePath(result.path);
    await openWorkspace(canonicalPath);
  } catch (error) {
    useWorkspaceStore.getState().setStatus({
      kind: 'error',
      message: friendlyRejectionReason(
        rejectionReasonFromValidationError(error),
      ),
    });
  }
}
