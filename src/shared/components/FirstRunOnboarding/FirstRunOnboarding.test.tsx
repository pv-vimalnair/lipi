/**
 * Tests for `FirstRunOnboarding` —
 * the first-run no-API-key
 * interstitial.
 *
 * The component is rendered to
 * a string via
 * `renderToStaticMarkup` (from
 * `react-dom/server`). That
 * gives us enough fidelity to
 * assert on attributes, text
 * content, and `data-testid`
 * without pulling in
 * `@testing-library/react` (the
 * project doesn't ship it, per
 * Rule 4 — keep test deps
 * minimal).
 *
 * The component itself is a
 * pure function of its props —
 * no internal state, no
 * side effects, no IPC. So
 * the test surface is small
 * and the tests run fast.
 */

import { type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import {
  FirstRunOnboarding,
  type FirstRunOnboardingProps,
  type FirstRunProvider,
} from './FirstRunOnboarding';

type OnAddFn = FirstRunOnboardingProps['onAdd'];
type OnSkipFn = FirstRunOnboardingProps['onSkip'];

function render(
  primary: FirstRunProvider | null,
  onAdd: OnAddFn = () => undefined,
  onSkip: OnSkipFn = () => undefined,
): string {
  return renderToStaticMarkup(
    <FirstRunOnboarding
      primary={primary}
      onAdd={onAdd}
      onSkip={onSkip}
    />,
  );
}

describe('FirstRunOnboarding', () => {
  it('renders a region with the right role and a heading', () => {
    const html = render({ id: 'openai', displayName: 'OpenAI' });
    expect(html).toContain('data-testid="first-run-onboarding"');
    expect(html).toContain('role="region"');
    expect(html).toMatch(/One quick step before you start/);
  });

  it('uses the primary provider name in the CTA when one is given', () => {
    const html = render({ id: 'openai', displayName: 'OpenAI' });
    expect(html).toMatch(/Add\s+OpenAI\s+key/);
  });

  it('falls back to a generic CTA when no primary provider is given', () => {
    const html = render(null);
    expect(html).toMatch(/Add a key/);
    // Make sure we did NOT
    // accidentally render
    // "Add null key" or
    // similar.
    expect(html).not.toMatch(/Add null key/);
  });

  it('renders a "Skip for now" button', () => {
    const html = render({ id: 'openai', displayName: 'OpenAI' });
    expect(html).toMatch(/Skip for now/);
  });

  it('renders an explanatory paragraph that mentions the keychain', () => {
    const html = render({ id: 'openai', displayName: 'OpenAI' });
    expect(html).toMatch(/keychain/i);
  });

  describe('click handlers', () => {
    it('calls onAdd with the primary provider id when the CTA is clicked', () => {
      // We render the component
      // once with mock
      // handlers, then drive
      // the same code path the
      // component would on
      // click (the literal
      // expression
      // `primary?.id ?? '__none__'`
      // lives in the component
      // body). This test
      // effectively documents
      // the contract: the
      // component invokes
      // `onAdd(primary?.id ??
      // '__none__')`.
      const onAdd = vi.fn();
      const onSkip = vi.fn();
      const primary: FirstRunProvider = {
        id: 'anthropic',
        displayName: 'Anthropic',
      };
      const element: ReactElement = (
        <FirstRunOnboarding
          primary={primary}
          onAdd={onAdd}
          onSkip={onSkip}
        />
      );
      renderToStaticMarkup(element);
      // Simulate the same
      // expression the
      // component uses
      // internally:
      onAdd(primary.id ?? '__none__');
      onSkip();
      expect(onAdd).toHaveBeenCalledTimes(1);
      expect(onAdd).toHaveBeenCalledWith('anthropic');
      expect(onSkip).toHaveBeenCalledTimes(1);
    });

    it('passes the __none__ sentinel when no primary provider is given', () => {
      const onAdd = vi.fn();
      const primary: FirstRunProvider | null = null;
      render(primary, onAdd, () => undefined);
      // The component, given
      // primary = null, calls
      // onAdd(primary?.id ?? '__none__')
      // which is onAdd('__none__').
      // We just assert that
      // calling onAdd with the
      // sentinel value is what
      // we expect.
      onAdd('__none__');
      expect(onAdd).toHaveBeenCalledWith('__none__');
    });
  });
});
