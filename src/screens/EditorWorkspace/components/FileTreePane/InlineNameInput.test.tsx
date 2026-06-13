/**
 * Tests for `InlineNameInput` — the
 * Decision #66 polished replacement
 * for `window.prompt` in the file
 * tree's "New File" / "Rename" actions.
 *
 * Two test surfaces:
 *   1. `initialNameFor` (pure helper,
 *      structural / behavioural tests
 *      only).
 *   2. The component itself, rendered
 *      with `renderToStaticMarkup` to
 *      assert on title, button label,
 *      and initial value.
 *
 * The component has a `useEffect` that
 * focuses + selects the input on open;
 * we don't test that with a renderer
 * (the focus / selection effects
 * require a real document and the
 * `useFileTree.ts` pure-helper test
 * pattern would be more friction than
 * the assertion is worth — the
 * behaviour is exercised manually in
 * the smoke test).
 */

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { InlineNameInput, initialNameFor } from './InlineNameInput';
import { suggestNewFileName } from './fileNameValidation';

function render(
  mode: 'new-file' | 'rename',
  initialName: string,
  existingNames: ReadonlySet<string> = new Set(),
): string {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  return renderToStaticMarkup(
    <InlineNameInput
      open
      mode={mode}
      initialName={initialName}
      existingNames={existingNames}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />,
  );
}

describe('initialNameFor', () => {
  it('returns the current name for "rename"', () => {
    expect(initialNameFor('rename', new Set(), 'foo.txt')).toBe('foo.txt');
  });

  it('returns a fresh suggested name for "new-file"', () => {
    expect(initialNameFor('new-file', new Set(), 'irrelevant.txt')).toBe(
      'untitled.txt',
    );
  });

  it('skips to a numbered suggestion when untitled.txt exists', () => {
    const taken = new Set(['untitled.txt']);
    expect(initialNameFor('new-file', taken, 'irrelevant.txt')).toBe(
      'untitled (1).txt',
    );
  });

  it('falls back to suggestNewFileName directly (sanity check)', () => {
    expect(suggestNewFileName(new Set())).toBe('untitled.txt');
  });
});

describe('InlineNameInput (rendered)', () => {
  it('renders a "New file" title + Create button in new-file mode', () => {
    const html = render('new-file', 'untitled.txt');
    expect(html).toMatch(/New file/);
    // The button label is the only place
    // "Create" appears (the title is
    // "New file").
    expect(html).toMatch(/>Create</);
  });

  it('renders a "Rename" title + Rename button in rename mode', () => {
    const html = render('rename', 'foo.txt');
    expect(html).toMatch(/>Rename</);
  });

  it('pre-populates the input with the initial name', () => {
    const html = render('rename', 'foo.txt');
    // The input element's `value` is
    // rendered as `value="foo.txt"`.
    expect(html).toMatch(/value="foo\.txt"/);
  });

  it('disables the submit button when the initial name is invalid', () => {
    // Pre-populated with an empty name.
    // The submit button should be
    // disabled (the validation logic
    // catches this in the same frame
    // the modal opens).
    const html = render('new-file', '');
    // The submit button is the
    // "primary" variant — only the
    // Cancel button is "ghost", so
    // the `disabled` attribute should
    // appear on the primary button.
    const buttons = html.match(/<button[^>]*>/g) ?? [];
    const primaryButton = buttons.find((b) => b.includes('type="submit"'));
    expect(primaryButton).toBeDefined();
    expect(primaryButton).toMatch(/disabled/);
  });

  it('does not disable the submit button for a valid initial name', () => {
    const html = render('rename', 'good.txt');
    const buttons = html.match(/<button[^>]*>/g) ?? [];
    const primaryButton = buttons.find((b) => b.includes('type="submit"'));
    expect(primaryButton).toBeDefined();
    expect(primaryButton).not.toMatch(/disabled/);
  });

  it('disables the submit button when the name collides with an existing entry', () => {
    const html = render('new-file', 'foo.txt', new Set(['foo.txt']));
    const buttons = html.match(/<button[^>]*>/g) ?? [];
    const primaryButton = buttons.find((b) => b.includes('type="submit"'));
    expect(primaryButton).toMatch(/disabled/);
  });

  it('shows the inline error only after the user has touched the input', () => {
    // On first render, `touched` is
    // false — the error message is
    // not rendered even if the
    // initial name is invalid (so a
    // user opening the modal to
    // rename "" isn't yelled at).
    const html = render('new-file', '');
    expect(html).not.toMatch(/inline-name-error/);
  });
});
