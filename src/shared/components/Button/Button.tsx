import type { ButtonHTMLAttributes, ReactNode } from 'react';
import styles from './Button.module.css';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  fullWidth?: boolean;
  children: ReactNode;
}

/**
 * Canonical button primitive. Every interactive button in the app goes
 * through this — never a raw `<button>` in a screen or component.
 *
 * Use `variant` for visual weight, never add new colors inline.
 * Use `loading` to indicate async work; the button stays focusable but
 * is non-interactive and shows the spinner.
 */
export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  fullWidth = false,
  disabled,
  children,
  className,
  ...rest
}: ButtonProps) {
  const classes = [
    styles.button,
    styles[variant],
    styles[size],
    fullWidth ? styles.fullWidth : '',
    loading ? styles.loading : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      {...rest}
      className={classes}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
    >
      {loading && (
        <span className={styles.spinner} aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
      )}
      <span className={loading ? styles.contentLoading : styles.content}>{children}</span>
    </button>
  );
}
