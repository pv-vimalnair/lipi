import type { CSSProperties, HTMLAttributes, ReactNode } from 'react';
import styles from './Stack.module.css';

export type StackDirection = 'row' | 'column';
export type StackAlign = 'start' | 'center' | 'end' | 'stretch' | 'baseline';
export type StackJustify = 'start' | 'center' | 'end' | 'between' | 'around';
export type StackGap = 0 | 1 | 2 | 3 | 4 | 6 | 8 | 12;

export interface StackProps extends HTMLAttributes<HTMLDivElement> {
  direction?: StackDirection;
  align?: StackAlign;
  justify?: StackJustify;
  gap?: StackGap;
  wrap?: boolean;
  inline?: boolean;
  as?: 'div' | 'section' | 'article' | 'header' | 'footer' | 'nav' | 'main' | 'aside';
  children: ReactNode;
}

const GAP_CLASS: Record<StackGap, string> = {
  0: 'gap-0',
  1: 'gap-1',
  2: 'gap-2',
  3: 'gap-3',
  4: 'gap-4',
  6: 'gap-6',
  8: 'gap-8',
  12: 'gap-12',
};

/**
 * Stack — the universal layout primitive. Flexbox row or column with
 * token-driven gap. This is the *only* flex container most components
 * should use; raw `display: flex` with raw pixel gaps is a code smell.
 *
 * Why: every spacing decision in the app goes through design tokens.
 * If a Stack exists, the gap is from the scale — never a hardcoded value.
 */
export function Stack({
  direction = 'column',
  align,
  justify,
  gap = 4,
  wrap = false,
  inline = false,
  as: Tag = 'div',
  className,
  style,
  children,
  ...rest
}: StackProps) {
  const classes = [
    styles.stack,
    styles[`dir-${direction}`],
    align ? styles[`align-${align}`] : '',
    justify ? styles[`justify-${justify}`] : '',
    GAP_CLASS[gap],
    wrap ? styles.wrap : '',
    inline ? styles.inline : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  const composedStyle: CSSProperties = {
    ...style,
  };

  return (
    <Tag {...rest} className={classes} style={composedStyle}>
      {children}
    </Tag>
  );
}
