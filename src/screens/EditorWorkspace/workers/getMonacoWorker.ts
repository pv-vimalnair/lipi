// Phase 7: Monaco language worker registration.
//
// Monaco uses Web Workers for its language services (TypeScript, JSON,
// CSS, HTML, etc.). By default Monaco tries to load these workers from
// a CDN URL, which (a) won't work offline and (b) wouldn't be served
// by Vite anyway. We override `MonacoEnvironment.getWorker` to return
// bundled worker instances via Vite's `?worker` import syntax.
//
// IMPORTANT: this module is a side-effect import. It assigns to
// `self.MonacoEnvironment` and must run BEFORE any `monaco-editor`
// module is evaluated. The Monaco loader reads `self.MonacoEnvironment`
// the first time it spawns a worker, so this file must be imported
// at the top of `main.tsx`, before anything that pulls in
// `@monaco-editor/react` transitively.
//
// The label set here is the canonical set Monaco uses when it asks
// for a worker. `typescript` and `javascript` both share the TS
// worker (Monaco's TS service handles both). Everything else falls
// back to the base editor worker (which is just the editor's own
// services — no language smarts).
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker';
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker';

// Monaco-editor's own `editor.api.d.ts` already declares the global
// `MonacoEnvironment` ambient binding (typed as `monaco.Environment | undefined`),
// so we don't redeclare it here. We cast through `unknown` so we can
// assign our worker resolver without TypeScript's `noImplicitAny` rule
// widening the cast.
const env = (globalThis as unknown as { MonacoEnvironment?: unknown });
env.MonacoEnvironment = {
  getWorker(_workerId: string, label: string): Worker {
    switch (label) {
      case 'typescript':
      case 'javascript':
        return new tsWorker();
      case 'json':
        return new jsonWorker();
      case 'css':
      case 'scss':
      case 'less':
        return new cssWorker();
      case 'html':
      case 'handlebars':
      case 'razor':
        return new htmlWorker();
      default:
        return new editorWorker();
    }
  },
};
