/**
 * Pricing tiers for the in-app paywall.
 *
 * Phase 3 (subscription UX). The PricingCard renders
 * these as three cards (trial, monthly, yearly). The
 * prices are placeholders; the project lead updates
 * them when the pricing page goes live.
 *
 * The `ctaHref` is `https://lipi.ide/pricing?plan=...`
 * (placeholder; the real URL is set when the project
 * website launches). The `ctaHref` is opened via
 * Tauri's `openUrl` plugin — see the PricingCard.tsx
 * component for the wiring.
 */
export interface PricingTier {
  /** Stable id used in the URL query (?plan=…) and in the React `key`. */
  id: 'trial' | 'monthly' | 'yearly';

  /** Display name (shown as the card title). */
  name: string;

  /** Price label (e.g. "$5", "Free"). */
  priceLabel: string;

  /** Duration label (e.g. "per month", "14 days"). */
  durationLabel: string;

  /** One-line description of the tier. */
  description: string;

  /** Button label (e.g. "Subscribe monthly"). */
  ctaLabel: string;

  /**
   * Link to open when the user clicks the button. The
   * `trial` tier has `null` (no link; the trial is
   * auto-generated and the user can't "subscribe" to
   * it). All other tiers open the project website's
   * pricing page with a `?plan=…` query parameter.
   */
  ctaHref: string | null;
}

export const PRICING_TIERS: readonly PricingTier[] = [
  {
    id: 'trial',
    name: 'Free trial',
    priceLabel: 'Free',
    durationLabel: '14 days',
    description: 'Full features for 14 days. No credit card.',
    ctaLabel: 'Start free trial',
    ctaHref: null,
  },
  {
    id: 'monthly',
    name: 'Monthly',
    priceLabel: '$5',
    durationLabel: 'per month',
    description: 'All features. Cancel anytime.',
    ctaLabel: 'Subscribe monthly',
    ctaHref: 'https://lipi.ide/pricing?plan=monthly',
  },
  {
    id: 'yearly',
    name: 'Yearly',
    priceLabel: '$50',
    durationLabel: 'per year',
    description: 'All features. Save 17% vs monthly.',
    ctaLabel: 'Subscribe yearly',
    ctaHref: 'https://lipi.ide/pricing?plan=yearly',
  },
] as const;
