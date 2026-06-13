/**
 * Barrel for the OnboardingTour
 * component. Per Rule 3
 * (screen-folder layout), the
 * component lives in
 * `src/shared/components/OnboardingTour/`
 * and is re-exported through
 * `src/shared/components/index.ts`.
 *
 * The internal helpers
 * (`placement.ts`, `calloutSize.ts`,
 * `tourSteps.ts`) are NOT
 * re-exported here — they're
 * implementation details of
 * the OnboardingTour component
 * and are not consumed outside
 * this folder.
 */
export { OnboardingTour } from './OnboardingTour';
