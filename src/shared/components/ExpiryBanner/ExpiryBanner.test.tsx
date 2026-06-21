/* eslint-disable @typescript-eslint/no-non-null-assertion -- test assertions are guarded by prior expect().toBeDefined() */
/**
 * Tests for `ExpiryBanner`. The banner is a thin
 * render-only wrapper around `licenseSurfaces`. The
 * mapping itself is tested in
 * `licenseSurfaces.test.ts`. This file pins the
 * component-level contract:
 *   - Renders nothing for the "default" states.
 *   - Renders a red banner for â‰¤ 3 days trial.
 *   - Renders a red banner for `gracePeriod`.
 *   - The "Got it" button dismisses the banner for
 *     the session.
 *   - The "Activate now" link navigates to the
 *     License activation screen.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { useLicenseStore } from '@/shared/state/licenseStore';
import { useAppStore } from '@/shared/state/appStore';
import type { LicenseStatusPayload } from '@/ipc/licensing';
import { ExpiryBanner } from './ExpiryBanner';

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
    root.render(createElement(ExpiryBanner));
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

describe('ExpiryBanner', () => {
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

  it('renders nothing for trial > 3 days', () => {
    setStatus({ kind: 'trial', expiresAt: 1, daysRemaining: 7 });
    const { container, cleanup } = mount();
    try {
      expect(container.firstChild).toBeNull();
    } finally {
      cleanup();
    }
  });

  it('renders a red banner for trial 3 days (boundary)', () => {
    setStatus({ kind: 'trial', expiresAt: 1, daysRemaining: 3 });
    const { container, cleanup } = mount();
    try {
      expect(container.textContent).toMatch(/Your trial ends in 3 days/);
    } finally {
      cleanup();
    }
  });

  it('renders singular "day" for trial 1 day', () => {
    setStatus({ kind: 'trial', expiresAt: 1, daysRemaining: 1 });
    const { container, cleanup } = mount();
    try {
      expect(container.textContent).toMatch(/Your trial ends in 1 day/);
      expect(container.textContent).not.toMatch(/1 days/);
    } finally {
      cleanup();
    }
  });

  it('renders a red banner for grace period', () => {
    setStatus({ kind: 'gracePeriod', plan: 'yearly', expiredAt: 1, daysIntoGrace: 3 });
    const { container, cleanup } = mount();
    try {
      expect(container.textContent).toMatch(/Your license expired 3 days ago/);
      expect(container.textContent).toMatch(/4 grace days left/);
    } finally {
      cleanup();
    }
  });

  it('renders nothing for active status (any days)', () => {
    setStatus({ kind: 'active', plan: 'yearly', expiresAt: 1, issuedAt: 0, daysRemaining: 5 });
    const { container, cleanup } = mount();
    try {
      expect(container.firstChild).toBeNull();
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

  it('the Got it button dismisses the banner for the session', () => {
    setStatus({ kind: 'trial', expiresAt: 1, daysRemaining: 3 });
    const { container, cleanup } = mount();
    try {
      const buttons = container.querySelectorAll('button');
      // Two buttons: "Activate now" + "Got it"
      const gotIt = Array.from(buttons).find((b) => /Got it/.test(b.textContent || ''));
      expect(gotIt).toBeDefined();
      act(() => {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- test setup guarantees value exists
        gotIt!.click();
      });
      // After clicking, the banner should be removed.
      expect(container.textContent).not.toMatch(/Your trial ends in 3 days/);
    } finally {
      cleanup();
    }
  });

  it('clicking Activate now navigates to the License activation screen', () => {
    setStatus({ kind: 'trial', expiresAt: 1, daysRemaining: 3 });
    const calls = setActiveScreenSpy();
    const { container, cleanup } = mount();
    try {
      const buttons = container.querySelectorAll('button');
      const activate = Array.from(buttons).find((b) => /Activate now/.test(b.textContent || ''));
      expect(activate).toBeDefined();
      act(() => {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- test setup guarantees value exists
        activate!.click();
      });
      expect(calls).toContain('license');
    } finally {
      cleanup();
    }
  });
});
