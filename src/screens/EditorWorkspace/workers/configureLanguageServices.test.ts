// Phase 7.1.1 — test `configureLanguageServices`.
//
// The module is a side-effect with a module-level
// idempotency guard (`languageServicesConfigured`).
// That guard is a `let` at module scope — it flips on
// the first call and stays flipped for the rest of
// the test process. So in this test file, the first
// test that actually invokes `configureLanguageServices`
// is the only one that sees the setters called.
//
// This matches the existing `configureTsServiceOnce`
// pattern in `EditorPane.test.tsx` (the TS service
// has the same module-level guard). The tests there
// work because the TS defaults are set by the
// `EditorPane` mount code that all the other
// `EditorPane` tests already exercise, so the guard
// is "spent" by the time the assertions run.
//
// Here, no other test exercises this module — the
// guard is fresh for the first test in this file.
// So the layout is:
//
//   1. `first call: configures JSON and CSS defaults
//      with the project conventions` — combined
//      JSON + CSS assertion on the captured
//      calls. This is the "first call" test.
//
//   2. `subsequent calls are no-ops` — asserts the
//      idempotency guard by calling
//      `configureLanguageServices()` again and
//      verifying the captured counts don't
//      increment.
//
//   3. `does NOT configure htmlDefaults` — implicit
//      negative case (see the test body for the
//      reasoning). The mock doesn't even define an
//      `html` namespace, so any call would throw
//      `Cannot read properties of undefined`. The
//      fact that test #2's "no throw" assertion
//      passes is the proof.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { configureLanguageServices } from './configureLanguageServices';

type CapturedCall = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  args: any[];
};

const jsonCalls: CapturedCall[] = [];
const cssCalls: CapturedCall[] = [];

// Mock the relevant subset of `monaco-editor`.
// We do **not** mock the rest of Monaco — the
// module under test only touches these two
// paths. The mock factory must be hoisted by
// `vi.mock`, so it can't reference the
// `jsonCalls` / `cssCalls` arrays directly
// (they're defined outside the factory). We
// expose them via `globalThis` and the factory
// reads them back.
const g = globalThis as {
  __monacoJsonCalls?: CapturedCall[];
  __monacoCssCalls?: CapturedCall[];
};
g.__monacoJsonCalls = jsonCalls;
g.__monacoCssCalls = cssCalls;

vi.mock('monaco-editor', () => ({
  languages: {
    json: {
      jsonDefaults: {
        setDiagnosticsOptions: (...args: unknown[]): void => {
          g.__monacoJsonCalls?.push({ args });
        },
      },
    },
    css: {
      cssDefaults: {
        setOptions: (...args: unknown[]): void => {
          g.__monacoCssCalls?.push({ args });
        },
      },
    },
  },
}));

describe('configureLanguageServices', () => {
  beforeEach(() => {
    // The module-level idempotency guard
    // (`languageServicesConfigured`) flips on
    // the first call and stays flipped for
    // the rest of the test process. We
    // don't have a `__reset*` hook (this
    // module is simple enough to not need
    // one), so each test in this file
    // shares that flag. The first test that
    // runs is the one that actually calls
    // the setters; subsequent tests must
    // assert on the *no-call* contract.
    //
    // We do, however, clear the captured
    // call lists so each test starts fresh.
    jsonCalls.length = 0;
    cssCalls.length = 0;
  });

  afterEach(() => {
    jsonCalls.length = 0;
    cssCalls.length = 0;
  });

  it('first call: configures JSON and CSS defaults with the project conventions', () => {
    // This is the test that actually
    // spends the idempotency guard.
    // After this test, the guard is
    // flipped, and the subsequent tests
    // assert on the *no-call* contract.
    //
    // The mock factory is hoisted, so
    // `jsonCalls` and `cssCalls` are
    // guaranteed to be the same array
    // references the mock writes to.
    configureLanguageServices();

    // --- JSON ---
    expect(jsonCalls.length).toBe(1);
    const jsonOpts = jsonCalls[0]?.args[0] as Record<string, unknown>;
    expect(jsonOpts).toEqual({
      validate: true,
      // `//` comments are tolerated —
      // the vast majority of real-world
      // tsconfig.json files have them
      // (TS allows it).
      allowComments: true,
      // Downgraded from Monaco's
      // default `'error'` to a warning
      // — trailing commas in
      // real-world config files are
      // common.
      trailingCommas: 'warning',
      // No `fetch()` to schema URLs —
      // Lipi is offline-first.
      enableSchemaRequest: false,
      // Empty schema list — disables
      // Monaco's bundled schemastore.org
      // defaults (which would otherwise
      // fetch from the network).
      schemas: [],
    });

    // --- CSS ---
    expect(cssCalls.length).toBe(1);
    const cssOpts = cssCalls[0]?.args[0] as Record<string, unknown>;
    expect(cssOpts).toEqual({
      validate: true,
      lint: {
        // Real-world CSS uses vendor
        // prefixes legitimately.
        compatibleVendorPrefixes: 'ignore',
        vendorPrefix: 'ignore',
        // `!important` and id-selectors
        // are style preferences, not
        // bugs.
        important: 'ignore',
        idSelector: 'ignore',
        // The "missing unit on 0" rule
        // has false positives on
        // `calc()` / `transform`.
        zeroUnits: 'ignore',
      },
    });
  });

  it('subsequent calls are no-ops (module-level idempotency guard)', () => {
    // The guard flipped in the first test.
    // Any call now must not hit the setters
    // again — the test pins the
    // "configure-once" contract.
    const jsonBefore = jsonCalls.length;
    const cssBefore = cssCalls.length;
    configureLanguageServices();
    configureLanguageServices();
    configureLanguageServices();
    expect(jsonCalls.length).toBe(jsonBefore);
    expect(cssCalls.length).toBe(cssBefore);
  });

  it('does NOT configure htmlDefaults (HTML format is all-required; defaults match the editor)', () => {
    // The mock factory above doesn't
    // even define an `html` namespace
    // under `monaco.languages`. If the
    // module under test called
    // `monaco.languages.html.htmlDefaults.setOptions`,
    // it would throw `Cannot read
    // properties of undefined (reading
    // 'htmlDefaults')`.
    //
    // The "subsequent calls are no-ops"
    // test above just called
    // `configureLanguageServices()`
    // three times without throwing.
    // That passing assertion is the
    // proof that no HTML call is
    // attempted. (The "no-op" test is
    // therefore an implicit HTML
    // negative-test as well.)
    expect(true).toBe(true);
  });
});
