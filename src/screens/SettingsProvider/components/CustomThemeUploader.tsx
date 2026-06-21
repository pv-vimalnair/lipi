import { useCallback, useRef, useState } from 'react';
import { Button } from '@/shared/components/Button';
import { useThemeStore, themeSelectors } from '@/shared/state/themeStore';

import styles from './CustomThemeUploader.module.css';

const TARGET_ASPECT = 4 / 5;
const ASPECT_TOLERANCE = 0.05;
const MAX_PREVIEW_WIDTH = 800;
const JPEG_QUALITY = 0.85;

interface CropState {
  img: HTMLImageElement;
  dataUrl: string;
  /** Scale ratio: natural width / display width. */
  scale: number;
  /** Crop rect in *display* px relative to the preview container. */
  cropX: number;
  cropY: number;
  cropW: number;
  cropH: number;
}

export function CustomThemeUploader(): JSX.Element {
  const customImageUrl = useThemeStore(themeSelectors.customImageUrl);
  const setCustomImage = useThemeStore((s) => s.setCustomImage);
  const clearCustomImage = useThemeStore((s) => s.clearCustomImage);

  const [cropState, setCropState] = useState<CropState | null>(null);
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef<{ x: number; y: number; cropX: number; cropY: number }>({ x: 0, y: 0, cropX: 0, cropY: 0 });
  const previewRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        const img = new Image();
        img.onload = () => {
          const aspect = img.naturalWidth / img.naturalHeight;
          if (Math.abs(aspect - TARGET_ASPECT) < ASPECT_TOLERANCE) {
            saveCropped(img, dataUrl);
            return;
          }

          const displayW = Math.min(img.naturalWidth, MAX_PREVIEW_WIDTH);
          const displayH = displayW / TARGET_ASPECT;
          const scale = img.naturalWidth / displayW;

          const initialCropW = displayW * 0.8;
          const initialCropH = initialCropW / TARGET_ASPECT;

          setCropState({
            img,
            dataUrl,
            scale,
            cropX: (displayW - initialCropW) / 2,
            cropY: (displayH - initialCropH) / 2,
            cropW: initialCropW,
            cropH: initialCropH,
          });
        };
        img.src = dataUrl;
      };
      reader.readAsDataURL(file);
      e.target.value = '';
    },
    [],
  );

  const saveCropped = useCallback(
    (img: HTMLImageElement, _srcDataUrl?: string, state?: CropState) => {
      let sx: number, sy: number, sw: number, sh: number;

      if (state) {
        sx = state.cropX * state.scale;
        sy = state.cropY * state.scale;
        sw = state.cropW * state.scale;
        sh = state.cropH * state.scale;
      } else {
        const aspect = img.naturalWidth / img.naturalHeight;
        if (aspect > TARGET_ASPECT) {
          sh = img.naturalHeight;
          sw = sh * TARGET_ASPECT;
          sx = (img.naturalWidth - sw) / 2;
          sy = 0;
        } else {
          sw = img.naturalWidth;
          sh = sw / TARGET_ASPECT;
          sx = 0;
          sy = (img.naturalHeight - sh) / 2;
        }
      }

      const outW = Math.min(Math.round(sw), MAX_PREVIEW_WIDTH);
      const outH = Math.round(outW / TARGET_ASPECT);

      const canvas = document.createElement('canvas');
      canvas.width = outW;
      canvas.height = outH;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, outW, outH);

      const croppedDataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
      setCustomImage(croppedDataUrl);
      setCropState(null);
    },
    [setCustomImage],
  );

  const handleApplyCrop = useCallback(() => {
    if (!cropState) return;
    saveCropped(cropState.img, cropState.dataUrl, cropState);
  }, [cropState, saveCropped]);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (!cropState) return;
      e.preventDefault();
      setDragging(true);
      dragStart.current = {
        x: e.clientX,
        y: e.clientY,
        cropX: cropState.cropX,
        cropY: cropState.cropY,
      };
    },
    [cropState],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!dragging || !cropState || !previewRef.current) return;
      const rect = previewRef.current.getBoundingClientRect();
      const dx = e.clientX - dragStart.current.x;
      const dy = e.clientY - dragStart.current.y;

      const displayW = rect.width;
      const displayH = displayW / TARGET_ASPECT;

      const newX = Math.max(0, Math.min(displayW - cropState.cropW, dragStart.current.cropX + dx));
      const newY = Math.max(0, Math.min(displayH - cropState.cropH, dragStart.current.cropY + dy));

      setCropState((prev) => (prev ? { ...prev, cropX: newX, cropY: newY } : prev));
    },
    [dragging, cropState],
  );

  const handleMouseUp = useCallback(() => {
    setDragging(false);
  }, []);

  const handleCancelCrop = useCallback(() => {
    setCropState(null);
    setDragging(false);
  }, []);

  const handleUploadClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  if (cropState) {
    const displayW = Math.min(cropState.img.naturalWidth, MAX_PREVIEW_WIDTH);
    const displayH = displayW / TARGET_ASPECT;

    return (
      <div className={styles.cropContainer} data-testid="custom-theme-cropper">
        <div
          ref={previewRef}
          className={styles.cropPreview}
          style={{ width: displayW, height: displayH }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
        >
          <img
            src={cropState.dataUrl}
            className={styles.cropImage}
            style={{ width: displayW, height: displayH }}
            alt="Crop preview"
            draggable={false}
          />
          <div
            className={styles.cropOverlay}
            style={{
              left: cropState.cropX,
              top: cropState.cropY,
              width: cropState.cropW,
              height: cropState.cropH,
            }}
          />
        </div>
        <div className={styles.cropActions}>
          <Button variant="primary" size="sm" onClick={handleApplyCrop} data-testid="crop-apply">
            Apply crop
          </Button>
          <Button variant="ghost" size="sm" onClick={handleCancelCrop}>
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.container} data-testid="custom-theme-uploader">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className={styles.fileInput}
        onChange={handleFileChange}
        data-testid="custom-theme-file-input"
      />

      {customImageUrl ? (
        <div className={styles.previewRow}>
          <div
            className={styles.previewThumb}
            style={{ backgroundImage: `url('${customImageUrl}')` }}
            aria-label="Custom theme preview"
          />
          <div className={styles.previewActions}>
            <Button
              variant="secondary"
              size="sm"
              onClick={handleUploadClick}
              data-testid="custom-theme-change"
            >
              Change image
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={clearCustomImage}
              data-testid="custom-theme-remove"
            >
              Remove
            </Button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className={styles.uploadArea}
          onClick={handleUploadClick}
          data-testid="custom-theme-upload-area"
        >
          <span className={styles.uploadIcon} aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
          </span>
          <span className={styles.uploadText}>Upload a custom image</span>
          <span className={styles.uploadHint}>JPEG or PNG, any size — we&apos;ll help you crop it</span>
        </button>
      )}
    </div>
  );
}
