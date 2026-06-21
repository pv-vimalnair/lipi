import { useEffect, useState } from 'react';
import { Stack } from '@/shared/components/Stack';
import { Button } from '@/shared/components/Button';
import { useCustomToolsStore } from '@/shared/state/customToolsStore';
import { useGitStore } from '@/screens/EditorWorkspace/state/gitStore';
import type { LipiToolEntry } from '@/ipc';
import { CustomToolEditor } from '../CustomToolEditor';
import styles from '../SettingsProvider.module.css';

export function CustomToolsCards() {
  const rootPath = useGitStore((s) => s.rootPath);
  const tools = useCustomToolsStore((s) => s.tools);
  const loaded = useCustomToolsStore((s) => s.loaded);
  const lastError = useCustomToolsStore((s) => s.lastError);
  const load = useCustomToolsStore((s) => s.load);

  useEffect(() => {
    if (rootPath) {
      void load(rootPath);
    }
  }, [load, rootPath]);

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
