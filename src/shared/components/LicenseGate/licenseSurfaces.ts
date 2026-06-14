/**
 * licenseSurfaces — pure mapping from a `LicenseStatusPayload`
 * to which UI surfaces should render.
 *
 * Phase 3 (subscription UX). The four surfaces that respond
 * to the license status are:
 *
 *   1. **LicenseGate** — the full-screen block + nag modal.
 *      - HARD block when `expired` or `invalid` (the user
 *        cannot access the editor; only the License
 *        activation screen is reachable).
 *      - Nag modal when `gracePeriod` (a dismissable
 *        reminder; the editor is accessible but nagged).
 *      - Hidden for all other states.
 *
 *   2. **TrialBadge** — the title-bar pill.
 *      - Hidden for `null` (hydrating), `unactivated`
 *        (no badge needed; the activation screen is the
 *        focus), `active` with > 7 days remaining (the
 *        user is in good standing; no need to nag), or
 *        `expired` / `invalid` (the gate handles them).
 *      - Red for `gracePeriod` (urgency).
 *      - Red for `trial` with ≤ 3 days remaining (urgency).
 *      - Amber for `trial` with ≤ 7 days remaining
 *        (renewal reminder) OR `active` with ≤ 7 days
 *        remaining (renewal reminder).
 *      - Neutral for `trial` with > 7 days remaining.
 *
 *   3. **ExpiryBanner** — the editor-top red banner.
 *      - Hidden for all states EXCEPT `trial` with ≤ 3
 *        days remaining (the final-week red zone) and
 *        `gracePeriod` (the post-expiry nag).
 *      - Dismissable per-session ("Got it" hides it for
 *        the rest of the session).
 *
 *   4. **TransferFlow** — the wizard on the License
 *      activation screen.
 *      - Hidden by default; rendered when the user
 *      clicks the "Transfer to a new machine" button.
 *      - (The button is on the License activation
 *        screen AND the LicenseCard in Settings.)
 *
 * The decision of which state triggers which surface is
 * captured in a single `licenseSurfaces(status)` function
 * so the test suite can pin the mapping without rendering
 * the components. The components themselves are thin
 * render-only wrappers around the result.
 *
 * ## Why a single function
 *
 * The 6 license states × 4 surfaces = 24 boolean cells.
 * Putting them in a single function (rather than
 * scattering `if (status.kind === '…')` checks across 4
 * components) means:
 *
 *   - The mapping is testable without rendering React.
 *   - The mapping is a single source of truth — no risk
 *     of one component checking `kind === 'expired'`
 *     while another checks `kind !== 'active'`.
 *   - The mapping can be documented in one place (this
 *     file's JSDoc + the design doc's "trial-generation
 *     vs paid-license state machine" table).
 *
 * ## Color tokens
 *
 * The badge / banner / gate use the same color tokens
 * as the rest of the codebase (`--color-warning-strong`
 * for amber, `--color-danger-strong` for red, etc.).
 * The `Tone` string is mapped to a CSS class name in the
 * component, NOT to a raw color (the colors live in the
 * design tokens, not in this file).
 */

import type { LicenseStatusPayload } from '@/ipc/licensing';

/**
 * Tone for the TrialBadge. The mapping:
 *   - `red` — urgency (≤ 3 days trial, grace period).
 *   - `amber` — renewal reminder (≤ 7 days trial or active).
 *   - `neutral` — informational (> 7 days trial).
 */
export type Tone = 'red' | 'amber' | 'neutral';

/**
 * What the LicenseGate should render.
 *   - `none` — no gate (the editor is fully accessible).
 *   - `nag` — dismissable nag modal at the top of the screen.
 *   - `block` — hard full-screen block (editor inaccessible).
 */
export type GateMode = 'none' | 'nag' | 'block';

/**
 * What the TrialBadge should render.
 *   - `null` — no badge.
 *   - `{ tone, label }` — render the badge with the given
 *     color and text.
 */
export type BadgeSpec = { tone: Tone; label: string } | null;

/**
 * The result of `licenseSurfaces(status)`. Components
 * destructure this and render accordingly.
 */
export interface LicenseSurfaces {
  /** What the LicenseGate should render. */
  gate: GateMode;

  /** What the TrialBadge should render (or null). */
  badge: BadgeSpec;

  /**
   * Whether the ExpiryBanner should render. The banner
   * is dismissable per-session; this is the *initial*
   * visibility (the component tracks its own dismiss
   * state).
   */
  banner: boolean;
}

/**
 * Pure: map a `LicenseStatusPayload` to the three surface
 * decisions. `null` (the hydrating state) returns all-hidden.
 *
 * The mapping is documented in the design doc's
 * "trial-generation vs paid-license state machine" table
 * (`docs/plans/prod-p3-subscription-ux-design.md`). Any
 * change to this function must be reflected in the table
 * and in the test suite.
 */
export function licenseSurfaces(
  status: LicenseStatusPayload | null,
): LicenseSurfaces {
  // Hydrating — no surfaces yet.
  if (status === null) {
    return { gate: 'none', badge: null, banner: false };
  }

  switch (status.kind) {
    case 'unactivated':
      // Only seen after an explicit `license_deactivate` call.
      // The activation screen handles the unactivated state;
      // no gate / badge / banner needed.
      return { gate: 'none', badge: null, banner: false };

    case 'trial': {
      const { daysRemaining } = status;
      if (daysRemaining <= 3) {
        return {
          gate: 'none',
          badge: { tone: 'red', label: `Trial — ${daysRemaining} day${daysRemaining === 1 ? '' : 's'} left` },
          banner: true,
        };
      }
      if (daysRemaining <= 7) {
        return {
          gate: 'none',
          badge: { tone: 'amber', label: `Trial — ${daysRemaining} days left` },
          banner: false,
        };
      }
      return {
        gate: 'none',
        badge: { tone: 'neutral', label: `Trial — ${daysRemaining} days left` },
        banner: false,
      };
    }

    case 'active': {
      const { plan, daysRemaining } = status;
      const planLabel = plan.charAt(0).toUpperCase() + plan.slice(1);
      if (daysRemaining <= 7) {
        return {
          gate: 'none',
          badge: { tone: 'amber', label: `${planLabel} — ${daysRemaining} day${daysRemaining === 1 ? '' : 's'} left` },
          banner: false,
        };
      }
      // Active with > 7 days: no badge, no banner.
      return { gate: 'none', badge: null, banner: false };
    }

    case 'gracePeriod': {
      const { daysIntoGrace } = status;
      const daysLeftInGrace = 7 - daysIntoGrace;
      return {
        gate: 'nag',
        badge: { tone: 'red', label: `Grace — ${daysLeftInGrace} day${daysLeftInGrace === 1 ? '' : 's'} left` },
        banner: true,
      };
    }

    case 'expired':
      // HARD block. No badge / banner needed; the gate
      // is the only thing the user sees.
      return { gate: 'block', badge: null, banner: false };

    case 'invalid':
      // HARD block with the reason shown. No badge / banner
      // needed; the gate is the only thing the user sees.
      return { gate: 'block', badge: null, banner: false };
  }
}
