/**
 * Phase J — TemplateGallery.
 *
 * A 5-card grid rendered on the Welcome screen, between
 * the hero CTA and the recents list. Each card shows a
 * template's name + 1-line description, with a "Create"
 * button. Clicking "Create" calls
 * `useApplyTemplate().start(id)` which opens the native
 * folder picker, applies the template, and opens the
 * new workspace.
 *
 * Keyboard support: each card is a `<button>`, focusable
 * via Tab. Pressing Enter or Space is equivalent to
 * clicking. The card has an `aria-label` that includes
 * the template name and description.
 *
 * The component is small and presentational; all logic
 * lives in the `useApplyTemplate` hook. The pure
 * rendering of the cards is the only thing this file
 * owns.
 */

import type { KeyboardEvent } from 'react';

import { Button } from '@/shared/components/Button/Button';
import { Stack } from '@/shared/components/Stack/Stack';
import { WORKSPACE_TEMPLATES } from '@/templates/registry';

import { useApplyTemplate } from '../../hooks/useApplyTemplate';

import styles from './TemplateGallery.module.css';

export function TemplateGallery(): JSX.Element {
  const start = useApplyTemplate();
  return (
    <section
      className={styles.gallery}
      aria-labelledby="welcome-templates-title"
      data-testid="template-gallery"
    >
      <h2 id="welcome-templates-title" className={styles.title}>
        Start from a template
      </h2>
      <p className={styles.subtitle}>
        Pick a starter, choose a folder, and we&apos;ll create the files and
        open the new project.
      </p>
      <ul className={styles.grid} role="list">
        {WORKSPACE_TEMPLATES.map((t) => (
          <li key={t.id} className={styles.cardItem}>
            <button
              type="button"
              className={styles.card}
              aria-label={`Create ${t.name} project. ${t.description}`}
              data-testid={`template-card-${t.id}`}
              onClick={() => {
                void start(t.id);
              }}
              onKeyDown={(e: KeyboardEvent<HTMLButtonElement>) => {
                // Buttons handle Enter and Space natively,
                // but we keep the handler in case future
                // versions add hotkeys (e.g. digit keys to
                // jump to a card).
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  void start(t.id);
                }
              }}
            >
              <Stack
                direction="column"
                align="stretch"
                gap={6}
                className={styles.cardBody}
              >
                <span className={styles.cardName}>{t.name}</span>
                <span className={styles.cardDescription}>
                  {t.description}
                </span>
                <span className={styles.cardMeta}>
                  {t.fileCount} files
                </span>
              </Stack>
            </button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                void start(t.id);
              }}
              aria-label={`Create ${t.name} project`}
              data-testid={`template-create-${t.id}`}
              className={styles.cardCta}
            >
              Create
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
