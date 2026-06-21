/**
 * Tests for `TransferFlow`. The flow is a 3-step
 * wizard (confirm â†’ running â†’ result). The component
 * delegates the actual deactivation to
 * `useLicenseStore.deactivate`; we mock the store
 * to verify the state transitions.
 *
 * Phase 4.1 (IAP v1.1 follow-ups): we also
 * mock `licenseGetKid` so we can exercise the
 * IAP-redirect path (when the current license is
 * IAP-issued, the result step shows a different
 * message and skips the email generation).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { useLicenseStore } from '@/shared/state/licenseStore';
import type { LicenseStatusPayload } from '@/ipc/licensing';
import { TransferFlow } from './TransferFlow';

// Phase 4.1: mock the IPC layer so we can
// control the `kid` returned by
// `licenseGetKid`. The default is "trial"
// (non-IAP); individual tests override this
// with `setLicenseKidForTests` to exercise
// the IAP-redirect path.
const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn().mockResolvedValue('trial'),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
}));

function mount(): { container: HTMLDivElement; root: Root; cleanup: () => void } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(createElement(TransferFlow));
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

let deactivateMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  deactivateMock = vi.fn().mockResolvedValue(undefined);
  useLicenseStore.setState({
    status: { kind: 'active', plan: 'yearly', expiresAt: 1, issuedAt: 0, daysRemaining: 100 } as LicenseStatusPayload,
    machineFingerprint: 'aaaa1111bbbb2222cccc3333dddd4444eeee5555ffff6666aaaa1111bbbb2222',
    // The store's `deactivate` field is typed
    // `() => Promise<LicenseStatusPayload>`; in the
    // test we only care that it's called, not what it
    // returns. Cast to the test's mock signature.
    deactivate: deactivateMock as unknown as () => Promise<LicenseStatusPayload>,
    loadMachineFingerprint: vi.fn().mockResolvedValue('aaaa1111bbbb2222cccc3333dddd4444eeee5555ffff6666aaaa1111bbbb2222') as unknown as () => Promise<string>,
  });
  // Reset the IPC mock to its default (returns
  // "trial" for the license_get_kid command).
  invokeMock.mockReset();
  invokeMock.mockResolvedValue('trial');
});
afterEach(() => {
  useLicenseStore.setState({ status: null, machineFingerprint: null });
});

describe('TransferFlow', () => {
  it('renders the initial confirmation step', () => {
    const { container, cleanup } = mount();
    try {
      expect(container.textContent).toMatch(/Transfer to a new machine/);
      expect(container.textContent).toMatch(/Yes, deactivate on this machine/);
      expect(container.textContent).toMatch(/Cancel/);
    } finally {
      cleanup();
    }
  });

  it('confirming the transfer calls deactivate IPC', async () => {
    const { container, cleanup } = mount();
    try {
      const yes = Array.from(container.querySelectorAll('button')).find(
        (b) => /Yes, deactivate/.test(b.textContent || ''),
      );
      expect(yes).toBeDefined();
      await act(async () => {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- test setup guarantees value exists
        yes!.click();
        // Allow the async deactivate to resolve.
        await Promise.resolve();
      });
      expect(deactivateMock).toHaveBeenCalledTimes(1);
    } finally {
      cleanup();
    }
  });

  it('shows the success step after deactivation with the email body', async () => {
    const { container, cleanup } = mount();
    try {
      const yes = Array.from(container.querySelectorAll('button')).find(
        (b) => /Yes, deactivate/.test(b.textContent || ''),
      );
      await act(async () => {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- test setup guarantees value exists
        yes!.click();
        await Promise.resolve();
      });
      // After the promise resolves, the component
      // moves to the 'result' step.
      expect(container.textContent).toMatch(/Your license has been deactivated on this machine/);
      expect(container.textContent).toMatch(/licensing@lipi.ide/);
      // The fingerprint appears in the email body.
      expect(container.textContent).toMatch(/aaaa1111bbbb2222/);
      // The plan appears in the email body.
      expect(container.textContent).toMatch(/yearly/);
    } finally {
      cleanup();
    }
  });

  it('the "Cancel" button keeps the flow on the confirm step', () => {
    const { container, cleanup } = mount();
    try {
      const cancel = Array.from(container.querySelectorAll('button')).find(
        (b) => /^Cancel$/.test((b.textContent || '').trim()),
      );
      expect(cancel).toBeDefined();
      act(() => {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- test setup guarantees value exists
        cancel!.click();
      });
      // Still on the confirm step.
      expect(container.textContent).toMatch(/Transfer to a new machine/);
      expect(deactivateMock).not.toHaveBeenCalled();
    } finally {
      cleanup();
    }
  });

  it('the email body uses the plan from a gracePeriod status', async () => {
    useLicenseStore.setState({
      status: { kind: 'gracePeriod', plan: 'monthly', expiredAt: 1, daysIntoGrace: 1 },
      machineFingerprint: 'ffff9999ffff9999ffff9999ffff9999ffff9999ffff9999ffff9999ffff9999',
    });
    const { container, cleanup } = mount();
    try {
      const yes = Array.from(container.querySelectorAll('button')).find(
        (b) => /Yes, deactivate/.test(b.textContent || ''),
      );
      await act(async () => {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- test setup guarantees value exists
        yes!.click();
        await Promise.resolve();
      });
      expect(container.textContent).toMatch(/monthly/);
    } finally {
      cleanup();
    }
  });

  // --- Phase 4.1: IAP-license redirect ---

  it('for an IAP-issued license, the result step shows the IAP-specific message', async () => {
    // Mock the `license_get_kid` IPC to
    // return `iap-local` so the component
    // thinks the current license is
    // IAP-issued.
    invokeMock.mockResolvedValue('iap-local');
    const { container, cleanup } = mount();
    try {
      const yes = Array.from(container.querySelectorAll('button')).find(
        (b) => /Yes, deactivate/.test(b.textContent || ''),
      );
      await act(async () => {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- test setup guarantees value exists
        yes!.click();
        await Promise.resolve();
      });
      // After the IAP redirect, the result
      // step shows the IAP-specific message
      // and does NOT show the email body.
      expect(container.textContent).toMatch(/IAP licenses can.t be transferred/);
      expect(container.textContent).toMatch(/cancel your IAP subscription on this machine/);
      // The email body element is not present.
      const emailBody = container.querySelector('[aria-label="Email body to send to support"]');
      expect(emailBody).toBeNull();
    } finally {
      cleanup();
    }
  });

  it('for an IAP-issued license, the result step skips the email generation', async () => {
    invokeMock.mockResolvedValue('iap-local');
    const { container, cleanup } = mount();
    try {
      const yes = Array.from(container.querySelectorAll('button')).find(
        (b) => /Yes, deactivate/.test(b.textContent || ''),
      );
      await act(async () => {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- test setup guarantees value exists
        yes!.click();
        await Promise.resolve();
      });
      // The "Copy email to clipboard" button
      // is NOT present in the IAP-redirect
      // result step.
      const copyButton = Array.from(container.querySelectorAll('button')).find(
        (b) => /Copy email to clipboard/.test(b.textContent || ''),
      );
      expect(copyButton).toBeUndefined();
    } finally {
      cleanup();
    }
  });

  it('for a trial license, the result step shows the existing email body (backward-compat)', async () => {
    // Default mock returns "trial" (set in
    // beforeEach). The result step should
    // show the email body.
    invokeMock.mockResolvedValue('trial');
    const { container, cleanup } = mount();
    try {
      const yes = Array.from(container.querySelectorAll('button')).find(
        (b) => /Yes, deactivate/.test(b.textContent || ''),
      );
      await act(async () => {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- test setup guarantees value exists
        yes!.click();
        await Promise.resolve();
      });
      expect(container.textContent).toMatch(/Your license has been deactivated on this machine/);
      expect(container.textContent).toMatch(/licensing@lipi\.ide/);
    } finally {
      cleanup();
    }
  });
});
