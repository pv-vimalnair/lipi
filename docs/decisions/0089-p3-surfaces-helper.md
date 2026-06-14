# Decision #89 — Phase 3: a single pure `licenseSurfaces` helper maps `LicenseStatus` to UI surfaces

**Date**: June 2026
**Phase**: 3 of the production-readiness roadmap
**Deciders**: project lead (Vimal Nair)

## Context

Phase 3 ships 4 new UI surfaces that all respond to the
license status:

1. `LicenseGate` (full-screen block + nag modal)
2. `TrialBadge` (title-bar pill)
3. `ExpiryBanner` (editor-top red banner)
4. `TransferFlow` (wizard on the activation screen)

The naive approach is to scatter `if (status.kind ===
'expired')` checks across all 4 components. That leads to
inconsistencies (e.g. one component checks `kind !==
'active'` while another checks `kind === 'expired'`),
duplication, and untestable logic.

## Decision

A single pure function `licenseSurfaces(status)` in
`src/shared/components/LicenseGate/licenseSurfaces.ts`
maps a `LicenseStatusPayload` to the 3 surface decisions
that the components consume (gate, badge, banner). The 4
components are thin render-only wrappers around the
result.

## Consequences

- **+** Single source of truth for the state → surface
  mapping. The 6 license states × 4 surfaces = 24
  decision cells are pinned in one file.
- **+** Testable without rendering React. The helper has
  20 unit tests in
  `licenseSurfaces.test.ts` that pin every state ×
  surface cell.
- **+** Components are dumb. Each is ~50-100 lines
  (licenseSurfaces does the thinking, the component
  just renders).
- **+** Documented in one place. The design doc's
  "trial-generation vs paid-license state machine"
  table maps directly to the function's switch
  statement.
- **−** The function is the bottleneck for changes. If
  a new license state is added (e.g. a future
  `lifetime` plan), the function grows. The alternative
  would be a config object (`{ [status]: { gate, badge,
  banner } }`), but a switch is clearer for v1.

## Alternatives considered

- **Config object** (`{ [status]: { gate, badge, banner } }`).
  Cleaner for adding new states, but TypeScript's type
  inference for tagged unions is awkward (you'd need a
  `satisfies` clause + exhaustive `never` check). The
  switch is more explicit.
- **Per-component checks** (`if (status?.kind === 'expired')`).
  Simpler at first, but causes inconsistencies (we saw
  this exact bug pattern in the M2c voice-preferences
  rework — Decision #71).
- **Use a render-prop** (a `<LicenseSurfaces>` component
  that decides which child to render). More complex;
  not worth the indirection for v1.
