/**
 * FreeCropPicker — continuous drag-and-position cropper for
 * the active theme illustration. Replaces the 9-position grid
 * CropPicker with a free-drag viewport over a full-image preview.
 *
 * The crop is a pure CSS-variable swap (background-position),
 * NOT an actual canvas crop. The user drags a viewport overlay
 * on top of a full-image preview; the viewport position maps to
 * CSS background-position percentages written to --theme-img-crop
 * on :root via the parent store.
 *
 * The 9-position grid is kept below the drag area as quick-access
 * presets. Clicking a preset snaps to that position.
 *
 * Accessibility:
 *   - The viewport is `role="slider"` with aria-valuemin/max so
 *     keyboard users can Tab to it and use arrow keys to adjust.
 *   - The preset grid is `role="radiogroup"` (same as CropPicker).
 *   - Each preset is a `<button>` with `aria-checked`.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type TouchEvent as ReactTouchEvent,
} from 'react';
import {
  CROP_LABELS,
  CROP_POSITIONS,
} from '@/shared/state/themes';
import styles from './FreeCropPicker.module.css';

export interface FreeCropPickerProps {
  themeImageUrl: string;
  cropX: number;
  cropY: number;
  activeCropIndex: number;
  onCropPositionChange: (x: number, y: number) => void;
  onCropIndexChange: (idx: number) => void;
  onReset: () => void;
}

const VP_RATIO = 0.4;

export function FreeCropPicker({
  themeImageUrl,
  cropX,
  cropY,
  activeCropIndex,
  onCropPositionChange,
  onCropIndexChange,
  onReset,
}: FreeCropPickerProps): JSX.Element {
  const previewRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState({ pw: 0, ph: 0, vw: 0, vh: 0 });

  useEffect(() => {
    const el = previewRef.current;
    if (!el) return;
    if (typeof ResizeObserver === 'undefined') {
      const pw = el.offsetWidth;
      const ph = el.offsetHeight;
      setDims({ pw, ph, vw: pw * VP_RATIO, vh: ph * VP_RATIO });
      return;
    }
    const ro = new ResizeObserver(() => {
      const pw = el.offsetWidth;
      const ph = el.offsetHeight;
      setDims({ pw, ph, vw: pw * VP_RATIO, vh: ph * VP_RATIO });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const maxLeft = Math.max(0, dims.pw - dims.vw);
  const maxTop = Math.max(0, dims.ph - dims.vh);
  const vpLeft = maxLeft > 0 ? (cropX / 100) * maxLeft : 0;
  const vpTop = maxTop > 0 ? (cropY / 100) * maxTop : 0;

  const commitPosition = useCallback(
    (clientX: number, clientY: number, offsetX: number, offsetY: number) => {
      const pre = previewRef.current;
      const vp = viewportRef.current;
      if (!pre || !vp) return;
      const rect = pre.getBoundingClientRect();
      const mw = Math.max(0, rect.width - vp.offsetWidth);
      const mh = Math.max(0, rect.height - vp.offsetHeight);
      const rawLeft = clientX - rect.left - offsetX;
      const rawTop = clientY - rect.top - offsetY;
      const clampedLeft = Math.max(0, Math.min(mw, rawLeft));
      const clampedTop = Math.max(0, Math.min(mh, rawTop));
      const nx = mw > 0 ? (clampedLeft / mw) * 100 : 50;
      const ny = mh > 0 ? (clampedTop / mh) * 100 : 50;
      onCropPositionChange(nx, ny);
    },
    [onCropPositionChange],
  );

  const handleMouseDown = useCallback(
    (e: ReactMouseEvent) => {
      e.preventDefault();
      const vp = viewportRef.current;
      if (!vp) return;
      const rect = vp.getBoundingClientRect();
      const offX = e.clientX - rect.left;
      const offY = e.clientY - rect.top;
      const onMove = (ev: MouseEvent) =>
        commitPosition(ev.clientX, ev.clientY, offX, offY);
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    },
    [commitPosition],
  );

  const handleTouchStart = useCallback(
    (e: ReactTouchEvent) => {
      const vp = viewportRef.current;
      if (!vp) return;
      const touch = e.touches[0];
      const rect = vp.getBoundingClientRect();
      const offX = touch.clientX - rect.left;
      const offY = touch.clientY - rect.top;
      const onMove = (ev: TouchEvent) => {
        const t = ev.touches[0];
        if (t) commitPosition(t.clientX, t.clientY, offX, offY);
      };
      const onEnd = () => {
        document.removeEventListener('touchmove', onMove);
        document.removeEventListener('touchend', onEnd);
      };
      document.addEventListener('touchmove', onMove, { passive: true });
      document.addEventListener('touchend', onEnd);
    },
    [commitPosition],
  );

  const handleKeyDown = useCallback(
    (e: ReactKeyboardEvent) => {
      const step = e.shiftKey ? 10 : 2;
      let nx = cropX;
      let ny = cropY;
      switch (e.key) {
        case 'ArrowLeft':
          nx = Math.max(0, cropX - step);
          break;
        case 'ArrowRight':
          nx = Math.min(100, cropX + step);
          break;
        case 'ArrowUp':
          ny = Math.max(0, cropY - step);
          break;
        case 'ArrowDown':
          ny = Math.min(100, cropY + step);
          break;
        default:
          return;
      }
      e.preventDefault();
      onCropPositionChange(nx, ny);
    },
    [cropX, cropY, onCropPositionChange],
  );

  return (
    <div className={styles.wrap} data-testid="free-crop-picker">
      <span className={styles.label}>Frame</span>

      <div
        className={styles.preview}
        ref={previewRef}
        style={{ backgroundImage: `url('${themeImageUrl}')` }}
        data-testid="free-crop-preview"
      >
        <div
          ref={viewportRef}
          className={styles.viewport}
          role="slider"
          aria-label="Crop position"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(cropX)}
          aria-valuetext={`${Math.round(cropX)}%, ${Math.round(cropY)}%`}
          tabIndex={0}
          style={{ left: vpLeft, top: vpTop }}
          data-testid="free-crop-viewport"
          onMouseDown={handleMouseDown}
          onTouchStart={handleTouchStart}
          onKeyDown={handleKeyDown}
        />
      </div>

      <div className={styles.controls}>
        <span className={styles.readout} data-testid="free-crop-readout">
          {Math.round(cropX)}%, {Math.round(cropY)}%
        </span>
        <button
          type="button"
          className={styles.resetBtn}
          onClick={onReset}
          disabled={cropX === 50 && cropY === 50}
          title="Reset crop to center"
          data-testid="free-crop-reset"
        >
          Reset
        </button>
      </div>

      <div
        className={styles.presets}
        role="radiogroup"
        aria-label="Crop presets"
        data-testid="free-crop-presets"
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
              className={
                styles.presetThumb + (active ? ' ' + styles.active : '')
              }
              style={{
                backgroundImage: `url('${themeImageUrl}')`,
                backgroundPosition: `${pos.x} ${pos.y}`,
              }}
              data-testid={`free-crop-preset-${i}`}
              title={CROP_LABELS[i]}
              onClick={() => onCropIndexChange(i)}
            />
          );
        })}
      </div>
    </div>
  );
}
