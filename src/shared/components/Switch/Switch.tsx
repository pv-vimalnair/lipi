/**
 * Switch — a small binary on/off toggle for
 * settings (5b-7).
 *
 * Built fresh in 5b-7 because no Switch
 * component existed in the shared library
 * (the existing toggles are all Button-based
 * — a Switch is the right primitive for a
 * "this thing is enabled / disabled" affordance
 * because it has a stable visual state, supports
 * keyboard, and is the canonical ARIA
 * `role="switch"` pattern).
 *
 * Modeled after a native `<input type="checkbox">`
 * but with a custom thumb that slides. The
 * checked state is a controlled `checked` prop;
 * changes are reported via `onChange(checked)`.
 *
 * Accessibility:
 *   - `role="switch"` and `aria-checked` on
 *     the clickable element (per WAI-ARIA).
 *   - Space and Enter both toggle (Space is
 *     the canonical keyboard shortcut for
 *     `role="switch"`; Enter is the canonical
 *     shortcut for `role="button"` — we accept
 *     both for muscle-memory).
 *   - `aria-label` is required: the switch
 *     has no visible text, so the caller MUST
 *     describe what the switch controls.
 *   - `aria-disabled` mirrors the `disabled`
 *     prop. A disabled switch is not focusable
 *     and doesn't fire onChange.
 *
 * Visual:
 *   - Track colour uses `--color-accent` when
 *     checked, `--color-bg-active` when unchecked.
 *   - Thumb is a small white-ish circle that
 *     slides between left (off) and right (on).
 *   - Animation duration: `--motion-base` (200ms)
 *     with `--easing-standard`.
 *
 * Rule 4 (per ENGINEERING.md): all colours /
 * spacing / radii come from the design tokens
 * in `src/shared/styles/tokens.css`. No raw
 * hex. No hardcoded dimensions outside the
 * token scale.
 */
import { useCallback, type KeyboardEvent } from 'react';
import styles from './Switch.module.css';

export interface SwitchProps {
  /** Whether the switch is in the "on" position. */
  checked: boolean;
  /** Fires when the user toggles. Not called when
   *  `disabled` is true. */
  onChange: (checked: boolean) => void;
  /**
   * Required accessible label. The switch has
   * no visible text, so the caller MUST describe
   * what it controls (e.g. "Enable file reading
   * tool" for the `get_file_contents` toggle).
   */
  'aria-label': string;
  /** When true, the switch is non-interactive
   *  and visually muted. */
  disabled?: boolean;
  /** Optional id for labelling / focus management. */
  id?: string;
}

export function Switch({
  checked,
  onChange,
  disabled,
  id,
  ...rest
}: SwitchProps) {
  const onClick = useCallback(() => {
    if (disabled) return;
    onChange(!checked);
  }, [checked, disabled, onChange]);

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLButtonElement>) => {
      if (disabled) return;
      // Space is the canonical `role="switch"`
      // shortcut. Enter is also accepted (some
      // users have Space bound to scroll in
      // specific contexts; some screen-reader
      // muscle memory defaults to Enter).
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        onChange(!checked);
      }
    },
    [checked, disabled, onChange],
  );

  return (
    <button
      type="button"
      role="switch"
      id={id}
      aria-checked={checked}
      aria-disabled={disabled || undefined}
      aria-label={rest['aria-label']}
      disabled={disabled}
      data-checked={checked || undefined}
      data-disabled={disabled || undefined}
      className={styles.switch}
      onClick={onClick}
      onKeyDown={onKeyDown}
    >
      <span className={styles.thumb} aria-hidden="true" />
    </button>
  );
}
