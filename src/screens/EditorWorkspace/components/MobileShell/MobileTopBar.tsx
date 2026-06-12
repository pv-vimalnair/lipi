/**
 * MobileTopBar — the small top
 * chrome on `MobileShell` (M1).
 *
 * Renders:
 *   - The OS status bar
 *     ("9:41", "5G", "100%")
 *     pushed down by the
 *     device's
 *     `safe-area-inset-top`.
 *   - A thin app bar with
 *     "Lipi" and a model
 *     badge (when an
 *     AI provider is
 *     configured).
 *
 * The status bar is purely
 * visual — the dev doesn't
 * tap on it. The app bar
 * below it is interactive
 * (the model badge is the
 * future command-palette
 * entry point; not wired
 * in M1).
 */

import { useAiStore, aiSelectors } from '../../state/aiStore';
import styles from './MobileShell.module.css';

export function MobileTopBar(): JSX.Element {
  const provider = useAiStore(aiSelectors.provider);
  const model = useAiStore(aiSelectors.model);
  const configuredProviders = useAiStore(aiSelectors.configuredProviders);
  const providerConfigured = configuredProviders?.includes(provider) ?? false;

  return (
    <header className={styles.topBar}>
      <div className={styles.statusBar}>
        <span className={styles.statusTime}>9:41</span>
        <span className={styles.statusIcons} aria-hidden="true">
          <span>5G</span>
          <span>100%</span>
        </span>
      </div>
      <div className={styles.appBar}>
        <span className={styles.appBarTitle}>Lipi</span>
        <span
          className={styles.appBarBadge}
          data-configured={providerConfigured || undefined}
        >
          {providerConfigured && model ? model : 'no key'}
        </span>
      </div>
    </header>
  );
}
