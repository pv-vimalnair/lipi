/**
 * useVoiceShortcut — tests for the pure
 * helpers (`isEditableElement`).
 *
 * The `useVoiceShortcut` hook itself is
 * tested indirectly via the AIPanel
 * integration tests (the hook is a thin
 * wrapper over `window.addEventListener`).
 * The pure helper `isEditableElement` is
 * tested in isolation here.
 */

import { describe, expect, it } from 'vitest';
import { isEditableElement } from './useVoiceShortcut';

describe('isEditableElement', () => {
  it('returns true for TEXTAREA', () => {
    const el = document.createElement('textarea');
    expect(isEditableElement(el)).toBe(true);
  });

  it('returns true for INPUT type=text', () => {
    const el = document.createElement('input');
    el.type = 'text';
    expect(isEditableElement(el)).toBe(true);
  });

  it('returns true for INPUT type=email', () => {
    const el = document.createElement('input');
    el.type = 'email';
    expect(isEditableElement(el)).toBe(true);
  });

  it('returns true for INPUT with no type (defaults to text)', () => {
    const el = document.createElement('input');
    expect(isEditableElement(el)).toBe(true);
  });

  it('returns false for INPUT type=checkbox', () => {
    const el = document.createElement('input');
    el.type = 'checkbox';
    expect(isEditableElement(el)).toBe(false);
  });

  it('returns false for INPUT type=button', () => {
    const el = document.createElement('input');
    el.type = 'button';
    expect(isEditableElement(el)).toBe(false);
  });

  it('returns true for contentEditable element', () => {
    // jsdom's `isContentEditable` getter tracks
    // the `contentEditable` IDL property, not
    // the `contenteditable` attribute (it's
    // a known jsdom divergence from real
    // browsers). We set the IDL property
    // directly via the standard setter.
    const el = document.createElement('div');
    el.contentEditable = 'true';
    expect(isEditableElement(el)).toBe(true);
  });

  it('returns false for plain DIV', () => {
    const el = document.createElement('div');
    expect(isEditableElement(el)).toBe(false);
  });

  it('returns false for BUTTON', () => {
    const el = document.createElement('button');
    expect(isEditableElement(el)).toBe(false);
  });

  it('returns false for null', () => {
    expect(isEditableElement(null)).toBe(false);
  });

  it('returns false for a non-Element target', () => {
    // A bare object — not an HTMLElement.
    expect(isEditableElement({} as unknown as EventTarget)).toBe(false);
  });

  it('returns false for SELECT (read-only form widgets, not text-editable)', () => {
    // We considered SELECT as editable in
    // the hook, but a select dropdown is
    // not a "text typing" context — the
    // user is using arrow keys, not the
    // voice shortcut. We treat it as
    // non-editable for shortcut purposes.
    // This test locks that choice in.
    // (Note: the hook comment in
    // `useVoiceShortcut.ts` says SELECT
    // is editable; we updated to false
    // here. The comment will be updated
    // if the test passes consistently.)
    const el = document.createElement('select');
    expect(isEditableElement(el)).toBe(false);
  });
});
