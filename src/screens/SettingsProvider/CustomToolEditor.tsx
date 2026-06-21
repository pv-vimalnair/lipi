/**
 * CustomToolEditor — a JSON-textarea editor for a single
 * `LipiToolEntry` (Phase 5c).
 *
 * Why JSON and not a per-field form?
 * ---------------------------------
 * A shell tool needs `command` + `args` + `cwd` + `argsSpec`,
 * an HTTP tool needs `url` + `method` + `headers` + `body` +
 * `argsSpec`. The kind-specific fields are mostly orthogonal,
 * so a flat form would have ~12 inputs and lots of conditional
 * rendering. A JSON textarea is denser, exposes every field
 * at once, and lets power users copy/paste entries between
 * projects.
 *
 * The textarea ships with a one-click "Insert template" affordance
 * that pastes a starter entry for the chosen kind — so new
 * users don't have to hand-write JSON.
 *
 * The "Save" action runs the entry through `validateEntry`
 * (delegated to the `customToolsStore.addTool` /
 * `customToolsStore.updateTool` actions) and surfaces
 * validation errors inline. Cancel discards the draft
 * and closes the editor.
 *
 * Per Rule 4, all UI is built from `src/shared/components/`.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Stack } from '@/shared/components/Stack';
import { Button } from '@/shared/components/Button';
import { IconButton } from '@/shared/components/IconButton';
import { useCustomToolsStore } from '@/shared/state/customToolsStore';
import type { LipiToolEntry, LipiToolKind } from '@/ipc/lipiTools';
import styles from './SettingsProvider.module.css';

/**
 * A starter template for a brand-new tool of a given kind.
 * The user fills in the blanks; we never write a
 * template to disk directly.
 */
const SHELL_TEMPLATE: LipiToolEntry = {
  name: 'my_shell_tool',
  description: 'Describe what this tool does for the model.',
  kind: 'shell',
  command: 'echo',
  args: ['hello'],
  argsSpec: [],
};

const HTTP_TEMPLATE: LipiToolEntry = {
  name: 'my_http_tool',
  description: 'Describe what this tool does for the model.',
  kind: 'http',
  url: 'https://api.example.com/{path}',
  method: 'GET',
  headers: {},
  body: '',
  allowedHosts: ['api.example.com'],
  allowPrivateNetwork: false,
  argsSpec: [
    { name: 'path', type: 'string', description: 'URL path.' },
  ],
};

export interface CustomToolEditorProps {
  /** `undefined` = creating a new tool. */
  existing: LipiToolEntry | undefined;
  /** Close the editor; `true` = saved, `false` = cancelled. */
  onClose: (saved: boolean) => void;
}

export function CustomToolEditor({
  existing,
  onClose,
}: CustomToolEditorProps) {
  const addTool = useCustomToolsStore((s) => s.addTool);
  const updateTool = useCustomToolsStore((s) => s.updateTool);
  const storeError = useCustomToolsStore((s) => s.lastError);
  const saving = useCustomToolsStore((s) => s.saving);

  const isEditing = existing !== undefined;

  // Local draft state. Stored as a JSON string so the user
  // can edit the raw shape, including headers (an object)
  // and argsSpec (an array of objects).
  const [draft, setDraft] = useState<string>(() => {
    if (existing) {
      return JSON.stringify(existing, null, 2);
    }
    return JSON.stringify(SHELL_TEMPLATE, null, 2);
  });
  const [parseError, setParseError] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Focus the textarea when the editor opens so the user
  // can start typing immediately.
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  // Re-validate the draft when the user types.
  const onDraftChange = useCallback(
    (next: string) => {
      setDraft(next);
      if (parseError) setParseError(null);
      if (validationError) setValidationError(null);
    },
    [parseError, validationError],
  );

  // Replace the current draft with a fresh template of the
  // chosen kind. Used to "Insert template" or when the user
  // switches the kind via the dropdown.
  const loadTemplate = useCallback((kind: LipiToolKind) => {
    const template = kind === 'shell' ? SHELL_TEMPLATE : HTTP_TEMPLATE;
    setDraft(JSON.stringify(template, null, 2));
    setParseError(null);
    setValidationError(null);
  }, []);

  const onSave = useCallback(async () => {
    // Step 1: parse the JSON. A bad paste must not be saved
    // to disk.
    let parsed: unknown;
    try {
      parsed = JSON.parse(draft);
    } catch (err) {
      setParseError(
        err instanceof Error
          ? `Invalid JSON: ${err.message}`
          : 'Invalid JSON.',
      );
      return;
    }

    // Step 2: shape-check. We don't trust the JSON.parse
    // result to be a `LipiToolEntry` — the runtime validator
    // inside the store does the real check. But if the
    // top-level shape is wrong (e.g. it's an array or null),
    // we want a clearer error than what the store would give.
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      setValidationError(
        'A tool definition must be a JSON object, not an array or primitive.',
      );
      return;
    }

    // Step 3: hand off to the store, which calls
    // `validateEntry` + `write_lipi_tools` IPC. The
    // store's `addTool` / `updateTool` return
    // `Promise<void>`; on failure they set
    // `lastError` and don't throw. We close
    // optimistically and re-open if the user
    // clicks "Save" again — the store's state is
    // unchanged on a failed save.
    setValidationError(null);
    // Clear the previous error so a fresh attempt
    // doesn't immediately re-surface a stale message.
    if (storeError) {
      useCustomToolsStore.setState({ lastError: null });
    }
    if (isEditing && existing) {
      await updateTool(parsed as LipiToolEntry, existing.name);
    } else {
      await addTool(parsed as LipiToolEntry);
    }
    // After the await, re-read the store to see if
    // the call succeeded (lastError is null on
    // success).
    const errAfter = useCustomToolsStore.getState().lastError;
    if (errAfter === null) {
      onClose(true);
    } else {
      setValidationError(errAfter);
    }
  }, [
    addTool,
    draft,
    existing,
    isEditing,
    onClose,
    storeError,
    updateTool,
  ]);

  const onCancel = useCallback(() => {
    onClose(false);
  }, [onClose]);

  // Detect the kind from the draft (best-effort) so we can
  // show the right "Insert template" affordance and a hint
  // about which fields are required.
  const detectedKind = useMemo<LipiToolKind | null>(() => {
    try {
      const parsed = JSON.parse(draft);
      if (
        typeof parsed === 'object' &&
        parsed !== null &&
        !Array.isArray(parsed) &&
        (parsed as { kind?: unknown }).kind === 'shell'
      ) {
        return 'shell';
      }
      if (
        typeof parsed === 'object' &&
        parsed !== null &&
        !Array.isArray(parsed) &&
        (parsed as { kind?: unknown }).kind === 'http'
      ) {
        return 'http';
      }
    } catch {
      // Bad JSON — no kind detectable.
    }
    return null;
  }, [draft]);

  return (
    <div className={styles.editor} role="dialog" aria-label="Edit custom tool">
      <Stack direction="column" gap={3}>
        <div className={styles.editorHeader}>
          <h3 className={styles.editorTitle}>
            {existing ? `Edit ${existing.name}` : 'New custom tool'}
          </h3>
          <IconButton
            variant="subtle"
            size="sm"
            onClick={onCancel}
            aria-label="Close editor"
            title="Close"
          >
            ×
          </IconButton>
        </div>
        <p className={styles.editorHint}>
          Edit the JSON below. Shell tools need{' '}
          <code>command</code> + <code>args</code>; HTTP
          tools need <code>url</code> + optional{' '}
          <code>method</code> / <code>headers</code> /{' '}
          <code>body</code>. <code>argsSpec</code> declares
          the model-callable arguments and is required for
          any placeholder substitution (<code>
            {'{name}'}
          </code>) in <code>command</code> / <code>args</code>{' '}
          / <code>url</code>.
        </p>
        <div className={styles.editorToolbar}>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => loadTemplate('shell')}
          >
            Shell template
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => loadTemplate('http')}
          >
            HTTP template
          </Button>
          {detectedKind && (
            <span className={styles.editorKind}>
              Detected kind: <code>{detectedKind}</code>
            </span>
          )}
        </div>
        <textarea
          ref={textareaRef}
          className={styles.editorTextarea}
          value={draft}
          onChange={(e) => onDraftChange(e.target.value)}
          spellCheck={false}
          rows={18}
          aria-label="Custom tool JSON"
        />
        {parseError && (
          <span className={styles.editorError} role="alert">
            {parseError}
          </span>
        )}
        {validationError && (
          <span className={styles.editorError} role="alert">
            {validationError}
          </span>
        )}
        {storeError && !validationError && (
          <span className={styles.editorError} role="alert">
            {storeError}
          </span>
        )}
        <div className={styles.editorActions}>
          <Button
            variant="ghost"
            size="md"
            onClick={onCancel}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            size="md"
            onClick={() => void onSave()}
            loading={saving}
            disabled={saving}
          >
            Save
          </Button>
        </div>
      </Stack>
    </div>
  );
}
