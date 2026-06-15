/**
 * useMonacoLspBridge — the Monaco glue for the
 * Phase 9 (Tiniest scope) real
 * `typescript-language-server` integration.
 *
 * The hook takes the live typedEditor instance (passed
 * from `EditorPane.handleMount`) and:
 *
 *   1. Looks up the `LspClient` for the active
 *      workspace (or creates one via
 *      `lspClientStore.getOrCreate`).
 *   2. Subscribes to Monaco's `onDidChangeModelContent`
 *      and sends `textDocument/didChange` to the
 *      server for every edit.
 *   3. Subscribes to the typedEditor's `onDidChangeModel`
 *      and sends `textDocument/didClose` for the
 *      old model + `didOpen` for the new one.
 *   4. Calls the `registerLspProviders` helper to
 *      wire up the per-method providers (definition,
 *      references, rename, hover, etc.). The returned
 *      `IDisposable[]` is held in a ref and disposed
 *      on typedEditor unmount / workspace switch.
 *   5. Reads the kill switch (`getUseRealServer`)
 *      and is a no-op when the user has disabled the
 *      real server.
 *
 * Per Rule 6 (section isolation) the hook is the
 * ONLY place that wires the `LspClient` to a
 * specific Monaco instance. The `lspClientStore` is
 * monaco-agnostic; the providers are lsp-monaco-
 * agnostic. The bridge is the seam.
 *
 * Per Rule 3 (screen-folder layout) the hook lives
 * in `src/screens/EditorWorkspace/hooks/`, not in
 * `src/shared/hooks/` — only the EditorPane uses it.
 *
 * ## Keying
 *
 * The hook is keyed by `(typedEditor, workspaceRoot,
 * modelUri)` via the `useEffect` deps. A workspace
 * switch tears down the old providers (the
 * effect's cleanup function disposes them) and the
 * old model subscription, then sets up the new
 * ones. A `monaco.editor.ITextModel`'s URI is
 * stable for its lifetime; using it as a dep
 * means re-mounts only happen on actual model
 * changes, not on content edits.
 */
import { useEffect, useRef } from 'react';
import * as monaco from 'monaco-editor';

import { useWorkspaceStore } from '@/shared/state/workspaceStore';
import { useLspClientStore } from '../state/lspClientStore';
import { getUseRealServer } from '../state/lspKillSwitch';
import {
  registerLspProviders,
  sendDidChange,
  sendDidOpen,
} from './lspProviders';

interface UseMonacoLspBridgeOptions {
  /**
   * The live Monaco editor instance. Typed
   * as `unknown` (per the codebase's
   * monaco-agnostic Zustand-store
   * convention — see `editorControllerStore`)
   * and cast to `IStandaloneCodeEditor` at
   * the call site. The bridge is a no-op
   * when `editor` is `null` or not a
   * well-formed editor instance.
   */
  editor: unknown;
}

export function useMonacoLspBridge({
  editor,
}: UseMonacoLspBridgeOptions): void {
  // The bridge reads the active workspace root
  // from the shared `workspaceStore` (same
  // source of truth as the rest of the editor).
  // Reading via the store (vs. a prop) keeps the
  // `ActiveEditor` signature tight and avoids
  // threading a 4th prop through `EditorPane`.
  const workspaceRoot = useWorkspaceStore((s) =>
    s.activeId ? s.workspaces.find((w) => w.id === s.activeId)?.path ?? null : null,
  );
  // Stable ref to the per-instance disposables.
  // The hook tears them down on cleanup (tab
  // switch, workspace close).
  const disposablesRef = useRef<monaco.IDisposable[] | null>(null);

  useEffect(() => {
    if (!editor || !workspaceRoot) return;
    // Cast the store's `unknown` editor to
    // Monaco's typed shape. The store uses
    // `unknown` to stay monaco-agnostic (see
    // `editorControllerStore`); the bridge is
    // the seam that knows it's actually an
    // `IStandaloneCodeEditor`.
    const typedEditor = editor as monaco.editor.IStandaloneCodeEditor | null;
    if (!typedEditor) return;
    // Kill switch: bail out if the user has
    // disabled the real server. The Phase 7
    // built-in TS service stays in place.
    if (!getUseRealServer()) return;

    // Get-or-create the LspClient for this
    // workspace. The first call spawns the
    // child + runs the `initialize` handshake;
    // subsequent calls return the same client.
    let cancelled = false;
    const startBridge = async (): Promise<void> => {
      let client;
      try {
        client = await useLspClientStore
          .getState()
          .getOrCreate(workspaceRoot);
      } catch (e) {
        // Spawn or `initialize` failed. The
        // store has already flipped the
        // status to `error` and removed the
        // client; the settings card will show
        // the install hint. The Phase 7
        // built-in TS service stays in place
        // for this session.
        if (import.meta.env.DEV) {
          console.warn(
            '[lspBridge] failed to start LSP client:',
            e,
          );
        }
        return;
      }
      if (cancelled) return;

      const model = typedEditor.getModel();
      if (!model) return;

      // Register the per-method providers.
      // We use a DocumentSelector keyed by the
      // model's language (typescript /
      // typescriptreact / javascript /
      // javascriptreact). The provider only
      // fires for files the server supports.
      const disposables = registerLspProviders(
        client,
        monaco,
        [model.getLanguageId()],
      );
      disposablesRef.current = disposables;

      // Send `didOpen` for the current model.
      try {
        await sendDidOpen(
          client,
          model,
          model.getLanguageId(),
        );
      } catch {
        // Notification failed — usually means
        // the child died between the
        // `initialize` and the first
        // `didOpen`. The next didChange /
        // didClose attempts will also fail,
        // and Monaco will fall through to
        // its built-in. Don't tear down the
        // providers — the user might restart
        // the server from the settings card.
      }
    };
    void startBridge();

    // Wire up the model-content subscription
    // for `didChange`. We re-send the full
    // content (LSP supports incremental
    // changes, but Monaco's
    // `onDidChangeModelContent` event only
    // gives us the new full text — see
    // `lspProviders.sendDidChange` for the
    // rationale).
    const changeSub = typedEditor.onDidChangeModelContent(async () => {
      if (cancelled) return;
      const client = useLspClientStore
        .getState()
        .clients.get(workspaceRoot);
      const model = typedEditor.getModel();
      if (!client || !model) return;
      try {
        await sendDidChange(client, model);
      } catch {
        // Swallow — see the didOpen branch
        // for the rationale.
      }
    });

    // Wire up the model-swap subscription
    // for `didClose` (old model) + `didOpen`
    // (new model). Monaco fires this when
    // the user switches to a different file
    // (we tear down + re-set up providers
    // via the `useEffect` deps on the
    // model URI).
    const modelSub = typedEditor.onDidChangeModel(async (e: monaco.editor.IModelChangedEvent) => {
      if (cancelled) return;
      const client = useLspClientStore
        .getState()
        .clients.get(workspaceRoot);
      if (!client) return;
      // Close the old model. `IModelChangedEvent`
      // only gives us the URI (not the model
      // itself — it may have already been
      // disposed). We send the URI string.
      if (e.oldModelUrl) {
        try {
          await client.notify('textDocument/didClose', {
            textDocument: { uri: e.oldModelUrl.toString() },
          });
        } catch {
          // ignore
        }
      }
      // Open the new model.
      const newModel = typedEditor.getModel();
      if (newModel) {
        try {
          await sendDidOpen(
            client,
            newModel,
            newModel.getLanguageId(),
          );
        } catch {
          // ignore
        }
      }
    });

    return () => {
      cancelled = true;
      changeSub.dispose();
      modelSub.dispose();
      if (disposablesRef.current) {
        for (const d of disposablesRef.current) {
          try {
            d.dispose();
          } catch {
            // ignore
          }
        }
        disposablesRef.current = null;
      }
    };
  }, [editor, workspaceRoot]);
}
