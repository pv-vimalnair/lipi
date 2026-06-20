const ALWAYS_ALLOW_WARNING_STORAGE_KEY =
  'lipi:toolSettings:alwaysAllowWarning:v1';

export function confirmAlwaysAllowTool(toolName: string): boolean {
  try {
    if (
      typeof localStorage !== 'undefined' &&
      localStorage.getItem(ALWAYS_ALLOW_WARNING_STORAGE_KEY) === 'true'
    ) {
      return true;
    }
  } catch {
    // Storage failures should not block an explicit user choice.
  }

  const message =
    `Always allow lets the AI run "${toolName}" without asking again. ` +
    'Only use this for tools you trust, especially shell or HTTP tools.';

  let accepted = true;
  if (typeof window !== 'undefined' && typeof window.confirm === 'function') {
    try {
      accepted = window.confirm(message);
    } catch {
      // Some test/browser shells expose confirm but do not implement it.
      accepted = true;
    }
  }

  if (accepted) {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(ALWAYS_ALLOW_WARNING_STORAGE_KEY, 'true');
      }
    } catch {
      // Best effort: the setting still applies in memory.
    }
  }

  return accepted;
}
