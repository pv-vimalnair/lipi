/**
 * Map a file path to a Monaco / VS Code language identifier.
 *
 * Used by both the editor tab system (Phase 2c) and the diff view
 * (Phase 3c-2) — hence the location in `shared/utils/` per Rule 3
 * (cross-screen shared code).
 *
 * The list of supported languages is intentionally minimal. Monaco
 * falls back to `plaintext` for unknown extensions. The mapping is
 * case-insensitive on the extension.
 */
export function inferLanguage(path: string): string {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  switch (ext) {
    case 'ts':
    case 'tsx':
      return 'typescript';
    case 'js':
    case 'jsx':
    case 'mjs':
    case 'cjs':
      return 'javascript';
    case 'json':
    case 'jsonc':
      return 'json';
    case 'css':
      return 'css';
    case 'scss':
      return 'scss';
    case 'html':
    case 'htm':
      return 'html';
    case 'md':
    case 'mdx':
      return 'markdown';
    case 'rs':
      return 'rust';
    case 'py':
      return 'python';
    case 'go':
      return 'go';
    case 'yml':
    case 'yaml':
      return 'yaml';
    case 'sh':
    case 'bash':
      return 'shell';
    case 'xml':
      return 'xml';
    case 'sql':
      return 'sql';
    case 'toml':
      return 'ini';
    case 'ini':
      return 'ini';
    default:
      return 'plaintext';
  }
}
