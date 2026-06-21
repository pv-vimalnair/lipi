/**
 * OnboardingTour — the K-phase
 * in-app tour overlay.
 *
 * Renders a coach-mark callout
 * (a dimmer + a small panel) on
 * top of whichever screen is
 * active. The tour walks the
 * user through a 6-step linear
 * sequence: welcome → file tree
 * → side panel → voice → command
 * palette → outro.
 *
 * Architecture:
 *   - The store (`tourStore`) is
 *     a dumb step machine. It
 *     doesn't know what the
 *     steps are, just how to
 *     advance / retreat the
 *     cursor. Adding a new step
 *     is a one-entry change to
 *     `tourSteps.ts`.
 *   - The step list
 *     (`TOUR_STEPS`) is the
 *     declarative source of
 *     truth for order, copy,
 *     and anchor selectors.
 *   - The pure placement math
 *     (`placement.ts`) decides
 *     where to render the
 *     callout given an anchor's
 *     bounding rect and the
 *     viewport. The component
 *     reads the rect and the
 *     viewport and passes them
 *     to the placement helpers.
 *   - This component is the
 *     glue: it reads the store,
 *     reads the anchor rect,
 *     calls the placement
 *     helpers, and renders the
 *     callout.
 *
 * Auto-start:
 *   Mounted at the AppRoot
 *   level. Calls `start()` on
 *   first render IF the
 *   `computeTourShouldAutoStart`
 *   gate returns true. The
 *   "Restart onboarding tour"
 *   command palette entry
 *   also calls `start()`.
 *
 * Non-goals (v1):
 *   - Animations (callouts
 *     appear / disappear
 *     instantly).
 *   - A separate mobile step
 *     list. The v1 tour is
 *     desktop-only; on mobile
 *     the gate is satisfied but
 *     the anchors are replaced
 *     by the MobileShell tab
 *     bar, so the callouts
 *     point at non-existent
 *     nodes. A future K
 *     iteration can gate by
 *     viewport or build a
 *     parallel mobile list.
 *     For now, the tour
 *     gracefully degrades: the
 *     centered steps still
 *     show, the anchored steps
 *     fall back to center.
 *
 * Testing:
 *   The store, the step list,
 *   and the placement helpers
 *   are tested in isolation
 *   (this project doesn't ship
 *   `@testing-library/react`).
 *   The component itself is
 *   small enough that the
 *   manual test plan in
 *   CHANGELOG "K — known
 *   limitations" is sufficient.
 */

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';

import { Button } from '@/shared/components/Button';
import { KeyHint } from '@/shared/components/KeyHint';
import { Stack } from '@/shared/components/Stack';
import {
  useWorkspaceStore,
  workspaceSelectors,
} from '@/shared/state/workspaceStore';
import {
  computeTourShouldAutoStart,
  readWorkspaceGateFields,
  TOUR_STEPS,
  type TourStep,
} from './tourSteps';
import {
  useTourStore,
  tourSelectors,
} from '@/shared/state/tourStore';
import {
  type CalloutLayout,
  type Rect,
  type Viewport,
  computeAnchoredLayout,
  computeCenterLayout,
} from './placement';
import { computeCalloutSize } from './calloutSize';

import styles from './OnboardingTour.module.css';

/** The tour overlay. Mounted
 *  once at the AppRoot level
 *  (alongside `CommandPaletteModal`
 *  and `AboutModal`). Renders
 *  nothing when no step is
 *  active. */
export function OnboardingTour(): JSX.Element | null {
  const hydrated = useTourStore(tourSelectors.hydrated);
  const dismissed = useTourStore(tourSelectors.dismissed);
  const currentStep = useTourStore(tourSelectors.currentStep);

  const workspaceHydrated = useWorkspaceStore(
    workspaceSelectors.hydrated,
  );
  const currentPath = useWorkspaceStore(
    workspaceSelectors.currentPath,
  );

  // The auto-start effect
  // fires once after both
  // stores have hydrated.
  // The gate is computed from
  // the live store values, not
  // from a snapshot, so the
  // effect re-runs when the
  // values change (defensive
  // — the user closing the
  // workspace mid-tour
  // shouldn't leave the tour
  // stuck in the middle of a
  // step).
  useEffect(() => {
    if (!hydrated || !workspaceHydrated) return;
    const shouldStart = computeTourShouldAutoStart({
      tourHydrated: hydrated,
      tourDismissed: dismissed,
      ...readWorkspaceGateFields({
        hydrated: workspaceHydrated,
        currentPath,
      }),
    });
    if (shouldStart) {
      useTourStore.getState().start();
    }
    // We deliberately omit
    // `dismissed` from the deps:
    // the gate changes when the
    // user toggles it via the
    // command palette, but we
    // only want to auto-start
    // ONCE per launch (subsequent
    // toggles are user-initiated
    // and go through `start()`
    // directly, not through this
    // effect).
    // Intentional deps: only run once per launch.
  }, [hydrated, workspaceHydrated, currentPath]);

  // If the user closes the
  // workspace mid-tour, finish
  // the tour automatically.
  // The user can re-open via
  // "Restart onboarding tour"
  // (the command palette is
  // reachable from Welcome
  // too, just slower).
  useEffect(() => {
    if (currentStep !== null && currentPath === null) {
      useTourStore.getState().finish();
    }
  }, [currentStep, currentPath]);

  // Read the current step's
  // anchor rect. We poll on
  // resize + scroll because
  // the user might pan the
  // editor / file tree while
  // the tour is showing.
  const step: TourStep | null =
    currentStep !== null ? TOUR_STEPS[currentStep] ?? null : null;
  const { rect, viewport } = useAnchorRect(step);

  // The callout layout is
  // computed from the rect +
  // viewport. A null step
  // returns the centered
  // layout (which is unused
  // since the component
  // returns null below, but
  // keeps the type checker
  // happy).
  const layout: CalloutLayout | null = useMemo(() => {
    if (step === null) return null;
    const calloutSize = computeCalloutSize(step);
    if (step.placement.kind === 'center' || rect === null) {
      return computeCenterLayout(viewport, calloutSize);
    }
    return computeAnchoredLayout(
      rect,
      step.placement,
      viewport,
      calloutSize,
    );
  }, [step, rect, viewport]);

  // ESC + arrow-key handlers.
  // Bound at the document
  // level so the tour is
  // dismissible regardless
  // of focus.
  useEffect(() => {
    if (currentStep === null) return;
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        useTourStore.getState().finish();
      } else if (e.key === 'ArrowRight' || e.key === 'Enter') {
        // Only intercept when the
        // focus is NOT inside an
        // input / textarea (the
        // user might be typing in
        // the command palette
        // search box, and we don't
        // want to advance the
        // tour on every Enter).
        const target = e.target as HTMLElement | null;
        if (
          target &&
          (target.tagName === 'INPUT' ||
            target.tagName === 'TEXTAREA' ||
            target.isContentEditable)
        ) {
          return;
        }
        e.preventDefault();
        handleNext();
      } else if (e.key === 'ArrowLeft') {
        const target = e.target as HTMLElement | null;
        if (
          target &&
          (target.tagName === 'INPUT' ||
            target.tagName === 'TEXTAREA' ||
            target.isContentEditable)
        ) {
          return;
        }
        e.preventDefault();
        useTourStore.getState().prev();
      }
    };
    document.addEventListener('keydown', handler);
    return () => {
      document.removeEventListener('keydown', handler);
    };
    // Intentional deps: only `currentStep`.
  }, [currentStep]);

  const handleNext = useCallback((): void => {
    if (currentStep === null) return;
    if (currentStep >= TOUR_STEPS.length - 1) {
      useTourStore.getState().finish();
      return;
    }
    useTourStore.getState().next();
  }, [currentStep]);

  const handlePrev = useCallback((): void => {
    useTourStore.getState().prev();
  }, []);

  const handleSkip = useCallback((): void => {
    useTourStore.getState().finish();
  }, []);

  if (currentStep === null || step === null || layout === null) {
    return null;
  }

  const isFirst = currentStep === 0;
  const isLast = currentStep === TOUR_STEPS.length - 1;
  const titleId = useId();

  return (
    <div
      className={styles.backdrop}
      data-testid="onboarding-tour"
      data-step-id={step.id}
      data-step-index={currentStep}
      onClick={(e) => {
        // Backdrop click dismisses
        // the tour. Clicks INSIDE
        // the callout are stopped
        // by the callout's own
        // onClick (e.stopPropagation).
        if (e.target === e.currentTarget) {
          handleSkip();
        }
      }}
    >
      <div
        className={styles.callout}
        data-side={layout.side}
        data-flipped={layout.flipped}
        data-step-id={step.id}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        style={{
          top: `${layout.top}px`,
          left: `${layout.left}px`,
          width: `${layout.width}px`,
          minHeight: `${layout.height}px`,
        }}
        onClick={(e) => {
          e.stopPropagation();
        }}
      >
        <Stack
          direction="column"
          gap={3}
          className={styles.body}
        >
          <header className={styles.header}>
            <span className={styles.stepCounter}>
              Step {currentStep + 1} of {TOUR_STEPS.length}
            </span>
            <h2 id={titleId} className={styles.title}>
              {step.title}
            </h2>
          </header>
          <p className={styles.body2}>{step.body}</p>
          <Stack
            direction="row"
            gap={2}
            align="center"
            inline
            className={styles.actions}
          >
            <Button
              variant="ghost"
              size="sm"
              onClick={handlePrev}
              disabled={isFirst}
              aria-label="Previous step"
            >
              Back
            </Button>
            <div className={styles.spacer} />
            <Button
              variant="ghost"
              size="sm"
              onClick={handleSkip}
              aria-label="Skip the tour"
            >
              Skip
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={handleNext}
              aria-label={isLast ? 'Finish the tour' : 'Next step'}
            >
              {isLast ? 'Finish' : 'Next'}
            </Button>
          </Stack>
          <div className={styles.keyHint}>
            <KeyHint label="Esc" />
            <span className={styles.keyHintLabel}>
              to dismiss
            </span>
            <span className={styles.keyHintSeparator}>·</span>
            <KeyHint label="←" />
            <KeyHint label="→" />
            <span className={styles.keyHintLabel}>
              to step
            </span>
          </div>
        </Stack>
      </div>
    </div>
  );
}

/** Subscribe to the current
 *  step's anchor rect + the
 *  viewport. Re-runs on
 *  scroll, resize, and step
 *  change. Returns
 *  `{ rect: null, viewport }`
 *  when the step is centered
 *  or the anchor doesn't
 *  exist in the DOM (the
 *  placement math falls back
 *  to centered in that case).
 */
function useAnchorRect(
  step: TourStep | null,
): { rect: Rect | null; viewport: Viewport } {
  const [rect, setRect] = useState<Rect | null>(null);
  const [viewport, setViewport] = useState<Viewport>(() => {
    return {
      width: typeof window !== 'undefined' ? window.innerWidth : 1024,
      height: typeof window !== 'undefined' ? window.innerHeight : 768,
    };
  });

  // Track scroll / resize so
  // the callout follows the
  // anchor if the user pans
  // the editor.
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const target =
      step?.placement.kind === 'anchored'
        ? document.querySelector<HTMLElement>(
            `[data-tour-target="${step.placement.target}"]`,
          )
        : null;

    const measure = (): void => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }
      rafRef.current = requestAnimationFrame(() => {
        setViewport({
          width: window.innerWidth,
          height: window.innerHeight,
        });
        if (target) {
          const r = target.getBoundingClientRect();
          setRect({
            top: r.top,
            left: r.left,
            width: r.width,
            height: r.height,
          });
        } else {
          setRect(null);
        }
      });
    };

    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [step]);

  return { rect, viewport };
}
