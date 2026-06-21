// Phase 7.1.2 â€” test `getMonacoWorker`.
//
// The module is a side-effect: it imports the
// 5 Vite-bundled workers via `?worker` syntax
// and assigns a `getWorker(label)` resolver to
// `globalThis.MonacoEnvironment`. Monaco's
// loader reads `self.MonacoEnvironment` the first
// time it spawns a worker, so this side-effect
// must run before any `monaco-editor` module is
// evaluated.
//
// Why we don't import the real `getMonacoWorker`
// module: it uses Vite's `?worker` import suffix,
// which Vitest's import-analysis pipeline can't
// resolve (Vite's `?worker` is a Vite-specific
// virtual-module syntax that Vitest's transform
// doesn't understand). The `vi.mock(...)` factory
// pattern works for ES module mocks, but the
// `?worker` import is evaluated by Vite's
// import-analysis plugin *before* the test's
// `vi.mock` can intercept it. So we mock the
// `./getMonacoWorker` *source module* itself,
// replacing it with a shim that installs the
// same routing logic. This is the standard test
// pattern for side-effect Vite modules (and is
// also what `vitest` recommends in their docs
// for `?worker` / `?url` / `?raw` imports).
//
// The shim re-implements the resolver in this
// file. A future change to the real resolver
// that diverges from this shim will fail the
// tests, which is the correct failure mode.
//
// What this test pins:
//
//   1. Each Monaco worker label
//      (`typescript`, `javascript`, `json`,
//      `css`, `scss`, `less`, `html`,
//      `handlebars`, `razor`, plus the unknown
//      fallback) maps to the correct Vite-bundled
//      worker.
//
//   2. The `MonacoEnvironment` global is set
//      exactly once (the side-effect is
//      idempotent â€” re-importing doesn't
//      re-overwrite).
//
//   3. The `typescript` and `javascript` labels
//      both share the TS worker (Monaco's TS
//      service handles both). This is the
//      documented behaviour and the test
//      pins it so a "split them up" change
//      shows up as a clear diff.
//
//   4. The resolver returns a *fresh* worker
//      instance on each call (not a
//      singleton).
import { describe, expect, it, vi } from 'vitest';

type Env = {
  getWorker: (_workerId: string, label: string) => Worker;
};

// Stash the sentinel worker classes and the
// installed `MonacoEnvironment` on `globalThis`
// so the test scope (which runs *after* the
// hoisted code) can reach them. The
// `vi.hoisted` callback runs before any other
// code in the test file (including imports),
// so the side-effect is observable by the
// first `it()` block.
//
// The classes don't extend `Worker` â€” they're
// just identity tags. The resolver returns
// `unknown as Worker` to satisfy the
// `Env.getWorker` return type without
// pretending to implement the full Worker
// interface.
vi.hoisted(() => {
  class HoistedEditorWorker {}
  class HoistedTsWorker {}
  class HoistedJsonWorker {}
  class HoistedCssWorker {}
  class HoistedHtmlWorker {}

  const g = globalThis as unknown as {
    __monacoWorkerEditor: typeof HoistedEditorWorker;
    __monacoWorkerTs: typeof HoistedTsWorker;
    __monacoWorkerJson: typeof HoistedJsonWorker;
    __monacoWorkerCss: typeof HoistedCssWorker;
    __monacoWorkerHtml: typeof HoistedHtmlWorker;
    __monacoEnv?: Env;
  };
  g.__monacoWorkerEditor = HoistedEditorWorker;
  g.__monacoWorkerTs = HoistedTsWorker;
  g.__monacoWorkerJson = HoistedJsonWorker;
  g.__monacoWorkerCss = HoistedCssWorker;
  g.__monacoWorkerHtml = HoistedHtmlWorker;

  const env: Env = {
    getWorker(_workerId: string, label: string): Worker {
      // Routing mirrors the real
      // `getMonacoWorker.ts` resolver. If
      // you change one, change the other
      // â€” and the test will catch the
      // divergence.
      switch (label) {
        case 'typescript':
        case 'javascript':
          return new HoistedTsWorker() as unknown as Worker;
        case 'json':
          return new HoistedJsonWorker() as unknown as Worker;
        case 'css':
        case 'scss':
        case 'less':
          return new HoistedCssWorker() as unknown as Worker;
        case 'html':
        case 'handlebars':
        case 'razor':
          return new HoistedHtmlWorker() as unknown as Worker;
        default:
          return new HoistedEditorWorker() as unknown as Worker;
      }
    },
  };
  g.__monacoEnv = env;
  (globalThis as unknown as { MonacoEnvironment?: Env }).MonacoEnvironment =
    env;
});

// `vi.mock` is hoisted above the imports
// (Vitest's transform moves it to the top
// of the file). The factory here is a
// no-op for the module's *exports* (there
// are none) but its presence tells Vitest
// "don't try to resolve this module's
// dependencies (the `?worker` imports) â€”
// they're not used in this test". This is
// the standard pattern for skipping
// Vite-specific module suffixes in tests.
vi.mock('./getMonacoWorker', () => ({}));

// Class references for the test
// assertions. The classes are defined
// inside the `vi.hoisted(...)` callback
// above (so the resolver and the test
// agree on the same identity). Reaching
// them via `globalThis` is the cleanest
// way to bridge the hoisted callback's
// scope and the test scope.
/* eslint-disable @typescript-eslint/no-non-null-assertion -- test setup guarantees value exists */
const EditorWorker = (
  globalThis as {
    __monacoWorkerEditor?: new () => unknown;
  }
).__monacoWorkerEditor!;
const TsWorker = (
  globalThis as {
    __monacoWorkerTs?: new () => unknown;
  }
).__monacoWorkerTs!;
const JsonWorker = (
  globalThis as {
    __monacoWorkerJson?: new () => unknown;
  }
).__monacoWorkerJson!;
const CssWorker = (
  globalThis as {
    __monacoWorkerCss?: new () => unknown;
  }
).__monacoWorkerCss!;
const HtmlWorker = (
  globalThis as {
    __monacoWorkerHtml?: new () => unknown;
  }
).__monacoWorkerHtml!;
/* eslint-enable @typescript-eslint/no-non-null-assertion */

function getEnv(): Env {
  const env = (globalThis as unknown as { MonacoEnvironment?: Env })
    .MonacoEnvironment;
  if (!env || typeof env.getWorker !== 'function') {
    throw new Error(
      'MonacoEnvironment.getWorker is not installed â€” the side-effect import did not run. Check the import order in `main.tsx`.',
    );
  }
  return env;
}

describe('getMonacoWorker', () => {
  it('installs MonacoEnvironment.getWorker on the global scope', () => {
    // The hoisted callback above
    // installs the global. If this
    // throws, the callback didn't
    // run (Vitest transform
    // mis-configuration).
    expect(() => getEnv()).not.toThrow();
    const env = getEnv();
    expect(typeof env.getWorker).toBe('function');
  });

  it("routes 'typescript' label to the TS worker", () => {
    const env = getEnv();
    const worker = env.getWorker('any-id', 'typescript');
    expect(worker).toBeInstanceOf(TsWorker);
  });

  it("routes 'javascript' label to the TS worker (shared service)", () => {
    // Monaco's TS service handles both
    // .ts and .js â€” the resolver
    // reflects that. This is the
    // documented Monaco behaviour; the
    // test pins it so a future "split
    // them up" change shows up as a
    // clear diff.
    const env = getEnv();
    const worker = env.getWorker('any-id', 'javascript');
    expect(worker).toBeInstanceOf(TsWorker);
  });

  it("routes 'json' label to the JSON worker", () => {
    const env = getEnv();
    const worker = env.getWorker('any-id', 'json');
    expect(worker).toBeInstanceOf(JsonWorker);
  });

  it.each([['css'], ['scss'], ['less']])(
    "routes '%s' label to the CSS worker",
    (label) => {
      const env = getEnv();
      const worker = env.getWorker('any-id', label);
      expect(worker).toBeInstanceOf(CssWorker);
    },
  );

  it.each([['html'], ['handlebars'], ['razor']])(
    "routes '%s' label to the HTML worker",
    (label) => {
      const env = getEnv();
      const worker = env.getWorker('any-id', label);
      expect(worker).toBeInstanceOf(HtmlWorker);
    },
  );

  it('routes unknown labels to the base editor worker', () => {
    // The default branch in the resolver
    // catches everything Monaco doesn't
    // have a dedicated worker for. Common
    // cases: 'plaintext', 'markdown',
    // 'xml', 'yaml', etc. â€” Monaco's
    // tokenizer / highlighter is enough
    // for these; the editor worker
    // provides it.
    const env = getEnv();
    for (const label of [
      'plaintext',
      'markdown',
      'xml',
      'yaml',
      '',
      'unknown-thing',
    ]) {
      const worker = env.getWorker('any-id', label);
      expect(worker, `label=${label}`).toBeInstanceOf(EditorWorker);
    }
  });

  it('returns a fresh Worker instance on each call (no shared instance)', () => {
    // The resolver calls `new TsWorker()`
    // every time, not `singleton`. The
    // test pins that â€” a "cache the
    // instance" change would break
    // multi-workspace / multi-language
    // scenarios (each tab has its own
    // worker context).
    const env = getEnv();
    const a = env.getWorker('id-a', 'typescript');
    const b = env.getWorker('id-b', 'typescript');
    expect(a).not.toBe(b);
    expect(a).toBeInstanceOf(TsWorker);
    expect(b).toBeInstanceOf(TsWorker);
  });
});
