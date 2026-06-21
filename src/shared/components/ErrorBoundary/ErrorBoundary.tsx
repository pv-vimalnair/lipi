import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from '../Button';
import { logger } from '@/shared/logger';
import styles from './ErrorBoundary.module.css';

export interface ErrorBoundaryProps {
  /** Child components to wrap. */
  children: ReactNode;
  /**
   * Optional fallback renderer. Receives the error and a `reset` callback
   * that clears the boundary state and re-mounts the children. If omitted,
   * a default "Something went wrong" UI is rendered.
   */
  fallback?: (error: Error, reset: () => void) => ReactNode;
  /**
   * Optional name for the boundary, shown in the default fallback UI
   * and logged to the console. Useful for identifying which pane crashed.
   */
  name?: string;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Catches render errors in its subtree and shows a recoverable fallback
 * instead of crashing the entire application to a white screen.
 *
 * Mount at two levels:
 * 1. **Root** — in `main.tsx`, wrapping `<ScreenRoot />` so a crash in
 *    any screen doesn't take down the whole app.
 * 2. **Pane** — in `EditorWorkspace.tsx`, wrapping each IDE pane
 *    (Editor, AI, FileTree, Terminal) so a crash in one pane doesn't
 *    take down the others.
 *
 * The boundary state can be cleared via the `reset` callback (exposed
 * in the fallback UI), which causes React to re-mount the children.
 */
export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  override state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    const label = this.props.name ?? 'ErrorBoundary';
    logger.error(`[${label}] caught render error:`, error, info.componentStack);
  }

  private reset = (): void => {
    this.setState({ error: null });
  };

  override render(): ReactNode {
    const { error } = this.state;
    if (error) {
      if (this.props.fallback) {
        return this.props.fallback(error, this.reset);
      }
      return (
        <div
          className={styles.root}
          role="alert"
          aria-live="assertive"
        >
          <div className={styles.content}>
            <div className={styles.icon} aria-hidden="true">
              <svg
                viewBox="0 0 24 24"
                width="32"
                height="32"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            </div>
            <h2 className={styles.title}>Something went wrong</h2>
            {this.props.name && (
              <p className={styles.subtitle}>{this.props.name}</p>
            )}
            <pre className={styles.message}>{error.message}</pre>
            <div className={styles.actions}>
              <Button
                variant="primary"
                size="sm"
                onClick={this.reset}
              >
                Try again
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => window.location.reload()}
              >
                Reload app
              </Button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
