# Decision #90 — Phase 3: trial badge tone thresholds (red ≤ 3, amber ≤ 7, neutral > 7)

**Date**: June 2026
**Phase**: 3 of the production-readiness roadmap
**Deciders**: project lead (Vimal Nair)

## Context

The trial badge in the title bar needs to convey urgency
without being annoying. We picked 3 tones (red, amber,
neutral) and need thresholds for when to switch.

The trial is 14 days; the grace period is 7 days; the
banner appears in the last 3 days.

## Decision

- **Days remaining > 7**: neutral (e.g. "Trial — 12 days
  left"). The user is well within the trial; the badge
  is informational, not a nag.
- **Days remaining ≤ 7 AND > 3**: amber (e.g. "Trial —
  5 days left"). The user is approaching expiry; the
  badge is a renewal reminder.
- **Days remaining ≤ 3**: red (e.g. "Trial — 2 days
  left"). The final-week red zone; the badge and the
  banner both appear.
- **Grace period**: red (e.g. "Grace — 5 days left").
  The user is past `exp`; the badge is a nag and the
  gate's nag modal is also visible.
- **Active, days remaining > 7**: no badge. The user
  is in good standing; no need to nag.
- **Active, days remaining ≤ 7**: amber (e.g.
  "Monthly — 5 days left"). Renewal reminder.
- **Expired / Invalid**: no badge (the gate handles
  these — the badge would be redundant).

## Consequences

- **+** The thresholds are documented in one place
  (`licenseSurfaces.ts`) and the design doc's
  "trial-generation vs paid-license state machine"
  table maps directly to the code.
- **+** The 7-day threshold (amber) matches the
  "renewal reminder" pattern from the existing
  LicenseCard design. The 3-day threshold (red) is
  the same as the existing "expiry banner"
  trigger. No new design surface, just a
  consolidation.
- **−** The thresholds are hardcoded. A future
  project-lead setting ("turn off the red badge
  for 1 day") would require either a feature
  flag or moving the thresholds into the
  `useLicenseStore`. Phase 3 doesn't add a
  setting.
- **−** "Days remaining" is calculated as
  `floor((exp - now) / 86400)`, which means a
  license that expires "tomorrow at 3am" shows
  "Trial — 1 day left" at midnight the previous
  night. Some users find this jarring ("I still
  have 27 hours!"). A future phase could add
  sub-day granularity (e.g. "1 day, 3 hours
  left") if user feedback warrants it.

## Alternatives considered

- **Single threshold (red after 7 days, no amber)**.
  Simpler, but loses the "gentle reminder" feel.
  Users on day 10 shouldn't see a red badge; that's
  aggressive.
- **No badge until day 7**. Less nag-y, but
  users who install on day 1 have no idea the
  trial is even running. The neutral badge
  ("Trial — 12 days left") is a "we're tracking
  this for you" signal.
- **Hours-remaining display** (e.g. "Trial —
  5 days, 3 hours left"). More precise, but
  the badge is too narrow to fit that text
  without truncation. Stick with days.

## References

- `docs/plans/prod-p3-subscription-ux-design.md`
  — the design doc's state-machine table.
- `src/shared/components/LicenseGate/licenseSurfaces.ts`
  — the implementation.
- `src/shared/components/LicenseGate/licenseSurfaces.test.ts`
  — 20 unit tests pinning every cell.
