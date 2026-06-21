import { useCallback } from 'react';
import { Stack } from '@/shared/components/Stack';
import { Switch } from '@/shared/components/Switch';
import {
  useToolSettingsStore,
  toolSettingsSelectors,
  type ConfirmationMode,
} from '@/shared/state/toolSettingsStore';
import { confirmAlwaysAllowTool } from '@/shared/toolPolicyWarnings';
import { listTools, type RegisteredTool } from '@/screens/EditorWorkspace/state/toolRegistry';
import styles from '../SettingsProvider.module.css';

export function ToolSettingsCards() {
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
  const enabled = useToolSettingsStore(
    (s) => !s.disabledToolNames.includes(tool.name),
  );
  const setEnabled = useToolSettingsStore((s) => s.setEnabled);
  const mode = useToolSettingsStore((s) =>
    toolSettingsSelectors.getConfirmationMode(s, tool.name),
  );
  const setMode = useToolSettingsStore(
    (s) => s.setConfirmationMode,
  );
  const onSetMode = useCallback(
    (nextMode: ConfirmationMode) => {
      if (
        nextMode === 'always_allow' &&
        mode !== 'always_allow' &&
        !confirmAlwaysAllowTool(tool.name)
      ) {
        return;
      }
      setMode(tool.name, nextMode);
    },
    [mode, setMode, tool.name],
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
            onClick={() => onSetMode('always_allow')}
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
            onClick={() => onSetMode('per_call')}
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
            onClick={() => onSetMode('always_confirm')}
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
