/**
 * Tests for `ConfirmDestructiveModal` —
 * the Decision #66 polished replacement
 * for `window.confirm` in the file
 * tree's "Delete" action.
 *
 * Uses `renderToStaticMarkup` to assert
 * on the rendered title, body copy, and
 * button labels. The component is
 * essentially presentational (the parent
 * owns the actual delete IPC call) so
 * behaviour tests are out of scope —
 * the modal just renders + dispatches
 * the parent's callbacks.
 */

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { ConfirmDestructiveModal } from './ConfirmDestructiveModal';

function render(
  kind: 'file' | 'folder',
  name: string,
  detail?: string,
): string {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  return renderToStaticMarkup(
    <ConfirmDestructiveModal
      open
      kind={kind}
      name={name}
      detail={detail}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />,
  );
}

describe('ConfirmDestructiveModal', () => {
  it('renders a "Delete file" title for file kind', () => {
    const html = render('file', 'foo.txt');
    expect(html).toMatch(/>Delete file</);
  });

  it('renders a "Delete folder" title for folder kind', () => {
    const html = render('folder', 'bar');
    expect(html).toMatch(/>Delete folder</);
  });

  it('renders the body with the file name and the "cannot be undone" warning', () => {
    const html = render('file', 'foo.txt');
    // The double quote is HTML-escaped
    // to `&quot;` in the rendered
    // markup.
    expect(html).toMatch(/Delete &quot;foo\.txt&quot;\?/);
    expect(html).toMatch(/cannot be undone/);
  });

  it('renders a "and all its contents" warning for folders', () => {
    const html = render('folder', 'bar');
    expect(html).toMatch(/Delete folder &quot;bar&quot; and all its contents/);
  });

  it('renders a Delete button (the primary action)', () => {
    const html = render('file', 'foo.txt');
    expect(html).toMatch(/>Delete</);
  });

  it('renders a Cancel button (the secondary action)', () => {
    const html = render('file', 'foo.txt');
    expect(html).toMatch(/>Cancel</);
  });

  it('renders the optional detail line when provided', () => {
    const html = render('folder', 'bar', '12 children will also be removed');
    expect(html).toMatch(/12 children will also be removed/);
  });

  it('does not render the detail line when not provided', () => {
    const html = render('file', 'foo.txt');
    // We don't pin the exact HTML
    // (it would be a brittle
    // assertion), but we do assert
    // there's no `<p>` other than
    // the body — there is exactly
    // one `<p>` (the body) when
    // detail is omitted.
    const ps = html.match(/<p[^>]*>/g) ?? [];
    expect(ps.length).toBe(1);
  });

  it('uses the `data-testid` on the body and the confirm button', () => {
    const html = render('file', 'foo.txt');
    expect(html).toMatch(/data-testid="confirm-destructive-body"/);
    expect(html).toMatch(/data-testid="confirm-destructive-confirm"/);
  });
});
