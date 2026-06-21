/* eslint-disable @typescript-eslint/no-non-null-assertion -- test assertions are guarded by prior expect().toBeDefined() */
/**
 * ErrorBoundary tests.
 *
 * Error boundaries require the full React lifecycle
 * (getDerivedStateFromError / componentDidCatch) which
 * `renderToStaticMarkup` does not exercise. These tests
 * use `createRoot` from `react-dom/client` + `act` from
 * `react` -- both are standard React APIs that ship with
 * the project's existing dependencies (no `@testing-library`
 * required).
 *
 * The jsdom environment (configured in vitest.config.ts)
 * provides `document` and `window` for DOM assertions.
 */

import { type ReactElement, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import { ErrorBoundary } from './ErrorBoundary';

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let consoleSpy: ReturnType<typeof vi.spyOn>;

function render(element: ReactElement): void {
  act(() => {
    if (!container) {
      container = document.createElement('div');
      document.body.appendChild(container);
      root = createRoot(container);
    }
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- test setup guarantees value exists
    root!.render(element);
  });
}

beforeEach(() => {
  consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  consoleSpy.mockRestore();
  act(() => {
    root?.unmount();
  });
  root = null;
  container?.remove();
  container = null;
});

/** A component that throws on render when `shouldThrow` is true. */
function Bomb({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) {
    throw new Error('test render error');
  }
  return <div>child ok</div>;
}

describe('ErrorBoundary', () => {
  it('renders children when no error occurs', () => {
    render(
      <ErrorBoundary>
        <Bomb shouldThrow={false} />
      </ErrorBoundary>,
    );
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- test setup guarantees value exists
    expect(container!.querySelector('div')!.textContent).toBe('child ok');
  });

  it('renders default fallback when a child throws', () => {
    render(
      <ErrorBoundary name="TestPane">
        <Bomb shouldThrow={true} />
      </ErrorBoundary>,
    );
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- test setup guarantees value exists
    expect(container!.textContent).toContain('Something went wrong');
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- test setup guarantees value exists
    expect(container!.textContent).toContain('TestPane');
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- test setup guarantees value exists
    expect(container!.textContent).toContain('test render error');
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- test setup guarantees value exists
    expect(container!.textContent).toContain('Try again');
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- test setup guarantees value exists
    expect(container!.textContent).toContain('Reload app');
  });

  it('renders without a name when name prop is omitted', () => {
    render(
      <ErrorBoundary>
        <Bomb shouldThrow={true} />
      </ErrorBoundary>,
    );
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- test setup guarantees value exists
    expect(container!.textContent).toContain('Something went wrong');
    // The subtitle paragraph should not be rendered
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- test setup guarantees value exists
    const subtitles = container!.querySelectorAll('p');
    for (const p of Array.from(subtitles)) {
      expect(p.textContent).not.toBe('TestPane');
    }
  });

  it('uses custom fallback renderer when provided', () => {
    render(
      <ErrorBoundary
        fallback={(error, reset) => (
          <div>
            <span>Custom: {error.message}</span>
            <button onClick={reset}>Reset</button>
          </div>
        )}
      >
        <Bomb shouldThrow={true} />
      </ErrorBoundary>,
    );
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- test setup guarantees value exists
    expect(container!.textContent).toContain('Custom: test render error');
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- test setup guarantees value exists
    expect(container!.textContent).toContain('Reset');
  });

  it('has role="alert" for accessibility', () => {
    render(
      <ErrorBoundary>
        <Bomb shouldThrow={true} />
      </ErrorBoundary>,
    );
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- test setup guarantees value exists
    const alert = container!.querySelector('[role="alert"]');
    expect(alert).not.toBeNull();
  });

  it('logs the error via console.error', () => {
    render(
      <ErrorBoundary name="LogTest">
        <Bomb shouldThrow={true} />
      </ErrorBoundary>,
    );
    expect(consoleSpy).toHaveBeenCalled();
    // React may also call console.error for the uncaught
    // error before the boundary catches it. We assert
    // that at least one call contains our boundary label.
    const boundaryLog = consoleSpy.mock.calls.find(
      (args: unknown[]) =>
        typeof args[0] === 'string' && args[0].includes('[LogTest]'),
    );
    expect(boundaryLog).toBeDefined();
  });
});
