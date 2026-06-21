/**
 * Tests for `PricingCard`. The card renders the
 * three pricing tiers (trial, monthly, yearly) and
 * the "Subscribe" links open in the system browser
 * (we test the `ctaHref` directly via the `title`
 * attribute, which is set to the URL for the
 * monthly / yearly tiers; the trial tier has a
 * disabled button and no link).
 */
import { describe, expect, it } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { PRICING_TIERS } from './pricing';
import { PricingCard } from './PricingCard';

function mount(): { container: HTMLDivElement; root: Root; cleanup: () => void } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(createElement(PricingCard));
  });
  return {
    container,
    root,
    cleanup: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

describe('PRICING_TIERS (data)', () => {
  it('has three tiers in trial â†’ monthly â†’ yearly order', () => {
    expect(PRICING_TIERS.map((t) => t.id)).toEqual(['trial', 'monthly', 'yearly']);
  });

  it('trial tier has a null ctaHref (auto-generated, no link)', () => {
    const trial = PRICING_TIERS.find((t) => t.id === 'trial');
    expect(trial?.ctaHref).toBeNull();
  });

  it('monthly tier has the correct price label and href', () => {
    const monthly = PRICING_TIERS.find((t) => t.id === 'monthly');
    expect(monthly?.priceLabel).toBe('$5');
    expect(monthly?.durationLabel).toBe('per month');
    expect(monthly?.ctaHref).toContain('plan=monthly');
  });

  it('yearly tier has the correct price label and href', () => {
    const yearly = PRICING_TIERS.find((t) => t.id === 'yearly');
    expect(yearly?.priceLabel).toBe('$50');
    expect(yearly?.durationLabel).toBe('per year');
    expect(yearly?.ctaHref).toContain('plan=yearly');
  });
});

describe('PricingCard (component)', () => {
  it('renders three pricing tiers', () => {
    const { container, cleanup } = mount();
    try {
      const tiers = container.querySelectorAll('article[data-tier]');
      expect(tiers.length).toBe(3);
    } finally {
      cleanup();
    }
  });

  it('renders the trial tier as a non-clickable button (no <a>)', () => {
    const { container, cleanup } = mount();
    try {
      const trial = container.querySelector('article[data-tier="trial"]');
      expect(trial).not.toBeNull();
      // The trial CTA is a <button disabled>, NOT an <a>.
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- test setup guarantees value exists
      const anchor = trial!.querySelector('a');
      expect(anchor).toBeNull();
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- test setup guarantees value exists
      const button = trial!.querySelector('button[disabled]');
      expect(button).not.toBeNull();
      expect(button?.textContent).toBe('Start free trial');
    } finally {
      cleanup();
    }
  });

  it('renders the monthly tier as a clickable <a> with the correct href', () => {
    const { container, cleanup } = mount();
    try {
      const monthly = container.querySelector('article[data-tier="monthly"]');
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- test setup guarantees value exists
      const anchor = monthly!.querySelector('a');
      expect(anchor).not.toBeNull();
      expect(anchor?.getAttribute('href')).toContain('plan=monthly');
      expect(anchor?.getAttribute('target')).toBe('_blank');
    } finally {
      cleanup();
    }
  });

  it('renders the yearly tier as a clickable <a> with the correct href', () => {
    const { container, cleanup } = mount();
    try {
      const yearly = container.querySelector('article[data-tier="yearly"]');
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- test setup guarantees value exists
      const anchor = yearly!.querySelector('a');
      expect(anchor).not.toBeNull();
      expect(anchor?.getAttribute('href')).toContain('plan=yearly');
      expect(anchor?.getAttribute('target')).toBe('_blank');
    } finally {
      cleanup();
    }
  });
});
