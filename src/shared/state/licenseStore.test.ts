/**
 * licenseStore tests (Phase 2).
 *
 * The store holds the current license status in memory
 * and provides `hydrate` (once at startup), `refresh`
 * (after activate / deactivate), `activate` / `deactivate`
 * (which call the IPC and update the cached status), and
 * `loadMachineFingerprint` (on-demand).
 *
 * The tests exercise:
 * - the `null → populated` transition on hydrate
 * - the idempotency of `hydrate`
 * - the activate / deactivate IPC wiring
 * - the machine fingerprint cache
 * - that a failed hydrate leaves `status: null` (so the UI
 *   can show a "Loading…" placeholder instead of crashing)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  licenseGetStatus: vi.fn(),
  licenseActivate: vi.fn(),
  licenseDeactivate: vi.fn(),
  licenseGetMachineFingerprint: vi.fn(),
}));

vi.mock('@/ipc/licensing', () => ({
  licenseGetStatus: mocks.licenseGetStatus,
  licenseActivate: mocks.licenseActivate,
  licenseDeactivate: mocks.licenseDeactivate,
  licenseGetMachineFingerprint: mocks.licenseGetMachineFingerprint,
}));

import { useLicenseStore } from './licenseStore';
import type { LicenseStatusPayload } from '@/ipc/licensing';

function trial(daysRemaining: number): LicenseStatusPayload {
  return {
    kind: 'trial',
    expiresAt: Math.floor(Date.now() / 1000) + daysRemaining * 86_400,
    daysRemaining,
  };
}

function active(plan: string, daysRemaining: number): LicenseStatusPayload {
  return {
    kind: 'active',
    plan,
    expiresAt: Math.floor(Date.now() / 1000) + daysRemaining * 86_400,
    issuedAt: Math.floor(Date.now() / 1000) - 30 * 86_400,
    daysRemaining,
  };
}

describe('licenseStore', () => {
  beforeEach(() => {
    mocks.licenseGetStatus.mockReset();
    mocks.licenseActivate.mockReset();
    mocks.licenseDeactivate.mockReset();
    mocks.licenseGetMachineFingerprint.mockReset();
    useLicenseStore.setState({ status: null, machineFingerprint: null });
  });

  afterEach(() => {
    useLicenseStore.setState({ status: null, machineFingerprint: null });
  });

  it('starts with status=null and machineFingerprint=null', () => {
    expect(useLicenseStore.getState().status).toBeNull();
    expect(useLicenseStore.getState().machineFingerprint).toBeNull();
  });

  it('transitions status from null to populated on hydrate', async () => {
    mocks.licenseGetStatus.mockResolvedValue(trial(14));
    expect(useLicenseStore.getState().status).toBeNull();
    await useLicenseStore.getState().hydrate();
    const s = useLicenseStore.getState().status;
    expect(s).not.toBeNull();
    expect(s?.kind).toBe('trial');
    if (s?.kind === 'trial') {
      expect(s.daysRemaining).toBe(14);
    }
  });

  it('hydrate is idempotent — second call is a no-op', async () => {
    mocks.licenseGetStatus.mockResolvedValueOnce(trial(14));
    await useLicenseStore.getState().hydrate();
    const after1 = useLicenseStore.getState().status;

    // Second hydrate: the mock would resolve to a different
    // status, but the store should NOT call the IPC again.
    mocks.licenseGetStatus.mockResolvedValueOnce(active('yearly', 365));
    await useLicenseStore.getState().hydrate();
    const after2 = useLicenseStore.getState().status;

    expect(mocks.licenseGetStatus).toHaveBeenCalledTimes(1);
    expect(after2).toEqual(after1);
  });

  it('hydrate swallows IPC errors and leaves status=null', async () => {
    mocks.licenseGetStatus.mockRejectedValue(new Error('bridge disconnected'));
    await useLicenseStore.getState().hydrate();
    expect(useLicenseStore.getState().status).toBeNull();
  });

  it('refresh always re-calls the IPC (does not short-circuit)', async () => {
    mocks.licenseGetStatus.mockResolvedValueOnce(trial(14));
    await useLicenseStore.getState().hydrate();

    mocks.licenseGetStatus.mockResolvedValueOnce(active('monthly', 28));
    await useLicenseStore.getState().refresh();

    expect(mocks.licenseGetStatus).toHaveBeenCalledTimes(2);
    expect(useLicenseStore.getState().status?.kind).toBe('active');
  });

  it('activate calls the IPC, updates state, and returns the new status', async () => {
    const newStatus = active('yearly', 365);
    mocks.licenseActivate.mockResolvedValue(newStatus);

    const result = await useLicenseStore.getState().activate('LIP1.foo.bar');

    expect(mocks.licenseActivate).toHaveBeenCalledWith('LIP1.foo.bar');
    expect(result).toEqual(newStatus);
    expect(useLicenseStore.getState().status).toEqual(newStatus);
  });

  it('activate trims whitespace before calling the IPC', async () => {
    mocks.licenseActivate.mockResolvedValue(active('yearly', 365));
    await useLicenseStore.getState().activate('  LIP1.foo.bar  \n');
    expect(mocks.licenseActivate).toHaveBeenCalledWith('LIP1.foo.bar');
  });

  it('activate with an invalid key surfaces the invalid status', async () => {
    const invalid: LicenseStatusPayload = { kind: 'invalid', reason: 'machine-mismatch' };
    mocks.licenseActivate.mockResolvedValue(invalid);
    const result = await useLicenseStore.getState().activate('LIP1.foo.bar');
    expect(result).toEqual(invalid);
    expect(useLicenseStore.getState().status).toEqual(invalid);
  });

  it('deactivate calls the IPC and resets to unactivated', async () => {
    mocks.licenseGetStatus.mockResolvedValueOnce(trial(14));
    await useLicenseStore.getState().hydrate();
    expect(useLicenseStore.getState().status?.kind).toBe('trial');

    mocks.licenseDeactivate.mockResolvedValue({ kind: 'unactivated' });
    const result = await useLicenseStore.getState().deactivate();

    expect(result).toEqual({ kind: 'unactivated' });
    expect(useLicenseStore.getState().status).toEqual({ kind: 'unactivated' });
  });

  it('loadMachineFingerprint caches the value', async () => {
    const fp = 'a'.repeat(64);
    mocks.licenseGetMachineFingerprint.mockResolvedValue(fp);

    const a = await useLicenseStore.getState().loadMachineFingerprint();
    const b = await useLicenseStore.getState().loadMachineFingerprint();

    expect(a).toBe(fp);
    expect(b).toBe(fp);
    expect(mocks.licenseGetMachineFingerprint).toHaveBeenCalledTimes(1);
    expect(useLicenseStore.getState().machineFingerprint).toBe(fp);
  });
});
