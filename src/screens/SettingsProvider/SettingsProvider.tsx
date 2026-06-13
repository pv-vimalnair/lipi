import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import { Stack } from '@/shared/components/Stack';
import { Button } from '@/shared/components/Button';
import { IconButton } from '@/shared/components/IconButton';
import { Switch } from '@/shared/components/Switch';
import {
  aiGetConfiguredProviders,
  aiListProviders,
  type ProviderInfo,
} from '@/ipc';
import {
  SecretError,
  secretsDeleteApiKey,
  secretsGetApiKey,
  secretsHasApiKey,
  secretsSetApiKey,
} from '@/ipc';
import { useAppStore } from '@/shared/state/appStore';
import { useWorkspaceStore, workspaceSelectors } from '@/shared/state/workspaceStore';
import { useToolSettingsStore, toolSettingsSelectors } from '@/shared/state/toolSettingsStore';
import { useCustomToolsStore } from '@/shared/state/customToolsStore';
import { useGitStore } from '@/screens/EditorWorkspace/state/gitStore';
import { useChatNavStore } from '@/shared/state/chatNavStore';
import { TitleBar } from '@/screens/EditorWorkspace/components/TitleBar';
import { listTools, type RegisteredTool } from '@/screens/EditorWorkspace/state/toolRegistry';
import {
  buildSettingsFile,
  parseSettingsFile,
  serialiseSettingsFile,
  suggestFilename,
} from '@/shared/settingsIO';
import { CustomToolEditor } from './CustomToolEditor';
import { OnDeviceCard } from './components/OnDeviceCard';
import { WebSpeechCard } from './components/WebSpeechCard';
import { NativeDictationCard } from './components/NativeDictationCard';
import { PrivacyDataCard } from './components/PrivacyDataCard';
import { LicenseCard } from './components/LicenseCard';
import type { LipiToolEntry } from '@/ipc';
import styles from './SettingsProvider.module.css';

/**
 * SettingsProvider — the AI provider configuration screen (Phase 5a)
 * + the per-tool settings section (Phase 5b-7)
 * + the custom tools section (Phase 5c).
 *
 * The screen has three sections, rendered top-to-bottom:
 *   1. **AI Providers** (5a): one card per supported AI
 *      provider. The user can:
 *      - See whether the provider has a key in the OS keychain
 *        ("Configured" / "Not configured" badge — no value ever
 *        returned to JS).
 *      - Paste a new key, click Save, and the key is written to
 *        the keychain. The input field clears immediately.
 *      - Click "Remove key" to delete the keychain entry.
 *      - Click the "Get a key →" link to open the provider's
 *        key-management page in the OS browser.
 *
 *   2. **AI Tools** (5b-7): one card per built-in tool
 *      (read from the JS `toolRegistry`). The user can
 *      opt in/out via a `Switch`. Disabled tools are
 *      invisible to the model (the Rust side filters the
 *      `tools: [...]` array sent to the provider; the
 *      JS-side executor also refuses to run a disabled
 *      tool — belt-and-braces).
 *
 *   3. **Custom Tools** (5c): one card per user-defined
 *      tool from `<workspace>/lipi-tools.json`. The user
 *      can add / edit / delete tools via a JSON-textarea
 *      editor. The "Add custom tool" button opens the
 *      editor with a starter template; editing an
 *      existing tool pre-fills the editor.
 *
 * Per Rule 6, the screen does NOT import `@tauri-apps/api/core`
 * directly — it goes through `@/ipc`. Per Rule 4, all UI is
 * built from `src/shared/components/`. Per Rule 3, the
 * screen is self-contained in its own folder.
 */
export function SettingsProvider() {
  const setActiveScreen = useAppStore((s) => s.setActiveScreen);
  // M6a: read the active path via
  // the `useActivePath` selector.
  const currentPath = useWorkspaceStore(workspaceSelectors.currentPath);
  const isDev = import.meta.env.DEV;

  const onBack = useCallback(() => {
    // Go back to the base
    // screen that the user
    // came from. If they
    // haven't opened a
    // folder yet, that's
    // the Welcome screen;
    // otherwise, the
    // editor.
    setActiveScreen(currentPath === null ? 'welcome' : 'editor');
  }, [setActiveScreen, currentPath]);

  return (
    <div className={styles.root} data-viewport="desktop">
      <div className={styles.desktop}>
        <TitleBar subtitle={isDev ? 'dev · phase M2c mobile' : undefined} showSettingsButton={false} />
        <main className={styles.main}>
          <header className={styles.header}>
            <IconButton
              variant="subtle"
              size="md"
              onClick={onBack}
              aria-label="Back to editor"
              title="Back to editor"
            >
              ←
            </IconButton>
            <h1 className={styles.title}>AI Providers</h1>
          </header>
          <p className={styles.lede}>
            Lipi calls the AI provider of your choice directly from your
            machine — no Lipi server, no proxy. Your API keys are stored in
            the operating system keychain (Windows Credential Manager /
            macOS Keychain / Linux Secret Service) and never leave your
            device.
          </p>
          <ProviderCards />
          {/* M2b: a separate Voice section. The Wispr
              API key is stored in the same OS keychain
              as the AI provider keys, but it's owned
              by a separate "voice" domain (its own
              IPC provider id, `wispr`) so a future
              on-device STT key (M2c) and any other
              voice provider don't have to share a
              slot with AI providers. The card is a
              near-clone of `ProviderCard` with no
              "Get a key" link (Wispr is enterprise
              approval only — the link is to the
              approval request form, not a key
              management page) and a "Test connection"
              button that warms up the WS endpoint. */}
          <h2 className={styles.sectionHeading}>Voice</h2>
          <p className={styles.sectionLede}>
            Voice input is opt-in and requires a Wispr Flow API key. Wispr is
            code-aware dictation (it understands that &ldquo;snake case&rdquo;
            is a word, that &ldquo;open bracket&rdquo; is punctuation, etc.) and
            can be the difference between a transcript you can send and a
            transcript you have to clean up. Set the key here, then click the
            mic in the AI panel to start talking. The key is stored in your
            OS keychain, never sent to any server other than Wispr&apos;s, and
            dropped from memory when you stop recording.
          </p>
          <WisprCard />
          <h3 className={styles.subSectionHeading}>
            Or use on-device speech-to-text
          </h3>
          <p className={styles.sectionLede}>
            On-device STT runs entirely on your machine — no audio ever
            leaves your computer. Pick a model below; the first install
            downloads a one-time model file (~75–150 MB), and subsequent
            recordings are 100% local and offline. Switch the active
            provider from the Command Palette
            (search for &ldquo;voice provider&rdquo;).
          </p>
          <OnDeviceCard />
          {/* M2c mobile: the Web Speech shim.
              Mirrors the OnDeviceCard "or use…"
              shape — hidden behind its own
              subsection so the privacy
              implication ("audio leaves the
              device") is impossible to miss.
              The card reads the
              `useVoiceCapabilitiesStore` for
              availability; if the WebView
              doesn't expose `SpeechRecognition`
              (Linux WebKitGTK), the card shows
              "Not available on this platform"
              and hides the toggle. See Decision
              #46 Q3. */}
          <h3 className={styles.subSectionHeading}>
            Or use the browser&rsquo;s built-in speech engine
          </h3>
          <p className={styles.sectionLede}>
            The WebView&rsquo;s <code>SpeechRecognition</code> API
            is available on Chromium-based WebViews (Windows,
            macOS) and on WKWebView (iOS). The browser sends your
            audio to its own server (Google on Chromium, Apple on
            WebKit) for transcription — the audio does not stay
            on your machine. Choose this if you don&rsquo;t want
            to download a Whisper model.
          </p>
          <WebSpeechCard />
          {/* Phase NPS: native-dictation plugin
              contract. Sits below the WebSpeechCard
              and above the AI Tools section so the
              voice-stt options stack is
              on-device → browser speech → native
              dictation (iOS / Android only). On
              desktop the card reads
              `status: 'not-applicable'` and shows
              the iOS / Android-only blurb. */}
          <NativeDictationCard />
          <h2 className={styles.sectionHeading}>AI Tools</h2>
          <p className={styles.sectionLede}>
            The AI can use these built-in tools to help with your code.
            Disabling a tool hides it from the model — the model won&apos;t
            know it exists and won&apos;t try to call it. Your choices are
            saved locally and persist across restarts.
          </p>
          <ToolSettingsCards />
          <h2 className={styles.sectionHeading}>Custom Tools</h2>
          <p className={styles.sectionLede}>
            Custom tools let you teach the AI new abilities for the current
            workspace. Two kinds are supported: <code>shell</code> (runs a
            command) and <code>http</code> (calls a URL). Definitions live
            in <code>lipi-tools.json</code> at the workspace root and are
            version-controlled alongside the code.
          </p>
          <CustomToolsCards />
          {/* 5e: per-decision activity
              log. Observational only —
              shows the last 500
              `[Deny] / [Run once] /
              [Always allow]` clicks
              (most recent first), with
              timestamps and a
              truncated args preview. */}
          <h2 className={styles.sectionHeading}>Activity Log</h2>
          <p className={styles.sectionLede}>
            Recent tool-call decisions made on confirmation prompts.
            Capped at the last 500. Stale prompts (the chat was
            cancelled while you were deciding) are not recorded.
          </p>
          <DecisionLogCards />
          {/* 5b: backup & restore — export
              the current tool settings to
              a JSON file, or import from
              one. Placed ABOVE the Danger
              Zone because it's the
              friendlier / more common
              action (regular backup, or
              transferring config to
              another machine). Import is
              destructive (it overwrites
              the current settings), but
              it goes through the same 5a
              soft-delete + 5s-undo
              pattern, so a misclick can
              be undone. The export side
              is a single-click download.
              The file format is
              documented in
              `src/shared/settingsIO.ts`. */}
          <h2 className={styles.sectionHeading}>Backup &amp; Restore</h2>
          <p className={styles.sectionLede}>
            Save your tool settings to a JSON file you can keep as a
            backup or copy to another machine. Importing overwrites
            the current settings — but the import goes through the
            same 5-second undo as the Danger Zone below.
          </p>
          <ToolSettingsBackupCard />
          {/* Phase S2: full Lipi state export /
              import. Sits below the per-decision
              (5b) backup card and above the
              per-tool (5a) danger zone. Same
              UX shape (Export / Import buttons,
              hidden file input, status
              messages) but the file is a
              schema-versioned `lipi-state` JSON
              with three top-level payloads
              (workspace, voicePreferences,
              toolSettings) and a privacy
              statement above the buttons. */}
          <PrivacyDataCard />
          {/* Phase 2: license status + deactivate
              action. The full activation flow
              lives in `src/screens/License/`; this
              card is the "manage existing
              license" view (show fingerprint,
              deactivate). */}
          <LicenseCard />
          {/* 5a: danger zone — bulk-reset
              all tool settings (which
              tools are enabled, and their
              per-tool confirmation policy).
              The reset is a soft-delete:
              clicking "Reset all" snapshots
              the current settings to
              `lipi:toolSettings:undo:v1`
              and shows a 5-second undo
              toast. After the window
              expires, the snapshot is
              dropped and the reset is
              permanent. The AI provider
              API keys (in the OS keychain)
              are NOT affected by this
              button — only the per-tool
              settings. */}
          <h2 className={styles.sectionHeading}>Danger Zone</h2>
          <p className={styles.sectionLede}>
            Bulk actions that affect your local tool settings. These
            do <em>not</em> touch your API keys — those live in your
            operating system keychain and are removed from the cards
            above.
          </p>
          <ToolSettingsResetCard />
        </main>
      </div>
    </div>
  );
}

function ProviderCards() {
  const [providers, setProviders] = useState<ProviderInfo[] | null>(null);
  const [configured, setConfigured] = useState<Set<string>>(new Set());
  const [loadError, setLoadError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [list, configuredIds] = await Promise.all([
        aiListProviders(),
        aiGetConfiguredProviders(),
      ]);
      setProviders(list);
      setConfigured(new Set(configuredIds));
      setLoadError(null);
    } catch (err) {
      setLoadError(
        err instanceof Error ? err.message : 'Failed to load providers',
      );
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (loadError) {
    return (
      <div className={styles.errorCard} role="alert">
        <span className={styles.errorTitle}>
          Couldn’t load provider list
        </span>
        <span className={styles.errorDetail}>{loadError}</span>
        <div>
          <Button variant="ghost" size="sm" onClick={() => void refresh()}>
            Retry
          </Button>
        </div>
      </div>
    );
  }

  if (!providers) {
    return (
      <div className={styles.placeholder}>
        <span>Loading providers…</span>
      </div>
    );
  }

  return (
    <Stack direction="column" gap={4}>
      {providers.map((p) => (
        <ProviderCard
          key={p.id}
          provider={p}
          configured={configured.has(p.id)}
          onChanged={() => void refresh()}
        />
      ))}
    </Stack>
  );
}

interface ProviderCardProps {
  provider: ProviderInfo;
  configured: boolean;
  onChanged: () => void;
}

type SaveState =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'saved' }
  | { kind: 'error'; message: string };

function ProviderCard({ provider, configured, onChanged }: ProviderCardProps) {
  // The key value is held in LOCAL state only. Never in a
  // store, never logged, never persisted. Cleared on
  // unmount and on successful save.
  const [draft, setDraft] = useState('');
  const [saveState, setSaveState] = useState<SaveState>({ kind: 'idle' });
  const [removing, setRemoving] = useState(false);

  const onSave = useCallback(async () => {
    if (!draft) return;
    setSaveState({ kind: 'saving' });
    try {
      await secretsSetApiKey(provider.id, draft);
      setDraft('');
      setSaveState({ kind: 'saved' });
      onChanged();
      // Auto-clear the "Saved" badge after 2s.
      setTimeout(() => {
        setSaveState((s) => (s.kind === 'saved' ? { kind: 'idle' } : s));
      }, 2000);
    } catch (err) {
      setSaveState({
        kind: 'error',
        message: err instanceof SecretError ? err.payload.detail : String(err),
      });
    }
  }, [draft, onChanged, provider.id]);

  const onRemove = useCallback(async () => {
    setRemoving(true);
    try {
      await secretsDeleteApiKey(provider.id);
      onChanged();
    } catch (err) {
      setSaveState({
        kind: 'error',
        message: err instanceof SecretError ? err.payload.detail : String(err),
      });
    } finally {
      setRemoving(false);
    }
  }, [onChanged, provider.id]);

  const onCheckHas = useCallback(async () => {
    // Used by the "Refresh" link in the error state. Re-checks
    // whether the key is in the keychain, in case the user
    // added it via the OS UI.
    try {
      const has = await secretsHasApiKey(provider.id);
      if (has) onChanged();
    } catch {
      // Already reflected in the configured badge via the
      // parent refresh; nothing to do here.
    }
  }, [onChanged, provider.id]);

  return (
    <article
      className={styles.card}
      data-configured={configured || undefined}
    >
      <header className={styles.cardHeader}>
        <div className={styles.cardTitleRow}>
          <h2 className={styles.cardTitle}>{provider.displayName}</h2>
          <span
            className={styles.badge}
            data-configured={configured || undefined}
          >
            {configured ? 'Configured' : 'Not configured'}
          </span>
        </div>
        <a
          className={styles.keyLink}
          href={provider.keyUrl}
          target="_blank"
          rel="noreferrer noopener"
        >
          Get a key →
        </a>
      </header>
      <p className={styles.cardDescription}>{provider.description}</p>
      <div className={styles.keyRow}>
        <input
          type="password"
          className={styles.keyInput}
          placeholder={
            configured
              ? 'Paste a new key to replace the saved one'
              : 'Paste your API key'
          }
          autoComplete="off"
          spellCheck={false}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            if (saveState.kind === 'error') {
              setSaveState({ kind: 'idle' });
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && draft && saveState.kind !== 'saving') {
              void onSave();
            }
          }}
          disabled={saveState.kind === 'saving'}
          aria-label={`${provider.displayName} API key`}
        />
        <Button
          variant="primary"
          size="md"
          onClick={() => void onSave()}
          loading={saveState.kind === 'saving'}
          disabled={!draft || saveState.kind === 'saving'}
        >
          Save
        </Button>
        {configured && (
          <Button
            variant="ghost"
            size="md"
            onClick={() => void onRemove()}
            loading={removing}
            disabled={removing}
          >
            Remove
          </Button>
        )}
      </div>
      {saveState.kind === 'saved' && (
        <span className={styles.statusOk} role="status">
          Saved to keychain.
        </span>
      )}
      {saveState.kind === 'error' && (
        <span className={styles.statusError} role="alert">
          {saveState.message}{' '}
          <button
            type="button"
            className={styles.statusLink}
            onClick={() => void onCheckHas()}
          >
            Retry
          </button>
        </span>
      )}
    </article>
  );
}

// --- 5b-7: AI Tools section -----------------------------------------
//
// One card per registered tool, with a `Switch`
// bound to the `toolSettingsStore`. The list
// comes from the JS `toolRegistry` (which is
// the source of truth for which tools the model
// CAN call — the Rust side just declares the
// same set so the model knows about them).
//
// The `useToolSettingsStore` is hydrated at
// app startup (in `aiStore.ts`'s module-load
// block), so by the time the user reaches the
// Settings screen, the persisted disabled-set
// is already loaded. We don't show a
// "loading" state — the registry is a
// module-level `Map` seeded synchronously at
// import time, and the store is hydrated
// synchronously at the same module load.

/**
 * The list of tool cards. Renders one card
 * per registered tool. The user can toggle
 * each tool on/off via the `Switch`; the
 * `Switch` is bound to the `toolSettingsStore`'s
 * `setEnabled` action.
 *
 * Future 5c+ tools will appear here
 * automatically — the registry is the source
 * of truth. A new built-in tool doesn't need
 * any Settings-screen changes; just register
 * it in `toolRegistry.ts` and the card will
 * show up.
 */
function ToolSettingsCards() {
  const tools = listTools();
  return (
    <Stack direction="column" gap={4}>
      {tools.map((t) => (
        <ToolCard key={t.name} tool={t} />
      ))}
    </Stack>
  );
}

interface ToolCardProps {
  tool: RegisteredTool;
}

function ToolCard({ tool }: ToolCardProps) {
  // We re-derive `enabled` on every render
  // via the store's selector — Zustand
  // subscribes the component to changes,
  // so the `Switch` re-renders automatically
  // when the user toggles (here or from any
  // other consumer of the same store).
  const enabled = useToolSettingsStore(
    (s) => !s.disabledToolNames.includes(tool.name),
  );
  const setEnabled = useToolSettingsStore((s) => s.setEnabled);
  // 5d: per-tool confirmation policy.
  // We re-derive on every render so
  // the segmented control re-paints
  // when the user picks a new policy
  // (here or from any other consumer
  // of the same store).
  const mode = useToolSettingsStore((s) =>
    toolSettingsSelectors.getConfirmationMode(s, tool.name),
  );
  const setMode = useToolSettingsStore(
    (s) => s.setConfirmationMode,
  );

  return (
    <article
      className={styles.card}
      data-configured={enabled || undefined}
    >
      <div className={styles.toolRow}>
        <div className={styles.toolText}>
          <h3 className={styles.toolName}>{tool.name}</h3>
          <p className={styles.toolDescription}>{tool.description}</p>
        </div>
        <Switch
          checked={enabled}
          onChange={(next) => setEnabled(tool.name, next)}
          aria-label={`Enable ${tool.name} tool`}
        />
      </div>
      {/* 5d: per-tool invocation
          policy. Segmented control
          with three options. Disabled
          when the tool itself is
          disabled (the policy has
          no effect on a disabled
          tool). */}
      <div
        className={styles.toolPolicy}
        data-testid={`tool-policy-${tool.name}`}
      >
        <span className={styles.toolPolicyLabel}>When called</span>
        <div
          className={styles.toolPolicyGroup}
          role="group"
          aria-label={`Confirmation policy for ${tool.name}`}
        >
          <button
            type="button"
            className={styles.toolPolicyOption}
            aria-pressed={mode === 'always_allow'}
            disabled={!enabled}
            onClick={() => setMode(tool.name, 'always_allow')}
            data-testid={`tool-policy-${tool.name}-always-allow`}
            title="Run without asking"
          >
            Always allow
          </button>
          <button
            type="button"
            className={styles.toolPolicyOption}
            aria-pressed={mode === 'per_call'}
            disabled={!enabled}
            onClick={() => setMode(tool.name, 'per_call')}
            data-testid={`tool-policy-${tool.name}-per-call`}
            title="Ask once per assistant turn"
          >
            Per call
          </button>
          <button
            type="button"
            className={styles.toolPolicyOption}
            aria-pressed={mode === 'always_confirm'}
            disabled={!enabled}
            onClick={() => setMode(tool.name, 'always_confirm')}
            data-testid={`tool-policy-${tool.name}-always-confirm`}
            title="Ask before every run"
          >
            Always confirm
          </button>
        </div>
        <span className={styles.toolPolicyHint}>
          {mode === 'always_allow' && 'Runs without asking.'}
          {mode === 'per_call' &&
            'Asks once per assistant turn; subsequent calls in the same turn are auto-approved.'}
          {mode === 'always_confirm' &&
            'Asks before every call. Best for destructive or sensitive tools.'}
        </span>
      </div>
    </article>
  );
}

// --- 5c: Custom Tools section -----------------------------------
//
// One card per user-defined custom tool,
// loaded from `<workspace>/lipi-tools.json`
// by the `customToolsStore`. The user can:
//
//   - Add a new tool (opens the
//     `CustomToolEditor` with a starter
//     template).
//   - Edit an existing tool (pre-fills
//     the editor).
//   - Delete a tool (asks for
//     confirmation — file I/O is
//     destructive).
//
// The store re-registers handlers with
// the JS `toolRegistry` on every change,
// so the `ToolSettingsCards` section
// above can show custom tools in the
// "AI Tools" list (they all share the
// same registry — no special-casing).
//
// We hydrate the store on mount via
// `useEffect`, keyed by `rootPath` —
// switching workspaces re-loads the
// file.

/**
 * The Custom Tools section. Handles its
 * own hydration (it owns the workspace
 * root via the `gitStore`). Renders the
 * editor inline as a stacked sub-card
 * below the tool list when the user
 * clicks "Add" or "Edit".
 */
function CustomToolsCards() {
  const rootPath = useGitStore((s) => s.rootPath);
  const tools = useCustomToolsStore((s) => s.tools);
  const loaded = useCustomToolsStore((s) => s.loaded);
  const lastError = useCustomToolsStore((s) => s.lastError);
  const load = useCustomToolsStore((s) => s.load);

  // Hydrate the store when the workspace
  // root changes. We only re-load if
  // (a) the root actually changed AND
  // (b) we don't already have tools for
  //     that root cached. The store keeps
  //     the in-memory list separate from
  //     disk, so this is safe to call
  //     when the user navigates away and
  //     back to the Settings screen.
  useEffect(() => {
    if (rootPath) {
      void load(rootPath);
    }
  }, [load, rootPath]);

  // The editor is the source of truth
  // for "currently editing". `null` =
  // closed. `undefined` = new tool. A
  // `LipiToolEntry` = editing that
  // existing tool.
  const [editing, setEditing] = useState<
    LipiToolEntry | null | undefined
  >(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const removeTool = useCustomToolsStore((s) => s.removeTool);

  if (!rootPath) {
    return (
      <div className={styles.placeholder}>
        <span>Open a workspace to manage custom tools.</span>
      </div>
    );
  }

  if (!loaded) {
    return (
      <div className={styles.placeholder}>
        <span>Loading custom tools…</span>
      </div>
    );
  }

  return (
    <Stack direction="column" gap={4}>
      {lastError && (
        <div className={styles.errorCard} role="alert">
          <span className={styles.errorTitle}>
            Custom tools error
          </span>
          <span className={styles.errorDetail}>{lastError}</span>
        </div>
      )}
      <div className={styles.customToolsToolbar}>
        <Button
          variant="primary"
          size="md"
          onClick={() => setEditing(undefined)}
        >
          + Add custom tool
        </Button>
        <span className={styles.customToolsPath}>
          {rootPath}/lipi-tools.json
        </span>
      </div>
      {tools.length === 0 ? (
        <div className={styles.placeholder}>
          <span>
            No custom tools yet. Click &ldquo;Add custom
            tool&rdquo; to create one.
          </span>
        </div>
      ) : (
        tools.map((t) => (
          <CustomToolCard
            key={t.name}
            tool={t}
            onEdit={() => setEditing(t)}
            onDelete={() => {
              if (deleting === t.name) {
                void removeTool(t.name).then(() => setDeleting(null));
              } else {
                setDeleting(t.name);
              }
            }}
            isConfirmingDelete={deleting === t.name}
            onCancelDelete={() => setDeleting(null)}
          />
        ))
      )}
      {editing !== null && (
        <CustomToolEditor
          existing={editing}
          onClose={() => setEditing(null)}
        />
      )}
    </Stack>
  );
}

interface CustomToolCardProps {
  tool: LipiToolEntry;
  onEdit: () => void;
  onDelete: () => void;
  isConfirmingDelete: boolean;
  onCancelDelete: () => void;
}

function CustomToolCard({
  tool,
  onEdit,
  onDelete,
  isConfirmingDelete,
  onCancelDelete,
}: CustomToolCardProps) {
  return (
    <article className={styles.card}>
      <div className={styles.toolRow}>
        <div className={styles.toolText}>
          <h3 className={styles.toolName}>{tool.name}</h3>
          <p className={styles.toolDescription}>{tool.description}</p>
          <span className={styles.customToolKind} data-kind={tool.kind}>
            {tool.kind}
          </span>
        </div>
        <div className={styles.customToolActions}>
          <Button variant="ghost" size="sm" onClick={onEdit}>
            Edit
          </Button>
          {isConfirmingDelete ? (
            <>
              <Button
                variant="primary"
                size="sm"
                onClick={onDelete}
                data-confirm="danger"
              >
                Confirm delete
              </Button>
              <Button variant="ghost" size="sm" onClick={onCancelDelete}>
                Cancel
              </Button>
            </>
          ) : (
            <Button variant="ghost" size="sm" onClick={onDelete}>
              Delete
            </Button>
          )}
        </div>
      </div>
    </article>
  );
}

// --- 5e: Decision Log section ---------------------------------------
//
// Read-only list of the user's
// recent tool-call confirmation
// decisions, sourced from the
// `useToolDecisionLogStore`. The
// store is hydrated at app startup
// (aiStore.ts module-load), so the
// list is ready by the time the user
// navigates here.
//
// UX choices:
//   - Newest first (matches user
//     mental model — "what did I
//     just do?").
//   - Render at most 50 rows in the
//     DOM at a time. The store can
//     hold up to 500; older rows
//     are off-screen but accessible
//     via the [Show older] button
//     (which expands the limit by
//     another 50). Keeps the React
//     tree small for a setting the
//     user rarely scrolls.
//   - Each row shows the relative
//     timestamp, the tool name, the
//     decision badge, and an
//     expandable args preview. The
//     `assistantMessageId` is shown
//     as muted text (for a future
//     "Jump to chat" feature).
//   - The [Clear log] button is
//     destructive and irreversible
//     in 5e (no undo toast).
//     Confirms via the native
//     `window.confirm`.

import {
  type DecisionRecord,
  useToolDecisionLogStore,
} from '@/shared/state/toolDecisionLogStore';

const DECISION_VISIBILITY_LIMIT = 50;

function DecisionLogCards(): JSX.Element {
  const records = useToolDecisionLogStore((s) => s.records);
  const clearLog = useToolDecisionLogStore((s) => s.clearLog);
  // 5f: jumping to chat from a
  // log row. We grab the chat
  // store + the screen store
  // here (NOT in the child row)
  // because the row should not
  // know about cross-screen
  // navigation. The row
  // receives a click handler;
  // the parent owns the wiring.
  const requestJump = useChatNavStore((s) => s.requestJump);
  const setActiveScreen = useAppStore((s) => s.setActiveScreen);
  // 5h: undo-clear wiring.
  // We track the
  // `lastCleared` buffer
  // and a 5-second timer
  // ref. The flow:
  //   1. User clicks Clear.
  //   2. We call
  //      `clearLog()` (the
  //      store soft-deletes
  //      into `lastCleared`).
  //   3. We start a 5s
  //      timer; the toast
  //      appears.
  //   4a. User clicks Undo
  //       in the toast →
  //       we call
  //       `undoClear()`
  //       and clear the
  //       timer.
  //   4b. Timer fires →
  //       we call
  //       `discardUndo()`
  //       to free the
  //       buffer.
  const lastCleared = useToolDecisionLogStore((s) => s.lastCleared);
  const undoClear = useToolDecisionLogStore((s) => s.undoClear);
  const discardUndo = useToolDecisionLogStore((s) => s.discardUndo);
  const undoTimerRef = useRef<number | null>(null);
  // 5h: the 5-second undo
  // window. Chosen to match
  // industry conventions
  // (Gmail's Undo Send, Notion's
  // trash, Linear's archive all)
  // — 5s is short enough that
  // the user can immediately
  // confirm the action was
  // correct, long enough that
  // the user has time to spot a
  // mistake.
  const UNDO_WINDOW_MS = 5 * 1000;
  // Clear the timer on unmount
  // (defensive — we don't
  // want a stale timer firing
  // after the user navigates
  // away from Settings).
  useEffect(() => {
    return () => {
      if (undoTimerRef.current !== null) {
        window.clearTimeout(undoTimerRef.current);
      }
    };
  }, []);
  const [visibleLimit, setVisibleLimit] = useState(
    DECISION_VISIBILITY_LIMIT,
  );
  const visible = records.slice(0, visibleLimit);
  const hasMore = records.length > visible.length;
  // 5h: replaced
  // `window.confirm` with a
  // soft-delete + undo toast.
  // The destructive action is
  // always `clearLog`; the UI
  // just offers a recovery
  // window now.
  const onClear = () => {
    if (records.length === 0) return;
    clearLog();
    // Start the undo window.
    // We don't use
    // `setTimeout` directly
    // (no cleanup signal in
    // the JSX) — we use a
    // ref so we can cancel
    // it if the user clicks
    // Undo before the
    // window expires.
    if (undoTimerRef.current !== null) {
      window.clearTimeout(undoTimerRef.current);
    }
    undoTimerRef.current = window.setTimeout(() => {
      discardUndo();
      undoTimerRef.current = null;
    }, UNDO_WINDOW_MS);
  };
  const onUndoClear = () => {
    if (undoTimerRef.current !== null) {
      window.clearTimeout(undoTimerRef.current);
      undoTimerRef.current = null;
    }
    undoClear();
  };

  // 5f: row-click jump handler.
  // The flow is:
  //   1. Write the jump intent
  //      to `chatNavStore`
  //      (the AIPanel subscribes
  //      to this).
  //   2. Switch the active
  //      screen back to
  //      `'editor'` (the AIPanel
  //      is mounted there).
  // We do these in this order so
  // the AIPanel's subscribe
  // callback fires AFTER the
  // screen has switched (and
  // the panel is actually in
  // the DOM and its ref map is
  // populated). If we did
  // setActiveScreen first, the
  // panel wouldn't be mounted
  // yet and the jump would be
  // ignored. (The AIPanel's
  // useEffect ALSO checks on
  // mount, but ordering still
  // matters for the
  // "clicked while the panel
  // is already mounted" case.)
  const onJump = (record: DecisionRecord) => {
    // 5e-era records may have a
    // missing `toolCallId`
    // (validator drops them on
    // hydrate, but defensively
    // guard at the click site
    // — a record mid-write or
    // a future code path could
    // expose this). Bail
    // silently.
    if (!record.toolCallId) return;
    requestJump({
      messageId: record.assistantMessageId,
      toolCallId: record.toolCallId,
    });
    setActiveScreen('editor');
  };

  // 5g: revert-allow_always
  // handler. The flow:
  //   1. Set the tool's policy
  //      back to the SAFE
  //      default (`always_confirm`
  //      — the user will be
  //      asked every time, not
  //      auto-allowed). This is
  //      the principle-of-least-
  //      privilege default.
  //   2. Record a synthetic
  //      `revert` decision in
  //      the activity log so
  //      the audit trail
  //      shows "user reverted
  //      their previous
  //      always-allow for tool
  //      X at time T".
  // The revert record uses
  // well-known sentinel ids
  // (`'revert'`) for
  // `requestId`,
  // `assistantMessageId`, and
  // `toolCallId` — these
  // distinguish a revert from
  // a real tool-call decision.
  // The settings tool won't
  // show a "Jump to chat"
  // button on a revert record
  // because `toolCallId === 'revert'`
  // resolves to nothing in
  // the chat thread.
  const setConfirmationMode = useToolSettingsStore(
    (s) => s.setConfirmationMode,
  );
  const recordDecision = useToolDecisionLogStore(
    (s) => s.recordDecision,
  );
  const onRevert = (record: DecisionRecord) => {
    setConfirmationMode(record.toolName, 'always_confirm');
    recordDecision({
      toolName: record.toolName,
      decision: 'revert',
      argsPreview: '',
      requestId: 'revert',
      assistantMessageId: 'revert',
      toolCallId: 'revert',
    });
  };

  return (
    <Stack direction="column" gap={4}>
      {lastCleared && (
        // 5h: undo toast. A small
        // bar above the list that
        // appears for 5 seconds
        // after a clear. The bar
        // has a single [Undo]
        // button; clicking it
        // restores the records
        // from the soft-delete
        // buffer. The bar
        // disappears on its own
        // when the 5s timer
        // expires (or the user
        // clicks Undo).
        //
        // Note: we use
        // `role="status"` +
        // `aria-live="polite"` so
        // screen readers announce
        // the toast when it
        // appears. We DON'T use
        // `aria-live="assertive"`
        // because the toast is
        // informational (not an
        // error).
        <div
          className={styles.decisionLogUndo}
          role="status"
          aria-live="polite"
          data-testid="decision-log-undo"
        >
          <span className={styles.decisionLogUndoText}>
            Cleared {lastCleared.length === 1
              ? '1 decision'
              : `${lastCleared.length} decisions`}
            .{' '}
          </span>
          <button
            type="button"
            className={styles.decisionLogUndoButton}
            onClick={onUndoClear}
            data-testid="decision-log-undo-button"
          >
            Undo
          </button>
        </div>
      )}
      {records.length > 0 && (
        <div
          className={styles.decisionLogToolbar}
          data-testid="decision-log-toolbar"
        >
          <span className={styles.decisionLogCount}>
            {records.length === 1
              ? '1 decision'
              : `${records.length} decisions`}
            {records.length >= 500 && ' (cap reached)'}
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClear}
            data-testid="decision-log-clear"
            data-confirm="danger"
          >
            Clear log
          </Button>
        </div>
      )}
      {records.length === 0 ? (
        <div
          className={styles.placeholder}
          data-testid="decision-log-empty"
        >
          <span>
            No decisions recorded yet. They&apos;ll appear here as
            you use the chat.
          </span>
        </div>
      ) : (
        <>
          {visible.map((r) => (
            <DecisionRow
              key={r.id}
              record={r}
              onJump={() => onJump(r)}
              onRevert={
                r.decision === 'allow_always'
                  ? () => onRevert(r)
                  : undefined
              }
            />
          ))}
          {hasMore && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                setVisibleLimit((n) => n + DECISION_VISIBILITY_LIMIT)
              }
              data-testid="decision-log-show-more"
            >
              Show older ({records.length - visible.length} more)
            </Button>
          )}
        </>
      )}
    </Stack>
  );
}

interface DecisionRowProps {
  record: DecisionRecord;
  // 5f: optional click handler.
  // When provided, the row is
  // keyboard-focusable and
  // clickable (single-click —
  // see `onJump` for the UX
  // rationale). When omitted
  // (e.g. in tests or for
  // records without a
  // toolCallId), the row is
  // static.
  onJump?: () => void;
  // 5g: optional revert
  // handler. When provided,
  // the row shows a small
  // `[Undo]` button. Only
  // `allow_always` rows get
  // this prop from the parent.
  onRevert?: () => void;
}

function DecisionRow({ record, onJump, onRevert }: DecisionRowProps): JSX.Element {
  // 5f: jump-to-chat affordance.
  // We render the row as a
  // <button> when `onJump` is
  // provided. Keyboard users
  // can `Tab` to it and
  // `Enter` to trigger. The
  // `aria-label` spells out
  // the destination (tool
  // name) for screen reader
  // users. The `data-jumpable`
  // attribute is what
  // `getByTestId` / `data-`
  // selectors in tests use.
  const jumpable = Boolean(onJump);
  // 5g: a row is "revertable"
  // when the parent supplied
  // the handler. The parent
  // only does this for
  // `allow_always` rows
  // (denying/allowing-once
  // don't change the policy,
  // so there's nothing to
  // revert).
  const revertable = Boolean(onRevert);
  return (
    <article
      className={styles.decisionRow}
      data-testid={`decision-row-${record.id}`}
      data-jumpable={jumpable || undefined}
      data-revertable={revertable || undefined}
    >
      <div className={styles.decisionRowActions}>
        {jumpable && (
          <button
            type="button"
            className={styles.decisionRowJump}
            onClick={onJump}
            aria-label={`Jump to ${record.toolName} in chat`}
            data-testid={`decision-row-jump-${record.id}`}
          >
            Jump to chat
          </button>
        )}
        {revertable && (
          <button
            type="button"
            className={styles.decisionRowRevert}
            onClick={onRevert}
            aria-label={`Revert Always-allow for ${record.toolName}`}
            data-testid={`decision-row-revert-${record.id}`}
          >
            Undo
          </button>
        )}
      </div>
      <div className={styles.decisionRowMain}>
        <span
          className={styles.decisionBadge}
          data-decision={record.decision}
          data-testid={`decision-badge-${record.id}`}
        >
          {record.decision === 'deny' && 'Deny'}
          {record.decision === 'allow_once' && 'Run once'}
          {record.decision === 'allow_always' && 'Always allow'}
          {record.decision === 'revert' && 'Reverted'}
        </span>
        <code className={styles.decisionToolName}>
          {record.toolName}
        </code>
        <time
          className={styles.decisionTimestamp}
          dateTime={new Date(record.timestamp).toISOString()}
          title={new Date(record.timestamp).toLocaleString()}
        >
          {formatRelativeTime(record.timestamp)}
        </time>
      </div>
      {record.argsPreview && (
        <details className={styles.decisionArgs}>
          <summary className={styles.decisionArgsSummary}>
            Arguments
          </summary>
          <pre
            className={styles.decisionArgsPre}
            data-testid={`decision-args-${record.id}`}
          >
            {record.argsPreview}
          </pre>
        </details>
      )}
      <div className={styles.decisionMeta}>
        <span className={styles.decisionMetaLabel}>
          Chat message
        </span>
        <code className={styles.decisionMetaValue}>
          {record.assistantMessageId}
        </code>
      </div>
    </article>
  );
}

/** Format a timestamp as a short,
 *  human-readable relative time.
 *  No external date library — we
 *  don't need to handle locales or
 *  future dates carefully here
 *  (every timestamp is in the
 *  past). */
function formatRelativeTime(ts: number): string {
  const now = Date.now();
  const diff = now - ts;
  if (diff < 0) return 'in the future'; // clock skew, defensive
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day === 1) return 'yesterday';
  if (day < 7) return `${day}d ago`;
  // Older: show a short date
  // (locale-independent, no Intl
  // for portability).
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// 5a: "Reset all tool settings" card.
// Mirrors the 5h activity-log soft-delete
// pattern, but the buffer is in
// localStorage (not in-memory) so a
// page reload during the 5s window
// doesn't silently drop the reset.
// See `toolSettingsStore.STORAGE_KEY_UNDO`
// for the rationale.
//
// The undo timer uses a ref (not a
// `useEffect`-managed state) so the
// 5s window survives React re-renders
// driven by other store updates. On
// unmount we cancel the timer so it
// can't fire after the user navigates
// away.
function ToolSettingsResetCard() {
  const pendingUndo = useToolSettingsStore((s) => s.pendingUndo);
  const clearAllSettings = useToolSettingsStore((s) => s.clearAllSettings);
  const undoClearAllSettings = useToolSettingsStore(
    (s) => s.undoClearAllSettings,
  );
  const discardUndoAllSettings = useToolSettingsStore(
    (s) => s.discardUndoAllSettings,
  );
  // The 5s window matches the 5h
  // activity-log undo (and the
  // industry-standard "undo send"
  // delay). 5s is short enough to
  // not feel slow, long enough to
  // notice a misclick.
  const UNDO_WINDOW_MS = 5 * 1000;
  const undoTimerRef = useRef<number | null>(null);
  // Clean up the timer on unmount.
  // Also: if `pendingUndo` flips to
  // false for any reason (e.g. an
  // undo click before the timer
  // fired), we clear the pending
  // timer too. The `pendingUndo`
  // dep is what makes this work.
  useEffect(() => {
    if (!pendingUndo) {
      if (undoTimerRef.current !== null) {
        window.clearTimeout(undoTimerRef.current);
        undoTimerRef.current = null;
      }
    }
  }, [pendingUndo]);
  useEffect(() => {
    return () => {
      if (undoTimerRef.current !== null) {
        window.clearTimeout(undoTimerRef.current);
      }
    };
  }, []);
  const onReset = () => {
    clearAllSettings();
    // Arm the auto-discard timer.
    // We replace any existing timer
    // (defensive — `clearAllSettings`
    // is a no-op when there's nothing
    // to clear, so the timer would
    // never run, but being explicit
    // keeps the contract simple).
    if (undoTimerRef.current !== null) {
      window.clearTimeout(undoTimerRef.current);
    }
    undoTimerRef.current = window.setTimeout(() => {
      discardUndoAllSettings();
      undoTimerRef.current = null;
    }, UNDO_WINDOW_MS);
  };
  const onUndo = () => {
    if (undoTimerRef.current !== null) {
      window.clearTimeout(undoTimerRef.current);
      undoTimerRef.current = null;
    }
    undoClearAllSettings();
  };
  return (
    <Stack direction="column" gap={3}>
      {pendingUndo && (
        <div
          className={styles.toolSettingsResetUndo}
          role="status"
          aria-live="polite"
          data-testid="tool-settings-reset-undo"
        >
          <span className={styles.toolSettingsResetUndoText}>
            Reset all tool settings to defaults.
          </span>
          <button
            type="button"
            className={styles.toolSettingsResetUndoButton}
            onClick={onUndo}
            data-testid="tool-settings-reset-undo-button"
          >
            Undo
          </button>
        </div>
      )}
      <article
        className={styles.toolSettingsResetCard}
        data-testid="tool-settings-reset-card"
      >
        <header className={styles.toolSettingsResetCardHeader}>
          <h3 className={styles.toolSettingsResetCardTitle}>
            Reset all tool settings
          </h3>
        </header>
        <p className={styles.toolSettingsResetCardDescription}>
          Re-enable every tool and clear every per-tool confirmation
          policy. Every built-in and custom tool becomes available
          to the model with no prompts. This is a soft-delete — the
          current settings are saved for 5 seconds and you can
          undo from the toast that appears after clicking Reset.
        </p>
        <div className={styles.toolSettingsResetCardActions}>
          <Button
            variant="danger"
            onClick={onReset}
            data-testid="tool-settings-reset-button"
          >
            Reset all
          </Button>
        </div>
      </article>
    </Stack>
  );
}

// 5b: "Backup & Restore" card.
// Two actions: Export (download the
// current tool settings as a JSON
// file) and Import (pick a JSON file
// and apply it). Import goes through
// the same 5a soft-delete + 5s-undo
// pattern — see the JSDoc on
// `applyImportedSettings` for the
// undo wiring.
//
// Why two separate UI elements
// instead of one combined card?
// A "Backup & Restore" card with
// [Export] and [Import] side-by-
// side lets the user reach either
// action in a single click without
// a sub-menu. The actions are also
// visually distinct — Export is a
// primary action, Import is
// destructive (so a different
// button style).
//
// File-picker UX: we use a hidden
// `<input type="file">` triggered
// by a styled `<label>`. The label
// is the visible "Import" button;
// the input is visually hidden but
// still keyboard-accessible (we
// don't `display: none` it, we
// visually hide it via CSS).
function ToolSettingsBackupCard() {
  const disabledToolNames = useToolSettingsStore(
    toolSettingsSelectors.disabledToolNames,
  );
  const confirmationMode = useToolSettingsStore(
    toolSettingsSelectors.confirmationMode,
  );
  const applyImportedSettings = useToolSettingsStore(
    (s) => s.applyImportedSettings,
  );
  const pendingUndo = useToolSettingsStore((s) => s.pendingUndo);
  // The import error / success
  // status. We don't surface
  // "Export" errors via this
  // state — Export is fire-and-
  // forget, the browser handles
  // the download.
  const [importError, setImportError] = useState<string | null>(null);
  const [importNotice, setImportNotice] = useState<string | null>(null);
  // Refs for the two timer-driven
  // dismissals (the success notice
  // auto-clears after 3s, the error
  // clears when the user picks a
  // new file).
  const importNoticeTimerRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  // Clean up timers on unmount.
  useEffect(() => {
    return () => {
      if (importNoticeTimerRef.current !== null) {
        window.clearTimeout(importNoticeTimerRef.current);
      }
    };
  }, []);
  const onExport = () => {
    setImportError(null);
    setImportNotice(null);
    const file = buildSettingsFile({
      disabledToolNames,
      confirmationMode,
    });
    const json = serialiseSettingsFile(file);
    const blob = new Blob([json], { type: 'application/json' });
    // Create a temporary anchor
    // and click it. This is the
    // standard browser-only file
    // download pattern — no Tauri
    // dialog needed, the file
    // goes to the user's default
    // downloads folder.
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = suggestFilename();
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // Release the object URL
    // after the click is
    // dispatched. A microtask
    // delay is enough; some
    // browsers need a tick to
    // start the download.
    setTimeout(() => URL.revokeObjectURL(url), 0);
    setImportNotice('Exported.');
  };
  const onImportFile = (e: ChangeEvent<HTMLInputElement>) => {
    setImportError(null);
    setImportNotice(null);
    const file = e.target.files?.[0];
    // Reset the input value so
    // picking the same file
    // twice fires a `change`
    // event both times.
    e.target.value = '';
    if (!file) return;
    // Sanity check the
    // extension. The parser
    // also rejects non-Lipi
    // files via the magic
    // string, but a friendlier
    // upfront message saves
    // a round-trip.
    if (!file.name.toLowerCase().endsWith('.json')) {
      setImportError(
        'Please pick a .json file exported from Lipi.',
      );
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => {
      setImportError('Could not read the file.');
    };
    reader.onload = () => {
      const text = String(reader.result ?? '');
      const result = parseSettingsFile(text);
      if (!result.ok) {
        setImportError(result.error.message);
        return;
      }
      // Apply. The store handles
      // the undo-buffer
      // snapshot + 5s toast. If
      // the import is a no-op
      // (matches current state),
      // the store early-returns
      // and we surface a
      // message.
      const beforeState = useToolSettingsStore.getState();
      applyImportedSettings(result.data);
      const afterState = useToolSettingsStore.getState();
      if (afterState.pendingUndo === beforeState.pendingUndo) {
        // pendingUndo didn't flip
        // → import was a no-op.
        setImportNotice(
          'No changes — the imported settings match the current ones.',
        );
      } else {
        setImportNotice('Imported. Undo within 5 seconds if needed.');
      }
    };
    reader.readAsText(file);
  };
  // Auto-clear the success
  // notice after 3s. We don't
  // auto-clear errors — those
  // are sticky until the user
  // picks a new file.
  useEffect(() => {
    if (!importNotice) return;
    if (importNoticeTimerRef.current !== null) {
      window.clearTimeout(importNoticeTimerRef.current);
    }
    importNoticeTimerRef.current = window.setTimeout(() => {
      setImportNotice(null);
      importNoticeTimerRef.current = null;
    }, 3000);
  }, [importNotice]);
  // We surface the import's
  // effect through the SAME
  // `pendingUndo` toast as the
  // Danger Zone reset, because
  // both go through
  // `replaceWithUndo`. The user
  // sees one consistent "5
  // seconds to undo" affordance
  // no matter which entry point
  // they used.
  return (
    <Stack direction="column" gap={3}>
      {pendingUndo && (
        <div
          className={styles.toolSettingsResetUndo}
          role="status"
          aria-live="polite"
          data-testid="tool-settings-backup-undo"
        >
          <span className={styles.toolSettingsResetUndoText}>
            Tool settings updated.
          </span>
          <button
            type="button"
            className={styles.toolSettingsResetUndoButton}
            onClick={() => {
              useToolSettingsStore.getState().undoClearAllSettings();
            }}
            data-testid="tool-settings-backup-undo-button"
          >
            Undo
          </button>
        </div>
      )}
      {importError && (
        <div
          className={styles.toolSettingsBackupError}
          role="alert"
          data-testid="tool-settings-backup-error"
        >
          {importError}
        </div>
      )}
      {importNotice && !importError && (
        <div
          className={styles.toolSettingsBackupNotice}
          role="status"
          aria-live="polite"
          data-testid="tool-settings-backup-notice"
        >
          {importNotice}
        </div>
      )}
      <article
        className={styles.toolSettingsBackupCard}
        data-testid="tool-settings-backup-card"
      >
        <header className={styles.toolSettingsBackupCardHeader}>
          <h3 className={styles.toolSettingsBackupCardTitle}>
            Backup &amp; Restore
          </h3>
        </header>
        <p className={styles.toolSettingsBackupCardDescription}>
          Save your current tool settings to a JSON file, or apply
          one. The file includes which tools are disabled and each
          tool's confirmation policy. It does <em>not</em> include
          your API keys, the activity log, or any per-workspace
          custom tools.
        </p>
        <div className={styles.toolSettingsBackupCardActions}>
          <Button
            variant="primary"
            onClick={onExport}
            data-testid="tool-settings-export-button"
          >
            Export…
          </Button>
          <Button
            variant="secondary"
            onClick={() => fileInputRef.current?.click()}
            data-testid="tool-settings-import-button"
          >
            Import…
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            onChange={onImportFile}
            className={styles.toolSettingsBackupFileInput}
            aria-label="Import settings file"
            data-testid="tool-settings-import-input"
          />
        </div>
      </article>
    </Stack>
  );
}

// --- M2b: Voice section — Wispr API key ---------------------
//
// Near-clone of `ProviderCard` for the Wispr provider
// only. The differences:
//   - No "Get a key" link (Wispr is enterprise
//     approval only; the link is to the approval
//     request form, not a key management page).
//   - A "Test connection" button that warms up
//     the WS endpoint by reading the key and
//     triggering `secretsGetApiKey` (round-trip
//     check: the keychain is reachable, the key
//     is retrievable, the IPC is wired up). A
//     real "send a 1s test utterance and check
//     the response" probe is out of scope for M2b
//     (it would require opening the WebSocket
//     from the Settings screen, which is a
//     bigger change).
//   - The display name is "Wispr Flow" with a
//     short description of why it's the
//     recommended provider.
//
// The key storage and `has` check use the same
// `secrets_set_api_key` / `secrets_has_api_key` /
// `secrets_delete_api_key` IPCs as the AI
// providers — there's no separate keychain path
// (the secret is identified by the provider id
// `wispr`; per Decision #41 the JS side can also
// READ the key via `secretsGetApiKey` for
// providers the WebView needs to call directly).
function WisprCard(): JSX.Element {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [draft, setDraft] = useState('');
  const [showDraft, setShowDraft] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>({ kind: 'idle' });
  const [removing, setRemoving] = useState(false);
  const [testState, setTestState] = useState<
    { kind: 'idle' } | { kind: 'testing' } | { kind: 'ok' } | { kind: 'error'; message: string }
  >({ kind: 'idle' });

  const refresh = useCallback(async () => {
    try {
      const has = await secretsHasApiKey('wispr');
      setConfigured(has);
    } catch (err) {
      setSaveState({
        kind: 'error',
        message: err instanceof SecretError ? err.payload.detail : String(err),
      });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const onSave = useCallback(async () => {
    if (!draft) return;
    setSaveState({ kind: 'saving' });
    try {
      await secretsSetApiKey('wispr', draft);
      setDraft('');
      setShowDraft(false);
      setSaveState({ kind: 'saved' });
      setTimeout(() => {
        setSaveState((s) => (s.kind === 'saved' ? { kind: 'idle' } : s));
      }, 2000);
      await refresh();
    } catch (err) {
      setSaveState({
        kind: 'error',
        message: err instanceof SecretError ? err.payload.detail : String(err),
      });
    }
  }, [draft, refresh]);

  const onRemove = useCallback(async () => {
    setRemoving(true);
    try {
      await secretsDeleteApiKey('wispr');
      setTestState({ kind: 'idle' });
      await refresh();
    } catch (err) {
      setSaveState({
        kind: 'error',
        message: err instanceof SecretError ? err.payload.detail : String(err),
      });
    } finally {
      setRemoving(false);
    }
  }, [refresh]);

  const onTestConnection = useCallback(async () => {
    setTestState({ kind: 'testing' });
    try {
      // Round-trip check: the keychain must
      // have the key AND the IPC must return
      // it. We do NOT open a real WebSocket
      // here (that would require a 1s test
      // utterance, which is a different
      // feature). This is "is the plumbing
      // wired up".
      const key = await secretsGetApiKey('wispr');
      if (!key) {
        setTestState({ kind: 'error', message: 'No key in keychain.' });
        return;
      }
      setTestState({ kind: 'ok' });
      setTimeout(() => {
        setTestState((s) => (s.kind === 'ok' ? { kind: 'idle' } : s));
      }, 2000);
    } catch (err) {
      setTestState({
        kind: 'error',
        message: err instanceof SecretError ? err.payload.detail : String(err),
      });
    }
  }, []);

  return (
    <article className={styles.card}>
      <header className={styles.cardHeader}>
        <div className={styles.cardTitleRow}>
          <h2 className={styles.cardTitle}>Wispr Flow</h2>
          <span
            className={styles.badge}
            data-configured={configured || undefined}
          >
            {configured === null
              ? 'Checking…'
              : configured
                ? 'Configured'
                : 'Not configured'}
          </span>
        </div>
        <a
          className={styles.keyLink}
          href="https://platform.wisprflow.ai"
          target="_blank"
          rel="noreferrer noopener"
        >
          Get a key →
        </a>
      </header>
      <p className={styles.cardDescription}>
        Wispr Flow is the recommended voice-to-text provider. Code-aware
        dictation (it knows &ldquo;open paren&rdquo; is punctuation, &ldquo;React&rdquo; is a
        word, &ldquo;three backticks&rdquo; is a fence), with auto-formatting and
        filler-word removal. Enterprise approval is required for an API
        key — apply at{' '}
        <a
          href="mailto:enterprise@wisprflow.ai"
          className={styles.keyLink}
        >
          enterprise@wisprflow.ai
        </a>{' '}
        if you don&apos;t have one yet. While you wait, the on-device
        fallback ships in M2c.
      </p>
      <div className={styles.keyRow}>
        <input
          type={showDraft ? 'text' : 'password'}
          className={styles.keyInput}
          placeholder={
            configured
              ? 'Paste a new key to replace the saved one'
              : 'Paste your Wispr API key'
          }
          autoComplete="off"
          spellCheck={false}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            if (saveState.kind === 'error') {
              setSaveState({ kind: 'idle' });
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && draft && saveState.kind !== 'saving') {
              void onSave();
            }
          }}
          disabled={saveState.kind === 'saving'}
          aria-label="Wispr Flow API key"
        />
        <Button
          variant="ghost"
          size="md"
          onClick={() => setShowDraft((s) => !s)}
          disabled={!draft}
          title={showDraft ? 'Hide the key' : 'Show the key'}
        >
          {showDraft ? 'Hide' : 'Show'}
        </Button>
        <Button
          variant="primary"
          size="md"
          onClick={() => void onSave()}
          loading={saveState.kind === 'saving'}
          disabled={!draft || saveState.kind === 'saving'}
        >
          Save
        </Button>
        {configured && (
          <Button
            variant="ghost"
            size="md"
            onClick={() => void onRemove()}
            loading={removing}
            disabled={removing}
          >
            Remove
          </Button>
        )}
      </div>
      {configured && (
        <div className={styles.testRow}>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void onTestConnection()}
            loading={testState.kind === 'testing'}
            disabled={testState.kind === 'testing'}
          >
            Test connection
          </Button>
          {testState.kind === 'ok' && (
            <span className={styles.statusOk} role="status">
              Key reachable from the WebView. The mic button will open a
              WebSocket to Wispr when you click it.
            </span>
          )}
          {testState.kind === 'error' && (
            <span className={styles.statusError} role="alert">
              {testState.message}
            </span>
          )}
        </div>
      )}
      {saveState.kind === 'saved' && (
        <span className={styles.statusOk} role="status">
          Saved to keychain.
        </span>
      )}
      {saveState.kind === 'error' && (
        <span className={styles.statusError} role="alert">
          {saveState.message}
        </span>
      )}
    </article>
  );
}
