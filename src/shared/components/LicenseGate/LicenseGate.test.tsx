/**
 * Tests for `LicenseGate`. The gate is a thin
 * render-only wrapper around `licenseSurfaces`; the
 * mapping itself is tested in
 * `licenseSurfaces.test.ts`. This file pins the
 * component-level contract:
 *   - Renders nothing for the "default" states
 *     (null, unactivated, active, trial > 7 days).
 *   - Renders a nag modal for `gracePeriod`.
 *   - Renders a hard full-screen block for `expired`.
 *   - Renders a hard full-screen block for `invalid`.
 *   - The nag modal's "I'll do it later" button
 *     dismisses the nag for the session.
 *   - The block's "Activate a license" button
 *     navigates to the License activation screen.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { useLicenseStore } from '@/shared/state/licenseStore';
import { useAppStore } from '@/shared/state/appStore';
import type { LicenseStatusPayload } from '@/ipc/licensing';
import { LicenseGate } from './LicenseGate';

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
    root.render(createElement(LicenseGate));
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

beforeEach(() => {
  // Reset the sessionStorage dismiss flag.
  if (typeof window !== 'undefined' && window.sessionStorage) {
    window.sessionStorage.clear();
  }
  useAppStore.setState({ activeScreen: 'editor' });
});
afterEach(() => {
  useLicenseStore.setState({ status: null });
  if (typeof window !== 'undefined' && window.sessionStorage) {
    window.sessionStorage.clear();
  }
});

describe('LicenseGate', () => {
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

  it('renders nothing for active status', () => {
    setStatus({ kind: 'active', plan: 'yearly', expiresAt: 1, issuedAt: 0, daysRemaining: 137 });
    const { container, cleanup } = mount();
    try {
      expect(container.firstChild).toBeNull();
    } finally {
      cleanup();
    }
  });

  it('renders nothing for trial > 7 days', () => {
    setStatus({ kind: 'trial', expiresAt: 1, daysRemaining: 14 });
    const { container, cleanup } = mount();
    try {
      expect(container.firstChild).toBeNull();
    } finally {
      cleanup();
    }
  });

  it('renders a nag modal for grace period', () => {
    setStatus({ kind: 'gracePeriod', plan: 'yearly', expiredAt: 1, daysIntoGrace: 1 });
    const { container, cleanup } = mount();
    try {
      expect(container.textContent).toMatch(/Your license has expired/);
      expect(container.textContent).toMatch(/6 day/);
      expect(container.textContent).toMatch(/Activate a license/);
    } finally {
      cleanup();
    }
  });

  it('renders a hard full-screen block for expired', () => {
    setStatus({ kind: 'expired', plan: 'yearly', expiredAt: 1 });
    const { container, cleanup } = mount();
    try {
      expect(container.textContent).toMatch(/Your license has expired/);
      expect(container.textContent).toMatch(/Activate a license/);
      const block = container.querySelector('[role="alertdialog"]');
      expect(block).not.toBeNull();
    } finally {
      cleanup();
    }
  });

  it('renders a hard full-screen block for invalid', () => {
    setStatus({ kind: 'invalid', reason: 'verification-failed' });
    const { container, cleanup } = mount();
    try {
      expect(container.textContent).toMatch(/License invalid/);
      const block = container.querySelector('[role="alertdialog"]');
      expect(block).not.toBeNull();
    } finally {
      cleanup();
    }
  });

  it('nag modal can be dismissed via "I will do it later"', () => {
    setStatus({ kind: 'gracePeriod', plan: 'yearly', expiredAt: 1, daysIntoGrace: 1 });
    const { container, cleanup } = mount();
    try {
      const later = Array.from(container.querySelectorAll('button')).find(
        (b) => /I'll do it later/.test(b.textContent || ''),
      );
      expect(later).toBeDefined();
      act(() => {
        later!.click();
      });
      expect(container.textContent).not.toMatch(/Your license has expired/);
    } finally {
      cleanup();
    }
  });

  it('nag modal re-appears when the status changes (e.g. user rehydrates)', () => {
    setStatus({ kind: 'gracePeriod', plan: 'yearly', expiredAt: 1, daysIntoGrace: 1 });
    const { container, cleanup } = mount();
    try {
      // Dismiss.
      const later = Array.from(container.querySelectorAll('button')).find(
        (b) => /I'll do it later/.test(b.textContent || ''),
      );
      act(() => {
        later!.click();
      });
      expect(container.textContent).not.toMatch(/Your license has expired/);
      // Now flip the status to non-grace and back; the
      // useEffect inside LicenseGate resets the dismiss
      // flag.
      act(() => {
        setStatus({ kind: 'active', plan: 'yearly', expiresAt: 1, issuedAt: 0, daysRemaining: 100 });
      });
      act(() => {
        setStatus({ kind: 'gracePeriod', plan: 'yearly', expiredAt: 1, daysIntoGrace: 1 });
      });
      expect(container.textContent).toMatch(/Your license has expired/);
    } finally {
      cleanup();
    }
  });

  it('the blocks "Activate a license" button navigates to License screen', () => {
    setStatus({ kind: 'expired', plan: 'yearly', expiredAt: 1 });
    const calls = setActiveScreenSpy();
    const { container, cleanup } = mount();
    try {
      const buttons = container.querySelectorAll('button');
      const activate = Array.from(buttons).find((b) => /Activate a license/.test(b.textContent || ''));
      expect(activate).toBeDefined();
      act(() => {
        activate!.click();
      });
      expect(calls).toContain('license');
    } finally {
      cleanup();
    }
  });
});
