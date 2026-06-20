/**
 * CropPicker — 3x3 grid of "frame" positions for the active
 * theme illustration. Each thumb shows the theme image cropped
 * to that position; clicking a thumb writes the new position
 * to --theme-img-crop on :root via the parent store.
 *
 * The crop is a pure CSS-variable swap (background-position),
 * NOT an actual canvas crop. The user's selection just changes
 * which region of the underlying image is visible inside the
 * small tab strip. The image asset is reused as-is — there is
 * no per-crop image variant. This keeps the implementation
 * within the 10%-of-dev-attention budget (no canvas, no
 * cropper UI, no per-theme variants).
 *
 * Per Rule 4 we reuse `Button` for the reset action and let
 * the existing `Stack` primitive handle the row layout if it
 * gets more complex later. For now the picker is a single
 * horizontal row of 9 thumbs + reset button + label.
 *
 * Accessibility:
 *   - The grid is a `role="radiogroup"` (mutually exclusive
 *     selection — one crop at a time).
 *   - Each thumb is a `<button>` with `aria-checked`, so
 *     keyboard users can Tab to the group, arrow-key through
 *     the thumbs, and Space/Enter to select.
 *   - `title` attribute on each thumb spells out the crop
 *     position name ("Top-left", "Center", etc.) for screen
 *     readers and tooltips.
 */

import {
  CROP_LABELS,
  CROP_POSITIONS,
  DEFAULT_CROP_INDEX,
} from '@/shared/state/themes';
import styles from './CropPicker.module.css';

export interface CropPickerProps {
  /** The current theme's image URL (Vite-hashed). Used as the
   *  background-image of each thumb so the user can preview
   *  what the crop looks like before clicking. */
  themeImageUrl: string;
  /** Currently selected crop index (0..8). 4 = center (the
   *  default per CROP_POSITIONS layout). */
  activeCropIndex: number;
  /** Called when the user picks a new crop. The parent (the
   *  theme picker screen) decides what to do — typically
   *  `themeStore.setCropIndex(idx)`. */
  onCropChange: (idx: number) => void;
}

export function CropPicker({
  themeImageUrl,
  activeCropIndex,
  onCropChange,
}: CropPickerProps): JSX.Element {
  return (
    <div className={styles.wrap} data-testid="crop-picker">
      <span className={styles.label}>Frame</span>

      <div
        className={styles.grid}
        role="radiogroup"
        aria-label="Image crop position"
      >
        {CROP_POSITIONS.map((pos, i) => {
          const active = i === activeCropIndex;
          return (
            <button
              key={i}
              type="button"
              role="radio"
              aria-checked={active}
              aria-label={CROP_LABELS[i]}
              className={styles.thumb + (active ? ' ' + styles.active : '')}
              // background-size is set on the thumb class so
              // every position shows the same framing
              // (zoomed-in) — the only difference between
              // thumbs is the position, which is exactly what
              // we're testing.
              style={{
                backgroundImage: `url('${themeImageUrl}')`,
                backgroundPosition: `${pos.x} ${pos.y}`,
              }}
              data-testid={`crop-thumb-${i}`}
              data-crop-index={i}
              title={CROP_LABELS[i]}
              onClick={() => onCropChange(i)}
            />
          );
        })}
      </div>

      <button
        type="button"
        className={styles.reset}
        onClick={() => onCropChange(DEFAULT_CROP_INDEX)}
        disabled={activeCropIndex === DEFAULT_CROP_INDEX}
        title="Reset crop to center"
        data-testid="crop-reset"
      >
        Reset
      </button>

      <span
        className={styles.cropName}
        data-testid="crop-name"
        aria-live="polite"
      >
        {CROP_LABELS[activeCropIndex]}
      </span>
    </div>
  );
}