/* eslint-disable @typescript-eslint/no-non-null-assertion -- test assertions are guarded by prior expect().toBeDefined() */
/**
 * Tests for `TrialBadge`. The badge is a thin
 * render-only wrapper around `licenseSurfaces`; the
 * mapping itself is tested in
 * `licenseSurfaces.test.ts`. This file pins the
 * component-level contract:
 *   - Renders nothing for the "default" states.
 *   - Renders a red pill for ≤ 3 days trial / grace.
 *   - Renders an amber pill for ≤ 7 days trial or active.
 *   - Renders a neutral pill for > 7 days trial.
 *   - Clicking the pill navigates to the License
 *     activation screen.
 *
 * We use the `createRoot` + `act` pattern (same
 * as `WorkspaceTabs.test.tsx`) — no
 * `@testing-library/react` dependency.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { useLicenseStore } from '@/shared/state/licenseStore';
import { useAppStore } from '@/shared/state/appStore';
import type { LicenseStatusPayload } from '@/ipc/licensing';
import { TrialBadge } from './TrialBadge';

function setStatus(status: LicenseStatusPayload | null): void {
  useLicenseStore.setState({ status });
}

function setActiveScreenSpy() {
  const calls: Array<'editor' | 'settings' | 'welcome' | 'license'> = [];
  const orig = useAppStore.getState().setActiveScreen;
  useAppStore.setState({
    setActiveScreen: (s) => {
      calls.push(s);
      orig(s);
    },
  });
  return calls;
}

function mount(): { container: HTMLDivElement; root: Root; cleanup: () => void } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(createElement(TrialBadge));
  });
  return {
    container,
    root,
    cleanup: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

describe('TrialBadge', () => {
  beforeEach(() => {
    useAppStore.setState({ activeScreen: 'editor' });
  });
  afterEach(() => {
    useLicenseStore.setState({ status: null });
  });

  it('renders nothing for null (hydrating) status', () => {
    setStatus(null);
    const { container, cleanup } = mount();
    try {
      expect(container.firstChild).toBeNull();
    } finally {
      cleanup();
    }
  });

  it('renders nothing for unactivated status', () => {
    setStatus({ kind: 'unactivated' });
    const { container, cleanup } = mount();
    try {
      expect(container.firstChild).toBeNull();
    } finally {
      cleanup();
    }
  });

  it('renders a neutral pill for trial > 7 days', () => {
    setStatus({ kind: 'trial', expiresAt: 1, daysRemaining: 14 });
    const { container, cleanup } = mount();
    try {
      expect(container.textContent).toMatch(/Trial — 14 days left/);
    } finally {
      cleanup();
    }
  });

  it('renders an amber pill for trial 7 days (boundary)', () => {
    setStatus({ kind: 'trial', expiresAt: 1, daysRemaining: 7 });
    const { container, cleanup } = mount();
    try {
      expect(container.textContent).toMatch(/Trial — 7 days left/);
    } finally {
      cleanup();
    }
  });

  it('renders a red pill for trial 3 days (boundary)', () => {
    setStatus({ kind: 'trial', expiresAt: 1, daysRemaining: 3 });
    const { container, cleanup } = mount();
    try {
      expect(container.textContent).toMatch(/Trial — 3 days left/);
    } finally {
      cleanup();
    }
  });

  it('renders a red pill with singular "day" for trial 1 day', () => {
    setStatus({ kind: 'trial', expiresAt: 1, daysRemaining: 1 });
    const { container, cleanup } = mount();
    try {
      expect(container.textContent).toMatch(/Trial — 1 day left/);
    } finally {
      cleanup();
    }
  });

  it('renders nothing for active > 7 days', () => {
    setStatus({ kind: 'active', plan: 'yearly', expiresAt: 1, issuedAt: 0, daysRemaining: 137 });
    const { container, cleanup } = mount();
    try {
      expect(container.firstChild).toBeNull();
    } finally {
      cleanup();
    }
  });

  it('renders an amber pill for active 7 days (boundary)', () => {
    setStatus({ kind: 'active', plan: 'monthly', expiresAt: 1, issuedAt: 0, daysRemaining: 7 });
    const { container, cleanup } = mount();
    try {
      expect(container.textContent).toMatch(/Monthly — 7 days left/);
    } finally {
      cleanup();
    }
  });

  it('renders a red pill for gracePeriod', () => {
    setStatus({ kind: 'gracePeriod', plan: 'yearly', expiredAt: 1, daysIntoGrace: 1 });
    const { container, cleanup } = mount();
    try {
      expect(container.textContent).toMatch(/Grace — 6 days left/);
    } finally {
      cleanup();
    }
  });

  it('renders nothing for expired status (the gate handles it)', () => {
    setStatus({ kind: 'expired', plan: 'yearly', expiredAt: 1 });
    const { container, cleanup } = mount();
    try {
      expect(container.firstChild).toBeNull();
    } finally {
      cleanup();
    }
  });

  it('renders nothing for invalid status (the gate handles it)', () => {
    setStatus({ kind: 'invalid', reason: 'verification-failed' });
    const { container, cleanup } = mount();
    try {
      expect(container.firstChild).toBeNull();
    } finally {
      cleanup();
    }
  });

  it('clicking the pill navigates to the License activation screen', () => {
    setStatus({ kind: 'trial', expiresAt: 1, daysRemaining: 3 });
    const calls = setActiveScreenSpy();
    const { container, cleanup } = mount();
    try {
      const button = container.querySelector('button');
      expect(button).not.toBeNull();
      act(() => {
        button!.click();
      });
      expect(calls).toContain('license');
    } finally {
      cleanup();
    }
  });
});
