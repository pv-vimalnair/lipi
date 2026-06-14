# Decision #91 — Phase 3: grace period uses a nag modal, not a hard block

**Date**: June 2026
**Phase**: 3 of the production-readiness roadmap
**Deciders**: project lead (Vimal Nair)

## Context

After a license's `exp` timestamp, the user has 7 days
of "grace period" (Phase 2 §6.3 of the design doc).
The grace period is meant to handle clock skew, brief
network-less periods, and "I forgot to renew" scenarios.

The question: should the grace period be a nag
(dismissable modal) or a hard block (full-screen,
can't dismiss)?

## Decision

The grace period is a **dismissable nag modal** at the
top of the screen, NOT a hard block. The user can still
use the editor, see their files, and continue working.
The nag is dismissable per-session ("I'll do it later"
button hides it until next app launch).

The hard block (`LicenseGate` mode = `'block'`) is
reserved for `expired` (past grace) and `invalid`
(tampered / mismatched) statuses.

## Consequences

- **+** Users who genuinely forgot to renew can still
  work for up to 7 days while they sort out a new
  license. This is the "I had a long weekend" scenario
  the grace period was designed for.
- **+** The nag is hard to ignore (it sits at the top
  of the screen with a left-border red marker) but
  not blocking. The user can dismiss it for the
  session, which respects their time.
- **+** The dismissal state is in `sessionStorage`
  (not `localStorage`), so the nag reappears on
  the next app launch. A user who dismisses the nag
  on Friday sees it again on Monday.
- **−** A user who dismisses the nag every session
  effectively has unlimited grace period. The
  mitigation is the hard block at day 7 of grace —
  even if they keep dismissing, day 14 of grace
  (which is `expired` in the state machine) is a
  hard block.
- **−** Some users might interpret the nag as
  "this is just an ad, ignore it". The nag's
  copy ("Your license has expired. You have 5
  grace days left. Activate now →") is
  unambiguous; the design doc has the wording
  locked.

## Alternatives considered

- **Hard block for grace period**. Stronger, but
  punishes the user for clock skew or
  momentary forgetfulness. We picked the nag
  because the 7-day grace is *designed* to
  handle these cases.
- **No nag at all during grace period**. Lighter
  touch, but the user might not realize their
  license is expiring. The nag is a "we
  noticed, here's the fix" signal.
- **Email reminders during grace period**. We
  don't have a backend ("no backend, ever"
  rule, Decision #17) and the user's email
  isn't part of the offline-licensing flow.
  A future phase could add an "email me
  before I expire" setting, but Phase 3
  doesn't.

## References

- `docs/plans/prod-p2-licensing-design.md §6.3`
  — the original grace-period design.
- `docs/plans/prod-p3-subscription-ux-design.md`
  — the state-machine table.
- `src/shared/components/LicenseGate/LicenseGate.tsx`
  — the gate implementation.
- `src/shared/components/LicenseGate/LicenseGate.test.tsx`
  — 9 unit tests pinning the gate's behavior.
