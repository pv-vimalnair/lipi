/**
 * Barrel for the typed IPC layer.
 *
 * Every native call Lipi makes (filesystem, git, terminal, AI, voice,
 * secrets) gets a typed wrapper in `src/ipc/<name>.ts` and is re-exported
 * here. Components import from `@/ipc`, not from `@tauri-apps/api/core`
 * directly — that's the rule (see docs/ENGINEERING.md, Rule 4).
 */

export * from './fs';
export * from './git';
export * from './terminal';
export * from './secrets';
export * from './ai';
export * from './runCommand';
export * from './httpRequest';
export * from './lipiTools';
export * from './stt';
export * from './voicePlatform';
export * from './deepLink';
export * from './templates';
export * from './haptics';
export * from './nativeDictation';
export * from './fsWatcher';
export * from './workspaceSearch';
export * from './licensing';
export * from './iap';
export * from './updaterHealth';
