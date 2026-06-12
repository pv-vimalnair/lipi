import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';

import { Button, IconButton, KeyHint, Stack, VoiceButton } from '@/shared/components';
import { PaneShell } from '../PaneShell';
import { aiSelectors, useAiStore, type ChatMessage } from '../../state/aiStore';
import { gitSelectors, useGitStore } from '../../state/gitStore';
import { useChatNavStore, JUMP_MAX_AGE_MS } from '@/shared/state/chatNavStore';
import {
  mergeTranscript,
  useVoiceStore,
  voiceSelectors,
} from '@/shared/state/voiceStore';
import { parseCommitCommand } from '@/voice';
import { gitCommit as ipcGitCommit, gitStatus as ipcGitStatus, type RepoStatus } from '@/ipc';
import { useVoiceCapture } from '@/shared/hooks/useVoiceCapture';
import { useVoiceShortcut } from '@/shared/hooks/useVoiceShortcut';
import {
  useVoicePreferencesStore,
  voicePreferencesSelectors,
} from '@/shared/state/voicePreferencesStore';
import { getFriendlyError } from './errorMessages';
import { CmdKModal } from './CmdKModal';
import styles from './AIPanel.module.css';

/**
 * AIPanel — side-panel view of the AI chat (Phase 5b-5).
 *
 *   ┌─ PaneShell header (label = "AI", hint = model name,
 *   │   action = [new-chat ⤴  provider-badge ▾])
 *   ├─ Body
 *   │   ├─ Error banner (when `requestStatus.kind === 'error'`)
 *   │   ├─ Chat thread (scrollable, user right, assistant left)
 *   │   │   └─ empty state when no messages
 *   │   │       Each assistant message can have a `ToolTrace`
 *   │   │       block under its text — one per tool the model
 *   │   │       called (5b-4).
 *   │   └─ Composer (textarea + Send / Stop button)
 *   └─
 *   ⤴ The CmdKModal is mounted at the bottom of the panel
 *     (always rendered, hidden by `open === false`). It's
 *     driven by `cmdKStore` — the global Cmd-K handler in
 *     `EditorWorkspace` calls `openCmdK(sel)` and the
 *     modal reads its own state.
 *
 * First-class states (Rule 5 — discriminated union):
 *   - idle         → composer is enabled, no error, no in-flight
 *   - streaming    → composer is disabled, Stop button is visible
 *   - error        → error banner above composer, composer enabled
 *
 * The 5b-4 model is "stream in real time, seal on done":
 *   - `send()` optimistically appends a user message and
 *     an empty streaming assistant placeholder.
 *   - `ai://chunk` deltas append to the placeholder's
 *     `content` field; `toolCall` chunks append to its
 *     `toolCalls` array.
 *   - `ai://done` seals the placeholder
 *     (`streaming: false`).
 *
 * 5b-5 additions:
 *   - A "+" new-chat icon-button in the header (next to
 *     the provider badge) that calls `clearMessages()`.
 *     Disabled while a stream is in flight (the store's
 *     `clearMessages` no-ops in that case, but the
 *     disabled state is the visible signal).
 *   - The ErrorBanner now renders a friendly title +
 *     hint from `getFriendlyError()` (auth →
 *     "Invalid API key" + "Open Settings to update
 *     your key.", etc.) instead of leaking the raw
 *     `errorKind` and provider message.
 *   - The CmdKModal is mounted at the bottom of the
 *     panel tree so the inline-edit flow has somewhere
 *     to render.
 *
 * 5b-6 additions:
 *   - The `ToolTrace` cards are now a full state
 *     machine: `pending` → `running` → `done` |
 *     `error` | `skipped`. The header shows the
 *     status icon (⛏ / ⏳ / ✓ / ✗ / ⚠) and a
 *     one-line status label ("queued" / "running…"
 *     / "ran in 12ms" / "error" / "no handler
 *     registered"). The body shows the input
 *     JSON and, when present, the result output
 *     (also pretty-printed for `'kind: 'json'`
 *     results).
 *   - The panel doesn't need a new component for
 *     the executing-tools state — the disabled
 *     composer + the per-tool "running…" labels
 *     make the in-flight round visible. The 5b-6
 *     `requestStatus` gained an `'executingTools'`
 *     variant; the composer checks for it the
 *     same way it checks for `'streaming'`.
 *
 * Reuses `PaneShell`, `Button`, `IconButton`, `Stack`,
 * `Modal` (Rule 4). No direct `@/ipc/ai` imports — the
 * store is the only boundary (Rule 6).
 */
export function AIPanel() {
  const status = useAiStore(aiSelectors.requestStatus);
  const messages = useAiStore(aiSelectors.messages);
  const provider = useAiStore(aiSelectors.provider);
  const providers = useAiStore(aiSelectors.providers);
  const configuredProviders = useAiStore(aiSelectors.configuredProviders);
  const model = useAiStore(aiSelectors.model);
  const currentProvider = useAiStore(aiSelectors.currentProvider);

  const send = useAiStore((s) => s.send);
  const stop = useAiStore((s) => s.stop);
  const setModel = useAiStore((s) => s.setModel);
  const setProvider = useAiStore((s) => s.setProvider);
  const clearError = useAiStore((s) => s.clearError);
  const clearMessages = useAiStore((s) => s.clearMessages);
  const loadProviders = useAiStore((s) => s.loadProviders);

  // Load the provider list and configured
  // set on mount. 5b-3 doesn't reload on
  // changes (e.g. user adds a key in
  // Settings and comes back); 5b-4+ will
  // watch for screen focus and reload.
  useEffect(() => {
    void loadProviders();
  }, [loadProviders]);

  // If the current model isn't in the new
  // provider's `availableModels`, default to
  // the new provider's default model. This
  // runs whenever `provider` or the loaded
  // `providers` list changes.
  useEffect(() => {
    if (!currentProvider) return;
    if (
      model &&
      currentProvider.availableModels.includes(model)
    ) {
      return;
    }
    setModel(currentProvider.defaultModel);
  }, [currentProvider, model, setModel]);

  // 5f: jump-to-chat wiring. We
  // hold a ref map of every
  // rendered message and tool
  // trace by id. When a
  // `pendingJump` arrives from the
  // Activity Log (via
  // `useChatNavStore.consumeJump`),
  // we look up the targets and
  // (a) scroll the message into
  // view, (b) apply a 2-second
  // highlight ring on both the
  // message and the matching tool
  // trace. The highlight is a CSS
  // animation we trigger by
  // adding a `data-jump-highlight`
  // attribute; CSS handles the
  // visual.
  //
  // The ref maps live at the
  // `AIPanel` level (NOT in
  // `ChatThread`) so the jump
  // effect can reach them without
  // prop-drilling.
  const messageRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const toolCallRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  useEffect(() => {
    // Consume the pending jump on
    // every render where the store
    // has one. We re-read the
    // store on each effect run
    // (Zustand effects re-fire on
    // subscription changes); the
    // store itself is the
    // subscription source via the
    // explicit `subscribe` below.
    // The `consumeJump` returns
    // null after the first read
    // (clear-on-read), so a
    // re-mount without a new jump
    // request is a no-op.
    let cancelled = false;
    const consume = () => {
      if (cancelled) return;
      const jump = useChatNavStore.getState().consumeJump();
      if (!jump) return;
      // Expiry check: a jump
      // older than 30s is stale
      // (defense against a far-
      // stale jump causing a
      // visual flicker after a
      // long idle).
      if (Date.now() - jump.issuedAt > JUMP_MAX_AGE_MS) return;
      const messageEl = messageRefs.current.get(jump.messageId);
      const toolCallEl = toolCallRefs.current.get(jump.toolCallId);
      if (!messageEl) {
        // The message isn't in
        // the thread (e.g. the
        // user cleared messages
        // after the jump was
        // requested). Bail
        // silently — the
        // `consumeJump` already
        // cleared the store.
        return;
      }
      // Scroll into view. We use
      // `block: 'center'` so
      // the message is in the
      // middle of the visible
      // area, not the very
      // top (easier to read
      // context above + below).
      messageEl.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
      // Apply the highlight.
      // We add a data
      // attribute rather than
      // a CSS class because
      // the CSS file already
      // targets
      // `data-jump-highlight`
      // (added in 5f). The
      // attribute is removed
      // after 2s.
      messageEl.setAttribute('data-jump-highlight', '');
      if (toolCallEl) {
        toolCallEl.setAttribute('data-jump-highlight', '');
      }
      window.setTimeout(() => {
        messageEl.removeAttribute('data-jump-highlight');
        if (toolCallEl) {
          toolCallEl.removeAttribute('data-jump-highlight');
        }
      }, 2000);
    };
    // Run once on mount (in case
    // a jump is already pending
    // — e.g. the AIPanel
    // mounted AFTER the
    // Activity Log row was
    // clicked).
    consume();
    // Subscribe to future
    // changes (a jump that
    // arrives while the AIPanel
    // is mounted).
    const unsubscribe = useChatNavStore.subscribe(() => {
      consume();
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  // Hint: the model name (or "no key" if
  // the current provider is not configured).
  const providerConfigured =
    configuredProviders?.includes(provider) ?? false;
  const hintText = !providerConfigured
    ? 'No API key — open Settings'
    : model || '…';

  return (
    <PaneShell
      label="AI"
      hint={hintText}
      area="side"
      headerAction={
        <Stack direction="row" gap={1} align="center" inline>
          <IconButton
            aria-label="New chat"
            variant="subtle"
            size="sm"
            onClick={() => clearMessages()}
            // 5b-6: disabled while
            // tools are executing
            // too (the store's
            // `clearMessages` no-ops
            // in that case as well,
            // but the disabled state
            // is the visible signal).
            disabled={
              status.kind === 'streaming' ||
              status.kind === 'executingTools'
            }
            title={
              status.kind === 'streaming'
                ? 'Stop the current request before starting a new chat'
                : status.kind === 'executingTools'
                ? 'Wait for the tools to finish before starting a new chat'
                : 'Start a new chat'
            }
          >
            ＋
          </IconButton>
          <ProviderBadge
            providerId={provider}
            providerName={currentProvider?.displayName ?? provider}
            configured={providerConfigured}
            providers={providers}
            configuredSet={configuredProviders}
            onChange={(id) => setProvider(id)}
          />
        </Stack>
      }
    >
      <Stack direction="column" gap={2} className={styles.root}>
        {status.kind === 'error' && (
          <ErrorBanner
            errorKind={status.errorKind}
            message={status.message}
            onDismiss={clearError}
          />
        )}
        <ChatThread
          messages={messages}
          status={status}
          messageRefs={messageRefs}
          toolCallRefs={toolCallRefs}
        />
        <Composer
          status={status}
          disabled={!providerConfigured}
          onSend={(text) => void send(text)}
          onStop={() => void stop()}
        />
      </Stack>
      <CmdKModal />
    </PaneShell>
  );
}

// --- Provider badge (header action) ---------------------------------------

interface ProviderBadgeProps {
  providerId: string;
  providerName: string;
  configured: boolean;
  providers: ReturnType<typeof useAiStore.getState>['providers'];
  configuredSet: string[] | undefined;
  onChange: (id: string) => void;
}

/**
 * Compact provider picker in the header. Shows
 * the current provider name + a small colour
 * dot (green = configured, amber = not). Click
 * opens a small popover with the 3 providers
 * (only those with a key are enabled; others
 * show a "No API key — open Settings" hint).
 *
 * 5b-3 keeps the popover minimal — a plain
 * `<select>` would be more accessible, but
 * the header is tight on horizontal space. A
 * custom popover is the better long-term
 * direction.
 */
function ProviderBadge({
  providerId,
  providerName,
  configured,
  providers,
  configuredSet,
  onChange,
}: ProviderBadgeProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  return (
    <div className={styles.badge} ref={ref}>
      <button
        type="button"
        className={styles.badgeButton}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={`${providerName}${configured ? '' : ' (no API key)'}`}
      >
        <span
          className={styles.badgeDot}
          data-configured={configured || undefined}
        />
        <span className={styles.badgeLabel}>{providerName}</span>
        <span className={styles.badgeChevron} aria-hidden="true">
          ▾
        </span>
      </button>
      {open && (
        <ul className={styles.badgePopover} role="listbox">
          {providers.map((p) => {
            const isConfigured = configuredSet?.includes(p.id) ?? false;
            return (
              <li
                key={p.id}
                role="option"
                aria-selected={p.id === providerId}
                className={styles.badgeOption}
                data-active={p.id === providerId || undefined}
                data-disabled={!isConfigured || undefined}
                onClick={() => {
                  if (!isConfigured) return;
                  onChange(p.id);
                  setOpen(false);
                }}
                title={
                  isConfigured
                    ? `Switch to ${p.displayName}`
                    : `${p.displayName} — no API key configured`
                }
              >
                <span className={styles.badgeOptionName}>
                  {p.displayName}
                </span>
                <span
                  className={styles.badgeOptionStatus}
                  data-configured={isConfigured || undefined}
                >
                  {isConfigured ? 'configured' : 'no key'}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// --- Error banner --------------------------------------------------------

interface ErrorBannerProps {
  errorKind: string;
  message: string;
  onDismiss: () => void;
}

/**
 * Inline error banner above the composer.
 * Renders a friendly title + hint based on
 * the ErrorKind, sourced from
 * `getFriendlyError()`. Dismissable with the
 * × button.
 *
 * 5b-5 replaces the raw `errorKind` chip +
 * provider message with a friendlier title
 * + hint. The kind is still useful in
 * dev tools / a future error log, so we
 * keep it on `data-error-kind` for debugging.
 */
function ErrorBanner({ errorKind, message, onDismiss }: ErrorBannerProps) {
  const friendly = getFriendlyError(errorKind, message);
  return (
    <div
      className={styles.errorBanner}
      role="alert"
      data-error-kind={errorKind}
    >
      <div className={styles.errorText}>
        <span className={styles.errorTitle}>{friendly.title}</span>
        {friendly.hint && (
          <span className={styles.errorHint}>{friendly.hint}</span>
        )}
      </div>
      <button
        type="button"
        className={styles.errorDismiss}
        onClick={onDismiss}
        aria-label="Dismiss error"
        title="Dismiss"
      >
        ×
      </button>
    </div>
  );
}

// --- Chat thread ---------------------------------------------------------

interface ChatThreadProps {
  messages: ChatMessage[];
  status: ReturnType<typeof useAiStore.getState>['requestStatus'];
  // 5f: ref maps for jump-to-chat.
  messageRefs: React.MutableRefObject<Map<string, HTMLDivElement>>;
  toolCallRefs: React.MutableRefObject<Map<string, HTMLDivElement>>;
}

/**
 * Scrollable list of chat messages. The
 * thread auto-scrolls to the bottom on new
 * messages (5b-4 will need this; in 5b-3
 * the placeholder appears empty so there's
 * no visual delta, but the autoscroll
 * behaviour is harmless and forward-
 * compatible).
 *
 * Empty state: a small "Send a message to
 * start" hint with a subtle link to the
 * settings screen if the current provider
 * has no key.
 */
function ChatThread({ messages, status, messageRefs, toolCallRefs }: ChatThreadProps) {
  const threadRef = useRef<HTMLDivElement>(null);

  // Auto-scroll on new content. In 5b-4 the
  // streaming assistant message's `content`
  // changes several times per second, so we
  // hash the last message's text + tool-call
  // count + message count and fire on any
  // change. The hash is cheap (just
  // length-of-last + length-of-tools), so we
  // don't need a deep equality check.
  useEffect(() => {
    const el = threadRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [
    messages.length,
    messages[messages.length - 1]?.content.length ?? 0,
    messages[messages.length - 1]?.toolCalls.length ?? 0,
  ]);

  if (messages.length === 0) {
    return (
      <div className={styles.threadEmpty} ref={threadRef}>
        <p className={styles.threadEmptyTitle}>Start a conversation</p>
        <p className={styles.threadEmptyBody}>
          Type a message below and press <kbd>Enter</kbd> to send.
        </p>
      </div>
    );
  }

  return (
    <div className={styles.thread} ref={threadRef}>
      {messages.map((m) => (
        <MessageRow
          key={m.id}
          message={m}
          isStreaming={status.kind === 'streaming'}
          messageRefs={messageRefs}
          toolCallRefs={toolCallRefs}
        />
      ))}
    </div>
  );
}

interface MessageRowProps {
  message: ChatMessage;
  isStreaming: boolean;
  // 5f: ref maps for jump-to-chat.
  messageRefs: React.MutableRefObject<Map<string, HTMLDivElement>>;
  toolCallRefs: React.MutableRefObject<Map<string, HTMLDivElement>>;
}

function MessageRow({ message, isStreaming, messageRefs, toolCallRefs }: MessageRowProps) {
  // Show a "▌" cursor while the message is
  // actively streaming. Sits at the end of
  // the accumulated text (5b-4 streams
  // text in real time; 5b-3 had the
  // placeholder always-empty so the
  // cursor floated on its own).
  const showCursor =
    message.streaming && message.role === 'assistant' && isStreaming;

  // 5f: ref-callback registers
  // this message element by id
  // in the AIPanel's ref map. The
  // jump effect looks up the
  // element by `message.id` to
  // scroll + highlight.
  const setMessageRef = useCallback(
    (el: HTMLDivElement | null) => {
      if (el) {
        messageRefs.current.set(message.id, el);
      } else {
        messageRefs.current.delete(message.id);
      }
    },
    [message.id, messageRefs],
  );

  return (
    <div
      className={styles.message}
      data-role={message.role}
      ref={setMessageRef}
    >
      <div className={styles.messageBubble}>
        {message.content || (showCursor ? '' : '\u00A0')}
        {showCursor && <span className={styles.cursor} aria-hidden="true">▌</span>}
      </div>
      {message.toolCalls.length > 0 && (
        <ToolTraceList toolCalls={message.toolCalls} toolCallRefs={toolCallRefs} />
      )}
    </div>
  );
}

// --- Tool trace (5b-4 → 5b-6) ---------------------------------------------
//
// One `ToolTrace` per `toolCall` on the
// assistant message. Renders as a small
// collapsible card under the message bubble:
//
//   ┌─ ⛏ get_file_contents · running… ───┐
//   │  input:  {"path": "src/index.ts"}  │
//   └─────────────────────────────────────┘
//
//   ┌─ ✓ get_file_contents · 12ms ────────┐
//   │  input:  {"path": "src/index.ts"}  │
//   │  output: const x = 1;              │
//   │          …(more)                   │
//   └─────────────────────────────────────┘
//
//   ┌─ ✗ get_file_contents · error ───────┐
//   │  input:  {"path": "missing.txt"}   │
//   │  output: Error: file not found.     │
//   └─────────────────────────────────────┘
//
// 5b-6 added the status state machine
// (`pending` / `running` / `done` / `error`)
// and the result preview. The card is
// open by default (so the user can see
// what the model is doing mid-stream) but
// can be collapsed. Each card has its own
// open/closed state, so collapsing one
// doesn't collapse the others.

interface ToolTraceListProps {
  toolCalls: ChatMessage['toolCalls'];
  // 5f: ref map for tool-trace
  // highlighting on jump-to-chat.
  toolCallRefs: React.MutableRefObject<Map<string, HTMLDivElement>>;
}

function ToolTraceList({ toolCalls, toolCallRefs }: ToolTraceListProps) {
  return (
    <div className={styles.toolTraceList}>
      {toolCalls.map((tc) => (
        <ToolTrace key={tc.id} toolCall={tc} toolCallRefs={toolCallRefs} />
      ))}
    </div>
  );
}

interface ToolTraceProps {
  toolCall: ChatMessage['toolCalls'][number];
  // 5f: ref map for jump-to-chat
  // highlight. The ToolTrace
  // registers its root div by
  // `toolCall.id` so the jump
  // effect can highlight it
  // alongside the parent
  // message.
  toolCallRefs: React.MutableRefObject<Map<string, HTMLDivElement>>;
}

/**
 * Pretty-print the `input` JSON. We try to
 * `JSON.parse` and `JSON.stringify(_, null,
 * 2)` so the user sees indentation. If
 * parsing fails (the model hallucinated),
 * fall back to the raw string — the user
 * still gets to see what the model emitted.
 */
function formatInput(input: string): string {
  if (!input) return '/* no arguments */';
  try {
    return JSON.stringify(JSON.parse(input), null, 2);
  } catch {
    return input;
  }
}

/**
 * Pretty-print the result content. For
 * `'kind: 'json'`, we re-parse and
 * re-stringify with indentation (the
 * handler may have returned
 * un-indented JSON). For `'kind: 'text'`
 * and `'kind: 'error'`, the output is
 * the raw string from the handler.
 */
function formatResult(result: { output: string; kind: 'text' | 'json' | 'error' }): string {
  if (result.kind === 'json') {
    try {
      return JSON.stringify(JSON.parse(result.output), null, 2);
    } catch {
      return result.output;
    }
  }
  return result.output;
}

/**
 * 5b-6: a one-line label for the tool
 * call's current status. The header uses
 * it as a small badge after the tool
 * name. The icon (✓ / ⏳ / ✗ / ⛏) is
 * rendered separately.
 */
function statusLabel(tc: ChatMessage['toolCalls'][number]): string {
  switch (tc.status) {
    case 'pending':
      return 'queued';
    case 'running':
      return 'running…';
    case 'done':
      // `tc.result` is set when `status`
      // is `'done'`, so we can safely
      // access it.
      return `ran in ${tc.result?.durationMs ?? 0}ms`;
    case 'error':
      return 'error';
    case 'skipped':
      return 'no handler registered';
  }
}

/**
 * Pick the icon for the tool call. The
 * base icon is always ⛏ (pickaxe) so
 * pending calls are identifiable. The
 * status overlay changes as the call
 * progresses:
 *   - pending: ⛏
 *   - running: ⏳ (hourglass — animated
 *     via CSS `animation: spin` would
 *     be nicer but we keep it static
 *     for now; 5c may add an animation)
 *   - done: ✓
 *   - error: ✗
 *   - skipped: ⚠
 */
function statusIcon(tc: ChatMessage['toolCalls'][number]): string {
  switch (tc.status) {
    case 'pending':
      return '⛏';
    case 'running':
      return '⏳';
    case 'done':
      return '✓';
    case 'error':
      return '✗';
    case 'skipped':
      return '⚠';
  }
}

function ToolTrace({ toolCall, toolCallRefs }: ToolTraceProps) {
  const [open, setOpen] = useState(true);
  const pretty = formatInput(toolCall.input);

  // 5f: ref-callback registers
  // this tool-trace element by
  // id in the AIPanel's ref map.
  const setTraceRef = useCallback(
    (el: HTMLDivElement | null) => {
      if (el) {
        toolCallRefs.current.set(toolCall.id, el);
      } else {
        toolCallRefs.current.delete(toolCall.id);
      }
    },
    [toolCall.id, toolCallRefs],
  );

  return (
    <div
      className={styles.toolTrace}
      data-open={open || undefined}
      data-status={toolCall.status}
      ref={setTraceRef}
    >
      <button
        type="button"
        className={styles.toolTraceHeader}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span className={styles.toolTraceIcon} aria-hidden="true">
          {statusIcon(toolCall)}
        </span>
        <span className={styles.toolTraceName}>{toolCall.name}</span>
        <span className={styles.toolTraceStatus} data-status={toolCall.status}>
          {statusLabel(toolCall)}
        </span>
        <span className={styles.toolTraceChevron} aria-hidden="true">
          {open ? '▾' : '▸'}
        </span>
      </button>
      {open && (
        <div className={styles.toolTraceBody}>
          <div className={styles.toolTraceRow}>
            <span className={styles.toolTraceLabel}>input</span>
            <pre className={styles.toolTraceJson}>{pretty}</pre>
          </div>
          {toolCall.result && (
            <div className={styles.toolTraceRow}>
              <span className={styles.toolTraceLabel}>
                {toolCall.result.kind === 'error' ? 'error' : 'output'}
              </span>
              <pre
                className={styles.toolTraceJson}
                data-kind={toolCall.result.kind}
              >
                {formatResult(toolCall.result)}
              </pre>
            </div>
          )}
          {toolCall.status === 'pending' && !toolCall.result && (
            <div className={styles.toolTraceRow}>
              <span className={styles.toolTraceLabel}>output</span>
              <span className={styles.toolTraceNoResult}>queued</span>
            </div>
          )}
          {toolCall.status === 'running' && !toolCall.result && (
            <div className={styles.toolTraceRow}>
              <span className={styles.toolTraceLabel}>output</span>
              <span className={styles.toolTraceNoResult}>running…</span>
            </div>
          )}
          {toolCall.status === 'skipped' && (
            <div className={styles.toolTraceRow}>
              <span className={styles.toolTraceLabel}>output</span>
              <span className={styles.toolTraceNoResult}>
                no handler registered for '{toolCall.name}'
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// --- Composer ------------------------------------------------------------

interface ComposerProps {
  status: ReturnType<typeof useAiStore.getState>['requestStatus'];
  disabled: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
}

/**
 * The composer at the bottom of the panel.
 *
 *   ┌──────────────────────────────────────┬─────┐
 *   │ Type a message…                       │  ⏎  │
 *   │                                       │     │
 *   └──────────────────────────────────────┴─────┘
 *
 * - Enter sends; Shift+Enter inserts a newline.
 * - The button on the right is a "Send" arrow
 *   when idle, a "Stop" ⏹ when streaming.
 * - `disabled` is true when the current
 *   provider has no key configured (the user
 *   has to go to Settings first).
 */
function Composer({ status, disabled, onSend, onStop }: ComposerProps) {
  const [text, setText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // 5b-6: the composer is busy during
  // both `'streaming'` (waiting for
  // `ai://done`) and `'executingTools'`
  // (running the JS-side tool handlers).
  // The two are equivalent from the
  // user's perspective: they can't
  // type a new message and the Stop
  // button is meaningful for the
  // streaming round (the tool round
  // is local and can't be cancelled
  // mid-handler — it'd just orphan
  // the partial result).
  const isStreaming = status.kind === 'streaming';
  const isBusy = isStreaming || status.kind === 'executingTools';

  // M5: the Composer owns the single
  // `useVoiceCapture` instance. We pass the
  // returned API down to the `VoiceButton` via
  // the new `controlledState` prop so the
  // on-screen button and the global keyboard
  // shortcut (`useVoiceShortcut`, below) share
  // the same mic stream. Before M5, the
  // `VoiceButton` created its own instance —
  // fine in isolation, but a problem the
  // moment two callers needed the same
  // capture state.
  //
  // We read the provider from the preferences
  // store directly (the same way the standalone
  // `VoiceButton` did) and pass it to the hook.
  // The hook's internal lifecycle owns the
  // MediaStream, the WS connection, the
  // transcript write — same as before. The
  // `disabled` prop is `disabled || isBusy` so
  // the button greys out mid-stream (we don't
  // want a voice round to start in the middle
  // of a stream / tool run).
  const voiceProvider = useVoicePreferencesStore(voicePreferencesSelectors.provider);
  const voice = useVoiceCapture({ provider: voiceProvider });
  const voiceDisabled = disabled || isBusy;
  useVoiceShortcut({
    start: voice.start,
    stop: voice.stop,
    status: voice.status,
    enabled: !voiceDisabled,
  });

  // M2a: voice-to-text. We subscribe to the
  // voiceStore's `transcript` field. When a new
  // transcript lands (status flips from
  // 'transcribing' to 'idle'), we merge it into
  // the textarea and then clear the store so a
  // re-render of the same store value (e.g. on
  // an unrelated re-render) doesn't re-merge.
  //
  // The subscriber uses the latest `text` via
  // a ref so the effect doesn't re-fire every
  // keystroke. We also clear the store after
  // merging, so the same transcript only
  // appends once.
  //
  // M5: when the transcript lands, we ALSO
  // return focus to the textarea. The user
  // just spoke; the natural next action is
  // either to type a follow-up, hit Enter, or
  // start a new voice round. The textarea is
  // the right place to drop the focus. We
  // also place the caret at the end of the
  // inserted text so the next keystroke
  // continues the message (rather than
  // editing the middle).
  const textRef = useRef(text);
  textRef.current = text;
  const voiceTranscript = useVoiceStore(voiceSelectors.transcript);
  // M4: commit-by-voice integration. We use a
  // ref to read the latest rootPath / commit
  // actions inside the effect without re-running
  // it on every render. The effect itself is
  // gated on the transcript changing.
  const rootPathRef = useRef<string | null>(null);
  rootPathRef.current = useGitStore.getState().rootPath;
  const setCommitRunning = useGitStore((s) => s.setCommitRunning);
  const setCommitSuccess = useGitStore((s) => s.setCommitSuccess);
  const setCommitError = useGitStore((s) => s.setCommitError);
  const refreshStatus = useGitStore((s) => s.setStatus);
  useEffect(() => {
    if (voiceTranscript === '') return;
    const parsed = parseCommitCommand(voiceTranscript);
    // Always clear the store transcript first —
    // we don't want the textarea-merge path AND
    // the commit path both firing on the same
    // transcript. The commit path is exclusive:
    // if it's a commit, the transcript is consumed
    // by the commit and never appended to the
    // textarea.
    useVoiceStore.getState().setTranscript('');
    if (parsed.kind === 'not-commit') {
      // Default path: append to the textarea.
      setText((prev) => mergeTranscript(prev, voiceTranscript));
      // M5: return focus to the textarea after
      // a dictation merge. We use a microtask
      // (queueMicrotask) so React's commit phase
      // has finished applying the new `text` —
      // otherwise `setSelectionRange` would
      // operate on the stale DOM. We only focus
      // when the textarea isn't already focused
      // (don't yank focus from a user who's
      // typing elsewhere).
      queueMicrotask(() => {
        const el = textareaRef.current;
        if (el && document.activeElement !== el) {
          el.focus();
          // Place the caret at the end of the
          // text. The textarea's `value` has
          // already been updated by the time
          // the effect fires (React's commit
          // runs before the effect's microtask).
          const end = el.value.length;
          try {
            el.setSelectionRange(end, end);
          } catch {
            // setSelectionRange can throw on
            // input[type=email] etc.; textarea
            // supports it, but be defensive.
          }
        }
      });
      return;
    }
    // Commit path. We need a rootPath to commit
    // against. The git panel is the source of
    // truth for the active repo. If there's no
    // root open, we surface a friendly error.
    const root = rootPathRef.current;
    if (!root) {
      setCommitError(
        'Open a folder first to commit by voice (Settings → Open folder).',
      );
      return;
    }
    if (parsed.message === '') {
      setCommitError(
        'Voice command "commit" needs a message. Try "commit with message fix the bug".',
      );
      return;
    }
    // Fire the commit. The Rust IPC stages + commits
    // atomically (from the caller's perspective).
    // On success we refresh the panel status so
    // the file list shows the new HEAD; on error
    // we surface the IPC's error message verbatim
    // (the Rust side has already produced a
    // user-facing string).
    setCommitRunning();
    void ipcGitCommit(root, parsed.message).then(
      (result) => {
        setCommitSuccess(result);
        // Refresh the status panel so the
        // just-committed file list goes to
        // "clean" (or to the next pending
        // change). The user's `useGitStore.status`
        // is read by the GitPanel.
        void gitStatusForRefresh(root, refreshStatus);
        // M5: after a commit, return focus to
        // the textarea so the user can type
        // the follow-up message. We use the
        // same microtask dance as the
        // dictation path.
        queueMicrotask(() => {
          textareaRef.current?.focus();
        });
      },
      (err: unknown) => {
        const message =
          err instanceof Error ? err.message : 'Commit failed';
        setCommitError(message);
      },
    );
  }, [
    voiceTranscript,
    setCommitRunning,
    setCommitSuccess,
    setCommitError,
    refreshStatus,
  ]);

  // Auto-grow the textarea up to a max
  // height. 5b-3 keeps it simple — the
  // composer never exceeds 6 rows; 5b-4
  // will tune.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [text]);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (isBusy) return;
    const trimmed = text.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setText('');
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter (without Shift) sends. Shift+Enter
    // inserts a newline. The browser default
    // for Shift+Enter in a textarea is to
    // insert a newline, so we only intercept
    // the plain-Enter case.
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  return (
    <form className={styles.composer} onSubmit={handleSubmit}>
      {/* M4: commit-by-voice status banner. We
          subscribe to the git store's commit
          lifecycle and render a small inline
          message above the textarea so the
          user gets immediate feedback when
          "commit with message X" succeeds or
          fails. The toast auto-dismisses after
          5 seconds (see
          `isCommitToastVisible` selector). */}
      <CommitStatusBanner />
      <textarea
        ref={textareaRef}
        className={styles.composerInput}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={
          disabled
            ? 'Add an API key in Settings to start chatting…'
            : isBusy
            ? status.kind === 'executingTools'
              ? 'Running tools…'
              : 'Streaming…'
            : 'Type a message… (or press Ctrl+Shift+V to dictate)'
        }
        rows={1}
        disabled={disabled || isBusy}
        // M5: the aria-label mentions the
        // keyboard shortcut so screen-reader
        // users know the voice input has a
        // non-mouse entry point. We don't
        // detect the platform here (Mac uses
        // Cmd; others Ctrl); the wording is
        // "the modifier key" which works for
        // both audiences.
        aria-label="Message — press Ctrl+Shift+V to dictate with voice"
      />
      {/* M2a: voice input. Disabled when the
          provider isn't configured (the user
          would record a message they can't
          send) and during streaming / tool
          execution (we don't want to start
          a second round-trip mid-stream).
          The hook drives the capture
          pipeline; the transcript lands in
          `useVoiceStore.transcript` and the
          effect above merges it. */}
      {/* M2b: the voice button defaults to the Wispr
          provider (the headline STT path). The
          Command Palette can flip to 'stub' for
          debugging. */}
      {/* M5: pass the controlled state from
          the parent `useVoiceCapture` so the
          on-screen button shares the same
          mic stream as the global shortcut
          (Cmd+Shift+V / Ctrl+Shift+V). The
          `KeyHint` next to the button is the
          visual reminder of the shortcut —
          sighted users will learn it; SR
          users will get the aria-label hint
          on the textarea. The hint itself
          is `aria-hidden` (KeyHint already
          sets that) because the aria-label
          on the button/textarea is the
          canonical source of truth. */}
      <span
        className={styles.voiceCluster}
        title="Toggle voice (Ctrl/Cmd+Shift+V)"
      >
        <VoiceButton
          disabled={voiceDisabled}
          controlledState={{
            start: voice.start,
            stop: voice.stop,
            status: voice.status,
            durationLabel: voice.durationLabel,
            lastError: voice.lastError,
          }}
        />
        <KeyHint
          label="V"
          primary
          shift
        />
      </span>
      {isStreaming ? (
        <Button
          type="button"
          variant="secondary"
          size="md"
          onClick={onStop}
          aria-label="Stop generating"
        >
          ⏹ Stop
        </Button>
      ) : (
        <Button
          type="submit"
          variant="primary"
          size="md"
          disabled={disabled || text.trim().length === 0}
          aria-label="Send"
          title="Send (Enter)"
        >
          ⏎
        </Button>
      )}
    </form>
  );
}

// --- M4: commit-by-voice status banner ----------------------------------
//
// A small inline banner above the composer that
// shows the current voice-commit lifecycle state.
// Rendered inside the composer form so it sits
// visually next to the mic button (the user is
// most likely to look at the button right after
// saying "commit..."). The banner auto-dismisses
// on a timer — the selector
// `isCommitToastVisible` returns false after 5s
// on a successful commit. Errors persist until
// the next start() call (the user should see
// what went wrong).

function CommitStatusBanner() {
  const commitStatus = useGitStore(gitSelectors.commitStatus);
  const lastCommit = useGitStore(gitSelectors.lastCommit);
  const commitError = useGitStore(gitSelectors.commitError);
  const clearCommitResult = useGitStore((s) => s.clearCommitResult);

  // Auto-dismiss the success toast after 5s. We
  // use a real `setTimeout` (not an effect dep
  // on `lastCommit?.at`) so a re-render with
  // the same `at` doesn't reset the timer.
  useEffect(() => {
    if (commitStatus !== 'success' || !lastCommit) return;
    const ms = Math.max(0, 5_000 - (Date.now() - lastCommit.at));
    const id = window.setTimeout(() => {
      clearCommitResult();
    }, ms);
    return () => window.clearTimeout(id);
  }, [commitStatus, lastCommit, clearCommitResult]);

  if (commitStatus === 'running') {
    return (
      <div
        className={styles.commitBanner}
        data-state="running"
        role="status"
        aria-live="polite"
      >
        <span className={styles.commitBannerIcon} aria-hidden="true">
          ⏳
        </span>
        <span className={styles.commitBannerText}>
          Committing…
        </span>
      </div>
    );
  }
  if (commitStatus === 'success' && lastCommit) {
    return (
      <div
        className={styles.commitBanner}
        data-state="success"
        role="status"
        aria-live="polite"
      >
        <span className={styles.commitBannerIcon} aria-hidden="true">
          ✓
        </span>
        <span className={styles.commitBannerText}>
          Committed <code>{lastCommit.shortSha}</code> via voice
        </span>
        <button
          type="button"
          className={styles.commitBannerDismiss}
          onClick={clearCommitResult}
          aria-label="Dismiss"
          title="Dismiss"
        >
          ×
        </button>
      </div>
    );
  }
  if (commitStatus === 'error' && commitError) {
    return (
      <div
        className={styles.commitBanner}
        data-state="error"
        role="alert"
      >
        <span className={styles.commitBannerIcon} aria-hidden="true">
          ✗
        </span>
        <span className={styles.commitBannerText}>
          {commitError}
        </span>
        <button
          type="button"
          className={styles.commitBannerDismiss}
          onClick={clearCommitResult}
          aria-label="Dismiss"
          title="Dismiss"
        >
          ×
        </button>
      </div>
    );
  }
  return null;
}

// --- M4 helper: refresh the git panel after a commit --------------------
//
// A successful commit changes the worktree's
// state — files that were just-staged are now
// in HEAD, and the file list should go from
// "modified" to "clean". The git panel reads
// `useGitStore.status`; we re-fetch via the IPC
// and update the store. We pass `setStatus`
// directly to avoid taking a hook dependency
// on the entire `useGitStatus` hook (which
// would be a layering violation — the
// Composer shouldn't know about the panel's
// refresh logic).
//
// This is a fire-and-forget helper: errors
// are swallowed because the commit itself
// succeeded; if the refresh fails, the user
// can hit the panel's "Refresh" button to
// retry. We don't want a refresh error to
// surface as a commit error.
async function gitStatusForRefresh(
  root: string,
  setStatus: (status: ReturnType<typeof useGitStore.getState>['status']) => void,
): Promise<void> {
  try {
    setStatus({ kind: 'loading', rootPath: root });
    const status: RepoStatus = await ipcGitStatus(root);
    setStatus({ kind: 'ready', rootPath: root, status });
  } catch {
    // Swallow — the user can hit the panel's
    // Refresh button.
  }
}
