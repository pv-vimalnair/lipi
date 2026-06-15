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
import {
  useLspClientStore,
  workspaceKindKey,
} from '../state/lspClientStore';
import {
  inferServerKind,
  isSupportedKind,
  type LspServerKind,
} from '../state/lspClientStore';
import {
  getUseRealServer,
  getUseRealServerForCompletion,
} from '../state/lspKillSwitch';
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
  // Phase 9.5 — also subscribe to the
  // workspace's LspClient handleId. When the
  // store respawns a crashed client, the
  // handleId changes; we re-run the effect to
  // tear down the old providers and re-register
  // fresh ones on the new client. Without this
  // dep, the bridge would keep calling
  // `client.request()` on the dead client.
  //
  // Phase 9.2d — the bridge keys on
  // `(workspaceRoot, initialKind)`. The kind
  // is inferred from the *editor's current
  // model* (the file the user has open). When
  // the user switches from a `.ts` file to a
  // `.py` file in the same workspace, the
  // kind changes, the key changes, and the
  // effect re-runs (tearing down the TS
  // providers + the TS client subscription,
  // then setting up the pyright ones). The
  // `initialKind` for the first effect run is
  // computed inside the effect body (the
  // editor may not have a model at selector-
  // call time).
  const clientHandleId = useLspClientStore((s) => {
    if (!workspaceRoot) return null;
    if (!editor) return null;
    const ed = editor as monaco.editor.IStandaloneCodeEditor;
    const model = ed.getModel();
    if (!model) return null;
    const kind = inferServerKind(model.uri.toString());
    if (!isSupportedKind(kind)) return null;
    const c = s.clients.get(workspaceKindKey(workspaceRoot, kind));
    return c?.handleId ?? null;
  });
  // Stable ref to the per-instance disposables.
  // The hook tears them down on cleanup (tab
  // switch, workspace close).
  const disposablesRef = useRef<monaco.IDisposable[] | null>(null);
  // Phase 9.5 — track the handleId of the
  // last `LspClient` we registered providers
  // against. When the store respawns a
  // crashed client, the handleId changes and
  // the `useEffect` re-runs. We use a ref
  // (not a dep) so the *initial* mount
  // doesn't double-register providers — the
  // first effect run registers against
  // handleId #1; the second effect run
  // (triggered by the dep change) sees the
  // same handleId in the ref and bails.
  const lastRegisteredHandleIdRef = useRef<string | null>(null);

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

    // Phase 9.2 — gate on the inferred
    // server kind. The bridge is multi-server
    // from day one: a `.ts` file spawns
    // `typescript-language-server`; a `.rs`
    // file spawns `rust-analyzer` (wired in
    // Phase 9.2b); a `.py` / `.pyi` file
    // spawns `pyright-langserver` (wired in
    // Phase 9.2c); a `.md` / `.json` / etc.
    // file has `serverKind === 'unknown'`
    // and we never spawn a child.
    //
    // The current build's `SUPPORTED_LSP_SERVER_KINDS`
    // is `['typescript', 'rust_analyzer',
    // 'pyright']`. The gate is a no-op for
    // the three wired paths; it's a hook
    // for future kinds (e.g. a future
    // `gopls` arm for Go would just extend
    // the supported list — no bridge change
    // needed).
    const initialModel = typedEditor.getModel();
    const initialKind: LspServerKind = initialModel
      ? inferServerKind(initialModel.uri.toString())
      : 'unknown';
    if (!isSupportedKind(initialKind)) {
      // Either 'unknown' (e.g. .md, .json)
      // or a not-yet-supported kind (a
      // future slice could add `'gopls'`
      // for Go, `'clangd'` for C++, etc.).
      // Either way, the bridge is a no-op:
      // no client spawned, no providers
      // registered, no per-workspace status
      // to render. Monaco's built-in
      // language services handle the file.
      return;
    }
    // Phase 9.2e — kill switch is per-kind.
    // Bail out if the user has disabled the
    // real server for *this kind*. A user
    // who has disabled `pyright` (e.g. they
    // don't have it installed and the
    // install hint is annoying) can still
    // use the TS or rust-analyzer servers;
    // disabling one kind doesn't affect
    // the others. The Phase 7 built-in TS
    // service stays in place for the
    // disabled kind.
    if (!getUseRealServer(initialKind)) return;

    // Get-or-create the LspClient for this
    // workspace. The first call spawns the
    // child + runs the `initialize` handshake;
    // subsequent calls return the same client.
    //
    // Phase 9.2b — pass the kind we already
    // inferred (and gated on) into the store.
    // The store uses it to pick the right
    // binary via `kindToSpawnSpec`. We pass
    // the *raw* `initialKind` (not the gated
    // version) so a future Phase 9.2c slice
    // can flip the gate without changing the
    // bridge. The gate is the bridge's
    // responsibility, not the store's; the
    // store assumes its caller already
    // decided "yes, spawn something".
    let cancelled = false;
    const startBridge = async (): Promise<void> => {
      let client;
      try {
        client = await useLspClientStore
          .getState()
          .getOrCreate(workspaceRoot, initialKind);
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

      // Phase 9.5 — `clientHandleId` is a
      // dep of this effect, so it re-runs
      // when the store creates a fresh
      // client (e.g. on respawn). On the
      // *initial* mount it ALSO re-runs:
      // first with `clientHandleId = null`
      // (subscribed value before the store
      // has a client), then again with the
      // new handleId (after `getOrCreate`
      // finishes). To avoid double-registering
      // providers in that back-to-back case,
      // check the ref: if the last
      // registration was against the same
      // handleId, bail.
      if (lastRegisteredHandleIdRef.current === client.handleId) {
        return;
      }
      lastRegisteredHandleIdRef.current = client.handleId;

      const model = typedEditor.getModel();
      if (!model) return;

      // Register the per-method providers.
      // We use a DocumentSelector keyed by the
      // model's language (typescript /
      // typescriptreact / javascript /
      // javascriptreact). The provider only
      // fires for files the server supports.
      //
      // `includeCompletion` is the Phase 9.6
      // sub-toggle. When `true`, the completion
      // provider is registered (delegating to
      // `textDocument/completion`); when `false`,
      // completion stays on Monaco's built-in
      // TS service. Default is `false` (the
      // built-in is faster on the hot path).
      const disposables = registerLspProviders(
        client,
        monaco,
        [model.getLanguageId()],
        { includeCompletion: getUseRealServerForCompletion() },
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
        // didOpen. The next didChange /
        // didClose attempts will also fail,
        // and Monaco will fall through to
        // its built-in. Don't tear down the
        // providers — the user might restart
        // the server from the settings card.
      }
    };
    void startBridge();

    // Wire up the model-content subscription
    // for `didChange`. Phase 9.1 — send
    // *incremental* `TextDocumentContentChangeEvent`s
    // (range + text per change) instead of
    // the previous full-content re-send.
    // Monaco's `onDidChangeModelContent`
    // gives us a `changes[]` of precise
    // `IModelContentChange` (range, text,
    // rangeLength), and the LSP spec accepts
    // multiple changes in one `didChange` —
    // so the wire payload drops from
    // "full file text" to "the diff" for
    // every edit. For a single keystroke
    // this is ~50 bytes vs. a 5k-line file's
    // ~50 KiB.
    const changeSub = typedEditor.onDidChangeModelContent(async (event) => {
      if (cancelled) return;
      const model = typedEditor.getModel();
      if (!model) return;
      // Phase 9.2d — the client for the
      // *current* model is at
      // `(workspaceRoot, kindOfCurrentModel)`.
      // The kind may differ from `initialKind`
      // if the user has switched files since
      // mount (we re-run via the `clientHandleId`
      // dep, which is also a function of the
      // current kind).
      const kind = inferServerKind(model.uri.toString());
      if (!isSupportedKind(kind)) return;
      const client = useLspClientStore
        .getState()
        .clients.get(workspaceKindKey(workspaceRoot, kind));
      if (!client) return;
      try {
        await sendDidChange(client, model, event);
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
      // Phase 9.2d — find the client for the
      // *current* model. The old model (if
      // any) gets a `didClose` against the
      // old client; the new model gets a
      // `didOpen` against the new client.
      // If the user is switching kinds
      // (e.g. `.ts` → `.py`), each side
      // talks to a different client.
      const newModel = typedEditor.getModel();
      const newKind: LspServerKind = newModel
        ? inferServerKind(newModel.uri.toString())
        : 'unknown';
      const newClient = isSupportedKind(newKind)
        ? useLspClientStore
            .getState()
            .clients.get(workspaceKindKey(workspaceRoot, newKind)) ?? null
        : null;
      if (!newClient) return;
      // Close the old model. `IModelChangedEvent`
      // only gives us the URI (not the model
      // itself — it may have already been
      // disposed). We send the URI string. The
      // `didClose` for the old model goes to the
      // *old* client's kind (the one inferred
      // from `oldModelUrl`), not the new model's
      // kind. If the user is staying on the same
      // kind (e.g. `.ts` → another `.ts`), this
      // is the same client; if the user is
      // switching kinds (`.ts` → `.py`), this
      // is the old client and `newClient` is a
      // different one.
      if (e.oldModelUrl) {
        const oldKind = inferServerKind(
          e.oldModelUrl.toString(),
        );
        const oldClient = isSupportedKind(oldKind)
          ? useLspClientStore
              .getState()
              .clients.get(
                workspaceKindKey(workspaceRoot, oldKind),
              ) ?? null
          : null;
        if (oldClient) {
          try {
            await oldClient.notify('textDocument/didClose', {
              textDocument: { uri: e.oldModelUrl.toString() },
            });
          } catch {
            // ignore
          }
        }
      }
      // Open the new model on the *new* client.
      if (newModel) {
        try {
          await sendDidOpen(
            newClient,
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
    // `clientHandleId` is the Phase 9.5 dep —
    // when the store respawns a crashed
    // client, the handleId changes and the
    // effect re-runs, tearing down the
    // dead-client providers and re-registering
    // on the new client.
  }, [editor, workspaceRoot, clientHandleId]);
}
