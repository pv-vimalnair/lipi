import type { ButtonHTMLAttributes, ReactNode } from 'react';
import styles from './IconButton.module.css';

export type IconButtonVariant = 'default' | 'subtle' | 'danger';
export type IconButtonSize = 'sm' | 'md' | 'lg';

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Required for accessibility — every icon button must announce itself. */
  'aria-label': string;
  variant?: IconButtonVariant;
  size?: IconButtonSize;
  active?: boolean;
  children: ReactNode;
}

/**
 * Square, icon-only button. For toolbars, table rows, and any other place
 * a button needs to be a fixed-size square with an icon centered.
 *
 * `aria-label` is required because an icon alone is not an accessible name.
 */
export function IconButton({
  variant = 'default',
  size = 'md',
  active = false,
  children,
  className,
  ...rest
}: IconButtonProps) {
  const classes = [
    styles.button,
    styles[variant],
    styles[size],
    active ? styles.active : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button {...rest} className={classes} type={rest.type ?? 'button'}>
      {children}
    </button>
  );
}
