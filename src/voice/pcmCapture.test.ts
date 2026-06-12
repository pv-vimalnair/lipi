/**
 * pcmCapture tests.
 *
 * The conversion functions are pure (no I/O, no
 * browser-only APIs), so we test them exhaustively here.
 *
 * The browser-only `startPcmCapture()` path is exercised
 * by the useVoiceCapture hook tests, which stub
 * `navigator.mediaDevices` and `window.AudioContext` in
 * the same way the M2a tests do.
 */
import { describe, expect, it } from 'vitest';

import {
  PCM_CHANNELS,
  PCM_CHUNK_MS,
  PCM_CHUNK_SAMPLES,
  WISPR_SAMPLE_RATE_HZ,
  encodeInt16AsBase64,
  float32ToInt16,
} from './pcmCapture';

describe('pcmCapture', () => {
  describe('float32ToInt16', () => {
    it('converts 0.0 to 0', () => {
      const out = float32ToInt16(new Float32Array([0]));
      expect(out[0]).toBe(0);
    });

    it('converts 1.0 to 32767 (max positive)', () => {
      const out = float32ToInt16(new Float32Array([1]));
      expect(out[0]).toBe(32767);
    });

    it('converts -1.0 to -32768 (min negative)', () => {
      const out = float32ToInt16(new Float32Array([-1]));
      expect(out[0]).toBe(-32768);
    });

    it('clamps values above 1.0 to 32767', () => {
      const out = float32ToInt16(new Float32Array([1.5, 100, 9999]));
      expect(out[0]).toBe(32767);
      expect(out[1]).toBe(32767);
      expect(out[2]).toBe(32767);
    });

    it('clamps values below -1.0 to -32768', () => {
      const out = float32ToInt16(new Float32Array([-1.5, -100]));
      expect(out[0]).toBe(-32768);
      expect(out[1]).toBe(-32768);
    });

    it('rounds toward -Inf (matches Wispr quickstart)', () => {
      // 0.5 -> 16383.5 should round to 16384 (away from
      // zero on the positive side).
      const out = float32ToInt16(new Float32Array([0.5]));
      expect(out[0]).toBe(16384);
    });

    it('handles a sine wave-like sweep', () => {
      const N = 100;
      const input = new Float32Array(N);
      for (let i = 0; i < N; i++) input[i] = Math.sin((i / N) * 2 * Math.PI);
      const out = float32ToInt16(input);
      expect(out.length).toBe(N);
      // All values should be in the int16 range.
      for (const v of out) {
        expect(v).toBeGreaterThanOrEqual(-32768);
        expect(v).toBeLessThanOrEqual(32767);
      }
    });
  });

  describe('encodeInt16AsBase64', () => {
    it('encodes an empty array to an empty string', () => {
      expect(encodeInt16AsBase64(new Int16Array(0))).toBe('');
    });

    it('encodes 0x0001 0x0002 0x0003 to the right base64', () => {
      // Int16Array is little-endian on all
      // platforms (per ECMAScript spec). The byte
      // sequence for [0x0001, 0x0002, 0x0003] is:
      //   0x01 0x00 0x02 0x00 0x03 0x00
      // base64 of that is "AQACAAMA".
      const out = encodeInt16AsBase64(new Int16Array([0x0001, 0x0002, 0x0003]));
      expect(out).toBe('AQACAAMA');
    });

    it('round-trips with atob', () => {
      const samples = new Int16Array([100, -200, 32000, -32000, 0, 1, -1]);
      const encoded = encodeInt16AsBase64(samples);
      const decoded = atob(encoded);
      const bytes = new Uint8Array(decoded.length);
      for (let i = 0; i < decoded.length; i++) bytes[i] = decoded.charCodeAt(i);
      const round = new Int16Array(bytes.buffer, bytes.byteOffset, samples.length);
      for (let i = 0; i < samples.length; i++) {
        expect(round[i]).toBe(samples[i]);
      }
    });
  });

  describe('module constants', () => {
    it('Wispr rate is 16 kHz', () => {
      expect(WISPR_SAMPLE_RATE_HZ).toBe(16_000);
    });

    it('Mono', () => {
      expect(PCM_CHANNELS).toBe(1);
    });

    it('50ms chunk at 16kHz = 800 samples', () => {
      expect(PCM_CHUNK_MS).toBe(50);
      expect(PCM_CHUNK_SAMPLES).toBe(800);
    });
  });
});
