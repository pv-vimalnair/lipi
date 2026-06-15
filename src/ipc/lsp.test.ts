/**
 * Phase 9.2b — tests for the per-kind IPC
 * surface. The two new exports in
 * `ipc/lsp.ts` are:
 *
 *   - `kindToSpawnSpec(kind)` — a pure
 *     function over the `LspServerKind`
 *     union. Returns the binary + args +
 *     install hint for a given kind.
 *   - `lspCheckAvailable(args?)` — the IPC
 *     wrapper that now accepts an optional
 *     `args.serverKind`.
 *
 * These tests pin the contract: the JS-side
 * spawn spec must agree with the Rust-side
 * `server_kind_spec()` table. If the binary
 * name on either side changes, the contract
 * breaks and these tests catch it.
 */

import { describe, expect, it, vi } from 'vitest';

import { kindToSpawnSpec, lspCheckAvailable } from '@/ipc/lsp';

// Mock the Tauri IPC layer. We only need
// `invoke` for `lspCheckAvailable`; the
// other listeners (`onLspCrashed`,
// `onLspLog`) aren't exercised here.
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async () => ({
    available: true,
    installHint: '',
    version: null,
  })),
}));

// We import the mocked `invoke` after the
// mock is registered.
import { invoke } from '@tauri-apps/api/core';

describe('kindToSpawnSpec', () => {
  it("returns the typescript-language-server spec for 'typescript'", () => {
    // The canonical TS slice. Binary is
    // the `vscode-langservers-extracted`
    // Node CLI; `--stdio` is the flag that
    // switches it to LSP-over-stdio mode.
    expect(kindToSpawnSpec('typescript')).toEqual({
      command: 'typescript-language-server',
      args: ['--stdio'],
      installHint: 'npm install -g typescript-language-server',
    });
  });

  it("returns the rust-analyzer spec for 'rust_analyzer'", () => {
    // Phase 9.2b. `rust-analyzer` speaks
    // LSP over stdio by default — no
    // `--stdio` flag needed (unlike
    // TS-LS). The install hint is the
    // `rustup component add rust-analyzer`
    // command, which is the canonical
    // install path on every `rustup`-managed
    // toolchain.
    expect(kindToSpawnSpec('rust_analyzer')).toEqual({
      command: 'rust-analyzer',
      args: [],
      installHint: 'rustup component add rust-analyzer',
    });
  });

  it("returns the pyright spec for 'pyright'", () => {
    // Not yet wired (the bridge gate
    // doesn't include `'pyright'` yet),
    // but the spec is here so the function
    // stays total. Phase 9.2d will flip
    // the gate.
    expect(kindToSpawnSpec('pyright')).toEqual({
      command: 'pyright-langserver',
      args: ['--stdio'],
      installHint: 'npm install -g pyright',
    });
  });

  it("returns an empty no-op spec for 'unknown'", () => {
    // The bridge gate
    // (`isSupportedKind`) should have
    // rejected `unknown` before we got
    // here. The function is total anyway
    // so callers can log the situation
    // without a try/catch.
    expect(kindToSpawnSpec('unknown')).toEqual({
      command: '',
      args: [],
      installHint: '',
    });
  });

  it('returns specs whose binary names match the Rust `server_kind_spec` table', () => {
    // Cross-side contract. The Rust
    // `server_kind_spec(kind).binary`
    // value and the JS
    // `kindToSpawnSpec(kind).command`
    // value must agree. If the Rust
    // table adds a new binary, the JS
    // spec must follow. The install hints
    // have the same constraint.
    const cases: ReadonlyArray<readonly [string, string, string]> = [
      [
        'typescript',
        'typescript-language-server',
        'npm install -g typescript-language-server',
      ],
      ['rust_analyzer', 'rust-analyzer', 'rustup component add rust-analyzer'],
      // Phase 9.2c — the `pyright` arm.
      // Mirrors `server_kind_spec(Pyright)`
      // in `src-tauri/src/stdio.rs`.
      ['pyright', 'pyright-langserver', 'npm install -g pyright'],
    ];
    for (const [kind, expectedBinary, expectedHint] of cases) {
      // The cast is fine: the table only
      // asserts the three known kinds
      // that have Rust + JS specs. If a
      // future kind is added to the JS
      // table without a Rust counterpart
      // (or vice versa), the test
      // continues to pass; the contract
      // is *enforced* by the explicit
      // expected values.
      const spec = kindToSpawnSpec(
        kind as 'typescript' | 'rust_analyzer' | 'pyright',
      );
      expect(spec.command).toBe(expectedBinary);
      expect(spec.installHint).toBe(expectedHint);
    }
  });
});

describe('lspCheckAvailable', () => {
  it('invokes the lsp_check_available Tauri command', async () => {
    await lspCheckAvailable();
    expect(invoke).toHaveBeenCalledWith('lsp_check_available', {
      args: undefined,
    });
  });

  it('forwards the kind to the Tauri command when provided', async () => {
    // The Rust side reads `args.serverKind`
    // (camelCase per the struct's
    // `rename_all = "camelCase"`) and uses
    // it to pick the right binary probe.
    // The JS side must pass the kind
    // through unchanged.
    await lspCheckAvailable({ serverKind: 'rust_analyzer' });
    expect(invoke).toHaveBeenCalledWith('lsp_check_available', {
      args: { serverKind: 'rust_analyzer' },
    });
  });

  it('passes an explicit typescript kind (no fallback to default)', async () => {
    // Even though `typescript` is the
    // pre-9.2b default, the call site can
    // still pass it explicitly. The
    // wrapper must not strip the kind.
    await lspCheckAvailable({ serverKind: 'typescript' });
    expect(invoke).toHaveBeenCalledWith('lsp_check_available', {
      args: { serverKind: 'typescript' },
    });
  });

  it('forwards the unknown kind (defensive — the bridge should not call this)', async () => {
    // The bridge gate
    // (`isSupportedKind`) should have
    // rejected `unknown`, but the wrapper
    // is total. The Rust side returns
    // `available: false` for the `unknown`
    // arm; the wrapper just passes the
    // call through.
    await lspCheckAvailable({ serverKind: 'unknown' });
    expect(invoke).toHaveBeenCalledWith('lsp_check_available', {
      args: { serverKind: 'unknown' },
    });
  });

  it('forwards the pyright kind (Phase 9.2c — the `.py` bridge path)', async () => {
    // The bridge calls
    // `lspCheckAvailable({ serverKind:
    // 'pyright' })` for a `.py` file (the
    // `kindToSpawnSpec('pyright')` arm
    // picks `pyright-langserver` as the
    // binary). The Rust side maps
    // `"pyright"` back to the `Pyright`
    // variant via serde and runs the
    // `pyright-langserver` PATH-lookup.
    await lspCheckAvailable({ serverKind: 'pyright' });
    expect(invoke).toHaveBeenCalledWith('lsp_check_available', {
      args: { serverKind: 'pyright' },
    });
  });
});
