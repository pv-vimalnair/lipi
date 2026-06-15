/**
 * useMonacoLspBridge — the Monaco glue for the
 * Phase 9 (Tiniest scope) real
 * `typescript-language-server` integration.
 *
 * Phase 9.2f — multi-client aggregator. The
 * bridge tracks *every* open Monaco model
 * (not just the focused one) and routes LSP
 * traffic to the right `(root, kind)` client:
 *
 *   - `didOpen` is sent for each model on
 *     create (the right client per kind).
 *   - `didChange` is sent on every
 *     `onDidChangeModelContent` (debounced
 *     implicitly by Monaco's batching — see
 *     Phase 9.1).
 *   - `didClose` is sent on every
 *     `onWillDispose` (a tab was closed).
 *   - One provider set is registered *per
 *     supported kind* (typescript,
 *     rust_analyzer, pyright) using each
 *     kind's `DocumentSelector` (the
 *     `languageId`s Monaco returns for files
 *     the kind handles). Monaco's provider
 *     registry routes to the right provider
 *     per file based on the `DocumentSelector`
 *     match.
 *
 * The bridge is a no-op when:
 *   - `editor` is `null` (before first
 *     mount, or after a tab switch in the
 *     pre-9.2f `EditorPane` design).
 *   - The per-kind kill switch is OFF for
 *     the file's kind (Phase 9.2e).
 *   - The active workspace has no root
 *     (no `workspaceStore.activeId`).
 *
 * Per Rule 6 (section isolation) the hook is
 * the ONLY place that wires the `LspClient`
 * to a specific Monaco instance. The
 * `lspClientStore` is monaco-agnostic; the
 * providers are lsp-monaco-agnostic. The
 * bridge is the seam.
 *
 * Per Rule 3 (screen-folder layout) the hook
 * lives in
 * `src/screens/EditorWorkspace/hooks/`, not
 * in `src/shared/hooks/` — only the
 * EditorPane uses it.
 *
 * ## Phase 9.2f migration notes
 *
 * The pre-9.2f bridge keyed its effect on
 * `(editor, workspaceRoot, clientHandleId)`
 * and re-ran on every `(root, kind)`
 * change — tearing down old providers +
 * subscriptions and setting up new ones.
 * The 9.2f bridge keys on
 * `(editor, workspaceRoot)` and tracks
 * *all* open models internally. A
 * `(root, kind)` change no longer
 * causes a re-run (the bridge registers
 * providers for *every* supported kind
 * up front, and dispatches traffic
 * per-model on demand). The
 * `lspClientStore` still re-creates clients
 * on respawn (Phase 9.5), so the
 * bridge's per-model client ref is
 * re-derived lazily on each `didChange` /
 * `didClose` (cheap — one `Map.get`).
 *
 * The current `EditorPane` design
 * (`key={activeTab.id}`) still remounts
 * the editor on every tab switch — the
 * aggregator handles this correctly:
 * unmount tears down *all* per-model
 * subscriptions and provider sets, and
 * the next mount discovers the new
 * editor's model(s) from scratch. A
 * future `EditorPane` refactor that
 * keeps a single Monaco instance
 * across tab switches (with manual
 * `editor.setModel()` calls) is the
 * "5 tabs / 4 different kinds live at
 * once" case the aggregator is built
 * for — no bridge change needed.
 */
import { useEffect } from 'react';
import * as monaco from 'monaco-editor';

import { useWorkspaceStore } from '@/shared/state/workspaceStore';
import {
  useLspClientStore,
  workspaceKindKey,
  SUPPORTED_LSP_SERVER_KINDS,
  KIND_TO_LANGUAGE_IDS,
  inferServerKind,
  isSupportedKind,
  type LspServerKind,
  type LspClient,
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
  const workspaceRoot = useWorkspaceStore((s) =>
    s.activeId ? s.workspaces.find((w) => w.id === s.activeId)?.path ?? null : null,
  );

  useEffect(() => {
    if (!editor || !workspaceRoot) return;
    const typedEditor = editor as monaco.editor.IStandaloneCodeEditor | null;
    if (!typedEditor) return;

    // Phase 9.2e — global kill switch for the
    // bridge. If *every* supported kind is
    // off, the bridge is a no-op (no clients,
    // no providers). If at least one kind is
    // on, the bridge registers providers for
    // the enabled kinds; per-model traffic is
    // gated on the *file's* kind's kill
    // switch (handled in the per-model
    // subscription below).
    const anyKindEnabled = SUPPORTED_LSP_SERVER_KINDS.some(
      (k) => k !== 'unknown' && getUseRealServer(k),
    );
    if (!anyKindEnabled) return;

    // `cancelled` is set on unmount. Async
    // work (the per-model `getOrCreate` +
    // `didOpen` round-trip) checks `cancelled`
    // before mutating the per-model map and
    // before sending the notification.
    let cancelled = false;

    /**
     * Per-model state. The key is the model's
     * `uri.toString()` (a stable identity for
     * the lifetime of the model — Monaco
     * guarantees the URI doesn't change). The
     * value carries the per-model
     * `IDisposable` subscriptions (for
     * `onDidChangeModelContent` + the
     * `onWillDispose` hook we install below)
     * so the cleanup function can tear them
     * down on model dispose.
     */
    interface ModelState {
      model: monaco.editor.ITextModel;
      kind: LspServerKind;
      contentSub: monaco.IDisposable;
      willDisposeSub: monaco.IDisposable;
    }
    const modelStates = new Map<string, ModelState>();
    // Per-kind provider-set disposables. The
    // bridge registers one `registerLspProviders`
    // call per supported kind using
    // `KIND_TO_LANGUAGE_IDS[kind]` as the
    // selector. Monaco's provider registry
    // routes to the right set per file.
    const providerDisposables = new Map<LspServerKind, monaco.IDisposable[]>();

    /**
     * Spawn the LspClient for a kind (if not
     * already alive), then send `didOpen`
     * for the model to that client. Called
     * from the initial discovery pass +
     * from the `onDidCreateModel`
     * subscription. Idempotent — if a
     * client is already in the store for
     * `(root, kind)`, we use it; if not,
     * we `getOrCreate` (which spawns +
     * runs the `initialize` handshake).
     */
    const openModelOnClient = async (
      model: monaco.editor.ITextModel,
      kind: LspServerKind,
    ): Promise<void> => {
      if (cancelled) return;
      // Per-kind kill switch. If the user
      // disabled the `pyright` kind, we
      // don't send `didOpen` to the
      // pyright client for a `.py` file.
      if (!getUseRealServer(kind)) return;
      const client = await useLspClientStore
        .getState()
        .getOrCreate(workspaceRoot, kind);
      if (cancelled) return;
      try {
        await sendDidOpen(client, model, model.getLanguageId());
      } catch {
        // Notification failed — usually
        // means the child died between
        // `initialize` and the first
        // `didOpen`. The store will flip
        // the status to `error` and
        // schedule a respawn. Don't tear
        // down providers — the user might
        // restart the server from the
        // settings card.
      }
    };

    /**
     * Send `didClose` to the kind's client
     * and tear down the per-model
     * subscriptions. Called from the
     * `onWillDispose` subscription.
     */
    const closeModelOnClient = async (
      uri: string,
      kind: LspServerKind,
    ): Promise<void> => {
      // Look up the client *now* (lazily,
      // at dispose time) so a respawn that
      // happened between open and close is
      // reflected. If the client is gone
      // (e.g. the user disposed the
      // workspace), the lookup returns
      // `null` and we skip the
      // notification.
      const client: LspClient | undefined = useLspClientStore
        .getState()
        .clients.get(workspaceKindKey(workspaceRoot, kind));
      if (client) {
        try {
          await client.notify('textDocument/didClose', {
            textDocument: { uri },
          });
        } catch {
          // ignore
        }
      }
    };

    /**
     * Hook a model's lifecycle: subscribe
     * to its `onDidChangeModelContent` +
     * `onWillDispose`. Stores the
     * subscriptions in `modelStates` so
     * the cleanup function can dispose
     * them. Triggers the `didOpen` on
     * the kind's client (fire-and-forget
     * async — the model's editor is
     * already showing the content; the
     * LSP server just needs to know
     * about the file).
     */
    const hookModel = (model: monaco.editor.ITextModel): void => {
      const uri = model.uri.toString();
      if (modelStates.has(uri)) return; // already hooked
      const kind: LspServerKind = inferServerKind(uri);
      if (!isSupportedKind(kind)) return;
      // Subscribe to the model's content
      // changes. Phase 9.1 — send
      // incremental
      // `TextDocumentContentChangeEvent`s
      // (Monaco's `changes[]`).
      const contentSub = model.onDidChangeContent(
        async (event: monaco.editor.IModelContentChangedEvent) => {
          if (cancelled) return;
          // Per-kind kill switch — if the
          // user disabled *this* kind, the
          // model is open in Monaco but not
          // on a server. The provider
          // registry routes to the built-in
          // service.
          if (!getUseRealServer(kind)) return;
          const c = useLspClientStore
            .getState()
            .clients.get(workspaceKindKey(workspaceRoot, kind));
          if (!c) return;
          try {
            await sendDidChange(c, model, event);
          } catch {
            // Swallow — see the didOpen branch
            // for the rationale.
          }
        },
      );
      // Subscribe to the model's dispose
      // (tab close, model GC). Sends
      // `didClose` to the kind's client
      // and tears down the per-model
      // subscriptions.
      const willDisposeSub = model.onWillDispose(() => {
        if (cancelled) return;
        const state = modelStates.get(uri);
        if (state) {
          try {
            state.contentSub.dispose();
          } catch {
            // ignore
          }
          modelStates.delete(uri);
        }
        void closeModelOnClient(uri, kind);
      });
      modelStates.set(uri, {
        model,
        kind,
        contentSub,
        willDisposeSub,
      });
      // Fire-and-forget the `didOpen`.
      void openModelOnClient(model, kind);
    };

    /**
     * Discover all currently-open models
     * and hook them. Called once at bridge
     * mount. The bridge uses
     * `monaco.editor.getModels()` — the
     * *global* model registry — not the
     * single editor's model, so all open
     * tabs across the pane (or future
     * panes) are tracked.
     */
    const discoverAndHookAllModels = (): void => {
      const allModels = monaco.editor.getModels();
      for (const m of allModels) {
        hookModel(m);
      }
    };

    // Register a provider set per supported
    // kind. The selector is the kind's
    // `languageId`s (e.g. `['rust']` for
    // `rust_analyzer`); Monaco's registry
    // routes to the right set per file.
    // We skip kinds that are kill-switched
    // off at mount time — a per-kind
    // re-mount on kill-switch flip is the
    // card's responsibility, not the
    // bridge's.
    //
    // The per-kind provider registration is
    // *async*: `registerLspProviders` needs a
    // live `LspClient` (the providers capture
    // it in their closures for `client.request`).
    // If no client exists yet for the kind,
    // we `getOrCreate` first (which spawns the
    // child + runs the `initialize` handshake).
    // The provider registration is fire-and-
    // forget; the bridge continues to set up
    // the other kinds in parallel.
    for (const kind of SUPPORTED_LSP_SERVER_KINDS) {
      if (kind === 'unknown') continue;
      if (!getUseRealServer(kind)) continue;
      const selector = KIND_TO_LANGUAGE_IDS[kind];
      if (selector.length === 0) continue;
      const registerForKind = async (): Promise<void> => {
        if (cancelled) return;
        let client: LspClient | undefined;
        try {
          client = await useLspClientStore
            .getState()
            .getOrCreate(workspaceRoot, kind);
        } catch (e) {
          // Spawn or `initialize` failed.
          // The store has flipped the
          // status to `error` and removed
          // the client; the settings card
          // will show the install hint.
          // The Phase 7 built-in service
          // stays in place for this kind.
          if (import.meta.env.DEV) {
            console.warn(
              '[lspBridge] failed to start LSP client for kind',
              kind,
              ':',
              e,
            );
          }
          return;
        }
        if (cancelled) return;
        // Phase 9.6: the completion
        // sub-toggle is global
        // (card-level), but each
        // per-kind provider set reads
        // it independently. If the user
        // enables completion, every
        // registered kind's providers
        // include the completion
        // provider.
        const disposables = registerLspProviders(
          client,
          monaco,
          selector as string[],
          { includeCompletion: getUseRealServerForCompletion() },
        );
        // The pre-9.2f
        // `registerLspProviders`
        // closure captures the
        // `client` reference. If the
        // client respawns (the store
        // creates a new `LspClient`
        // with a new `handleId`),
        // the provider closures
        // still point at the old
        // client. The `didChange` /
        // `didClose` dispatch
        // (which looks up the client
        // lazily on every event)
        // does the right thing on
        // respawn — the user gets
        // `didChange` on the new
        // client. The provider itself
        // still points at the old
        // client; provider respawn
        // handling is deferred to a
        // follow-up slice.
        providerDisposables.set(kind, disposables);
      };
      void registerForKind();
    }

    // Discover the currently-open models +
    // hook them. We do this synchronously
    // — the `hookModel` call is cheap
    // (creates two `IDisposable`s +
    // fires a `getOrCreate` + `didOpen`
    // async, both of which are
    // non-blocking).
    discoverAndHookAllModels();

    // Subscribe to *future* model creation.
    // Monaco fires this for every model
    // created via `monaco.editor.createModel`
    // (the `<Editor>` wrapper does this
    // for every open tab). The hook
    // attaches our content +
    // willDispose subscriptions.
    const createModelSub = monaco.editor.onDidCreateModel(
      (model: monaco.editor.ITextModel) => {
        if (cancelled) return;
        hookModel(model);
      },
    );

    return () => {
      cancelled = true;
      // Tear down the create-model
      // subscription.
      try {
        createModelSub.dispose();
      } catch {
        // ignore
      }
      // Tear down every per-model
      // subscription. The `onWillDispose`
      // hook on the model itself won't
      // fire for the bridge-level teardown
      // (the model isn't being disposed —
      // the bridge is), so we walk the
      // map and explicitly dispose each.
      for (const [, state] of modelStates) {
        try {
          state.contentSub.dispose();
        } catch {
          // ignore
        }
        try {
          state.willDisposeSub.dispose();
        } catch {
          // ignore
        }
        // Send `didClose` to the kind's
        // client for the model. We
        // resolve the client *now* (at
        // teardown time) so a
        // post-respawn client is the
        // one that gets the
        // notification. The lookup is
        // O(1) and idempotent.
        void closeModelOnClient(
          state.model.uri.toString(),
          state.kind,
        );
      }
      modelStates.clear();
      // Tear down every per-kind
      // provider set.
      for (const disposables of providerDisposables.values()) {
        for (const d of disposables) {
          try {
            d.dispose();
          } catch {
            // ignore
          }
        }
      }
      providerDisposables.clear();
    };
    // Phase 9.2f — the effect no longer
    // re-runs on `clientHandleId` change.
    // A client respawn tears down the old
    // client's `LspClient` instance and
    // creates a new one; the bridge's
    // per-model dispatch (which looks up
    // the client lazily on every event)
    // picks up the new client. Provider
    // respawn is deferred to a follow-up
    // slice (see the `registerLspProviders`
    // comment above).
  }, [editor, workspaceRoot]);
}
