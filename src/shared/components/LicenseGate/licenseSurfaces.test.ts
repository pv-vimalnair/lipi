/**
 * Tests for the `licenseSurfaces` pure helper.
 *
 * The helper maps a `LicenseStatusPayload` to the three
 * UI-surface decisions (gate, badge, banner). The mapping
 * is the single source of truth for the subscription UX,
 * so the test suite pins every state × surface cell.
 */
import { describe, expect, it } from 'vitest';

import { licenseSurfaces } from './licenseSurfaces';
import type { LicenseStatusPayload } from '@/ipc/licensing';

function trial(daysRemaining: number): LicenseStatusPayload {
  return { kind: 'trial', expiresAt: 1, daysRemaining };
}

function active(plan: 'monthly' | 'yearly', daysRemaining: number): LicenseStatusPayload {
  return { kind: 'active', plan, expiresAt: 1, issuedAt: 0, daysRemaining };
}

function grace(daysIntoGrace: number): LicenseStatusPayload {
  return {
    kind: 'gracePeriod',
    plan: 'yearly',
    expiredAt: 1,
    daysIntoGrace,
  };
}

function expired(): LicenseStatusPayload {
  return { kind: 'expired', plan: 'yearly', expiredAt: 1 };
}

function invalid(reason = 'verification-failed'): LicenseStatusPayload {
  return { kind: 'invalid', reason };
}

describe('licenseSurfaces', () => {
  describe('null (hydrating)', () => {
    it('returns all-hidden for null status', () => {
      const s = licenseSurfaces(null);
      expect(s.gate).toBe('none');
      expect(s.badge).toBeNull();
      expect(s.banner).toBe(false);
    });
  });

  describe('unactivated', () => {
    it('returns all-hidden for unactivated', () => {
      const s = licenseSurfaces({ kind: 'unactivated' });
      expect(s.gate).toBe('none');
      expect(s.badge).toBeNull();
      expect(s.banner).toBe(false);
    });
  });

  describe('trial', () => {
    it('trial with 14 days: neutral badge, no banner, no gate', () => {
      const s = licenseSurfaces(trial(14));
      expect(s.gate).toBe('none');
      expect(s.badge).toEqual({ tone: 'neutral', label: 'Trial — 14 days left' });
      expect(s.banner).toBe(false);
    });

    it('trial with 8 days: neutral badge (still > 7), no banner', () => {
      const s = licenseSurfaces(trial(8));
      expect(s.gate).toBe('none');
      expect(s.badge?.tone).toBe('neutral');
      expect(s.banner).toBe(false);
    });

    it('trial with 7 days: amber badge, no banner (boundary)', () => {
      const s = licenseSurfaces(trial(7));
      expect(s.gate).toBe('none');
      expect(s.badge).toEqual({ tone: 'amber', label: 'Trial — 7 days left' });
      expect(s.banner).toBe(false);
    });

    it('trial with 4 days: amber badge, no banner', () => {
      const s = licenseSurfaces(trial(4));
      expect(s.gate).toBe('none');
      expect(s.badge?.tone).toBe('amber');
      expect(s.banner).toBe(false);
    });

    it('trial with 3 days: red badge, banner shown (boundary)', () => {
      const s = licenseSurfaces(trial(3));
      expect(s.gate).toBe('none');
      expect(s.badge).toEqual({ tone: 'red', label: 'Trial — 3 days left' });
      expect(s.banner).toBe(true);
    });

    it('trial with 1 day: red badge with singular "day" (not "days")', () => {
      const s = licenseSurfaces(trial(1));
      expect(s.badge?.tone).toBe('red');
      expect(s.badge?.label).toMatch(/1 day left/);
      expect(s.badge?.label).not.toMatch(/1 days/);
    });

    it('trial with 0 days: red badge with "0 days left"', () => {
      const s = licenseSurfaces(trial(0));
      expect(s.badge?.tone).toBe('red');
      expect(s.badge?.label).toBe('Trial — 0 days left');
    });
  });

  describe('active', () => {
    it('active yearly with 137 days: no badge, no banner', () => {
      const s = licenseSurfaces(active('yearly', 137));
      expect(s.gate).toBe('none');
      expect(s.badge).toBeNull();
      expect(s.banner).toBe(false);
    });

    it('active monthly with 8 days: no badge (still > 7)', () => {
      const s = licenseSurfaces(active('monthly', 8));
      expect(s.badge).toBeNull();
    });

    it('active monthly with 7 days: amber badge (boundary)', () => {
      const s = licenseSurfaces(active('monthly', 7));
      expect(s.badge?.tone).toBe('amber');
      expect(s.badge?.label).toBe('Monthly — 7 days left');
    });

    it('active yearly with 5 days: amber badge with capitalized plan', () => {
      const s = licenseSurfaces(active('yearly', 5));
      expect(s.badge?.tone).toBe('amber');
      expect(s.badge?.label).toBe('Yearly — 5 days left');
    });

    it('active monthly with 1 day: amber badge with singular "day"', () => {
      const s = licenseSurfaces(active('monthly', 1));
      expect(s.badge?.label).toMatch(/1 day left/);
      expect(s.badge?.label).not.toMatch(/1 days/);
    });
  });

  describe('gracePeriod', () => {
    it('grace 1 day: nag gate, red badge, banner', () => {
      const s = licenseSurfaces(grace(1));
      expect(s.gate).toBe('nag');
      expect(s.badge).toEqual({ tone: 'red', label: 'Grace — 6 days left' });
      expect(s.banner).toBe(true);
    });

    it('grace 7 days: nag gate, red badge with "0 days left"', () => {
      const s = licenseSurfaces(grace(7));
      expect(s.gate).toBe('nag');
      expect(s.badge?.tone).toBe('red');
      // 7 days into 7-day grace = 0 days left
      expect(s.badge?.label).toBe('Grace — 0 days left');
    });

    it('grace 4 days: nag gate, red badge with "3 days left"', () => {
      const s = licenseSurfaces(grace(4));
      expect(s.badge?.label).toBe('Grace — 3 days left');
    });
  });

  describe('expired', () => {
    it('expired: HARD block, no badge, no banner', () => {
      const s = licenseSurfaces(expired());
      expect(s.gate).toBe('block');
      expect(s.badge).toBeNull();
      expect(s.banner).toBe(false);
    });
  });

  describe('invalid', () => {
    it('invalid (machine-mismatch): HARD block, no badge, no banner', () => {
      const s = licenseSurfaces(invalid('machine-mismatch'));
      expect(s.gate).toBe('block');
      expect(s.badge).toBeNull();
      expect(s.banner).toBe(false);
    });

    it('invalid (verification-failed): HARD block, no badge, no banner', () => {
      const s = licenseSurfaces(invalid('verification-failed'));
      expect(s.gate).toBe('block');
    });
  });
});
