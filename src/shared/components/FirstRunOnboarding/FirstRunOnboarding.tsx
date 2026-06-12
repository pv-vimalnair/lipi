/**
 * FirstRunOnboarding — a one-time
 * interstitial that nudges the user
 * to add an API key.
 *
 * Why this exists:
 *   The Welcome screen's hero is
 *   "open a folder", but Lipi
 *   without an API key can't
 *   actually do anything useful
 *   with that folder. New users
 *   hit the chat panel, send a
 *   message, and get a generic
 *   "Invalid API key" error
 *   (handled by AIPanel's
 *   `errorMessages`). The right
 *   shape is to intercept them
 *   BEFORE the first failed chat
 *   attempt: a single, friendly
 *   panel that says "add a key
 *   and you're set".
 *
 * Visibility contract:
 *   The component renders nothing
 *   when the conditions for
 *   showing it are not met.
 *   Specifically: the parent
 *   (AppRoot) is responsible for
 *   passing `dismissed: false`
 *   AND `configuredProviders`
 *   being empty. The component
 *   itself is dumb about both:
 *   it doesn't call the keychain
 *   IPC, it doesn't read the
 *   firstRun store. This is so
 *   the component is trivially
 *   testable in isolation.
 *
 *   `dismissed` and the two
 *   click handlers (`onAdd`,
 *   `onSkip`) are owner-controlled.
 *   The component just renders
 *   the panel and reports the
 *   intent.
 *
 * Behaviour:
 *   - "Add a key" CTA: calls
 *     `onAdd(providerId)`. The
 *     parent typically dismisses
 *     AND routes to Settings in
 *     the same handler. We don't
 *     dismiss here so the parent
 *     can decide (e.g. on
 *     "reopened via command
 *     palette", don't auto-dismiss).
 *   - "Skip for now" link: calls
 *     `onSkip()`. Parent persists
 *     `dismissed: true`.
 *
 * A11y:
 *   - Uses `role="region"` with
 *     `aria-labelledby` (the
 *     heading).
 *   - The skip link is a real
 *     `<button>` (not a styled
 *     `<a>`) so it lands in the
 *     tab order and announces
 *     as a button.
 *   - The CTA's shortcut hint
 *     (`Cmd/Ctrl + ,`) is the
 *     conventional "open
 *     Settings" mnemonic on
 *     most platforms.
 */

import { useId } from 'react';

import { Button } from '@/shared/components/Button/Button';
import { Stack } from '@/shared/components/Stack/Stack';

import styles from './FirstRunOnboarding.module.css';

export interface FirstRunProvider {
  /** Stable id (e.g. "openai").
   *  Used as the click-handler
   *  argument so the parent can
   *  route to the right Settings
   *  card if it wants to. */
  id: string;
  /** Human-readable name shown
   *  on the CTA. */
  displayName: string;
}

export interface FirstRunOnboardingProps {
  /**
   * The recommended first provider.
   * Typically OpenAI (the most
   * common), but the parent
   * decides based on the order
   * returned by `aiListProviders()`.
   * If `providers` is empty
   * (shouldn't happen in
   * production — the Rust side
   * always returns at least
   * one), the CTA falls back to
   * a generic "Add a key" label.
   */
  primary: FirstRunProvider | null;
  /**
   * Called when the user clicks
   * the primary CTA. The parent
   * should:
   *   1. Route to Settings
   *      (`useAppStore.setActiveScreen('settings')`)
   *   2. Persist `dismissed: true`
   *      via the firstRun store
   *      (so we don't show the
   *      panel again after they
   *      add the key).
   */
  onAdd: (providerId: string | null) => void;
  /**
   * Called when the user clicks
   * "Skip for now". The parent
   * persists `dismissed: true`.
   * The user can re-open the
   * panel any time via the
   * command palette ("Reopen
   * first-run setup").
   */
  onSkip: () => void;
}

export function FirstRunOnboarding({
  primary,
  onAdd,
  onSkip,
}: FirstRunOnboardingProps): JSX.Element {
  const titleId = useId();
  // The default id when the
  // primary provider is null
  // is a sentinel — the
  // parent's `onAdd` handler
  // can branch on it (e.g.
  // "no providers, just open
  // Settings" vs "open Settings
  // and scroll to the openai
  // card"). Kept as a literal
  // string (not undefined) so
  // the prop type stays
  // concrete.
  const PRIMARY_NONE = '__none__';

  return (
    <section
      className={styles.root}
      role="region"
      aria-labelledby={titleId}
      data-testid="first-run-onboarding"
    >
      <Stack direction="column" gap={3} className={styles.body}>
        <h2 id={titleId} className={styles.title}>
          One quick step before you start
        </h2>
        <p className={styles.message}>
          Lipi calls an AI provider on your behalf. Pick a provider, paste
          your key into Settings, and it gets stored in your operating
          system keychain — never on a Lipi server, never in the app
          itself.
        </p>
        <Stack
          direction="row"
          gap={3}
          align="center"
          inline
          className={styles.actions}
        >
          <Button
            variant="primary"
            size="md"
            onClick={() => {
              onAdd(primary?.id ?? PRIMARY_NONE);
            }}
            // The shortcut hint is
            // purely informational —
            // the global Cmd+, binding
            // is in SettingsProvider /
            // the OS, not here. We
            // surface it so the user
            // sees the convention.
            title="Open Settings"
          >
            {primary
              ? `Add ${primary.displayName} key`
              : 'Add a key'}
          </Button>
          <Button
            variant="ghost"
            size="md"
            onClick={onSkip}
            aria-label="Skip first-run setup"
          >
            Skip for now
          </Button>
        </Stack>
      </Stack>
    </section>
  );
}
