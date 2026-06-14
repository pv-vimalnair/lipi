/**
 * PricingCard — the in-app paywall for the subscription
 * UX.
 *
 * Phase 3 (subscription UX). Renders the three pricing
 * tiers (trial, monthly, yearly) on the License
 * activation screen. The user reads the prices, then
 * either:
 *
 *   - Pastes a license key (the activation form BELOW
 *     the pricing card), or
 *   - Clicks "Subscribe monthly" / "Subscribe yearly"
 *     to open the project website (the in-app paywall
 *     is NOT a checkout — the actual payment is on
 *     the website).
 *
 * The pricing data is in `pricing.ts` (a separate
 * const so the data can be updated without touching
 * the component). The CTA links open in the system
 * browser via a plain anchor with `target="_blank"`,
 * which the Tauri WebView intercepts via its built-in
 * external-link handling (Tauri 2's default webview
 * opens external links in the system browser; we
 * don't need the optional `tauri-plugin-opener` for
 * this v1).
 */
import { PRICING_TIERS, type PricingTier } from './pricing';

import styles from './PricingCard.module.css';

export function PricingCard(): JSX.Element {
  return (
    <section className={styles.card} aria-labelledby="lipi-pricing-title">
      <h2 id="lipi-pricing-title" className={styles.title}>
        Choose a plan
      </h2>
      <p className={styles.lede}>
        All plans include every Lipi feature. Pick what works for you.
      </p>
      <div className={styles.tiers}>
        {PRICING_TIERS.map((tier) => (
          <PricingCardItem key={tier.id} tier={tier} />
        ))}
      </div>
    </section>
  );
}

function PricingCardItem({ tier }: { tier: PricingTier }): JSX.Element {
  return (
    <article className={styles.tier} data-tier={tier.id}>
      <h3 className={styles.tierName}>{tier.name}</h3>
      <p className={styles.price}>
        <span className={styles.priceLabel}>{tier.priceLabel}</span>
        <span className={styles.priceDuration}>{tier.durationLabel}</span>
      </p>
      <p className={styles.description}>{tier.description}</p>
      {tier.ctaHref === null ? (
        <button type="button" className={styles.ctaDisabled} disabled>
          {tier.ctaLabel}
        </button>
      ) : (
        <a
          className={styles.cta}
          href={tier.ctaHref}
          target="_blank"
          rel="noopener noreferrer"
          title={tier.ctaHref}
        >
          {tier.ctaLabel} →
        </a>
      )}
    </article>
  );
}
