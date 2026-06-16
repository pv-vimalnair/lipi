// Phase 7.1.1 — JSON / CSS default-service
// configuration.
//
// Why this file exists
// ---------------------
// Phase 7 wired up Monaco's language-service Web Workers
// (TypeScript, JSON, CSS, HTML) via `getMonacoWorker.ts`,
// but left the *defaults objects* at Monaco's hard-coded
// factory values. That's correct for the base editor
// worker, but the language services each have a
// `setDiagnosticsOptions` / `setOptions` hook that
// controls real behaviour:
//
//   - **JSON**: Monaco's default treats `//` comments and
//     trailing commas as **errors**, which is technically
//     right per RFC 8259 but trips up almost every
//     real-world `tsconfig.json` / `package.json` /
//     `.eslintrc.json` users open. The fix is to allow
//     comments and downgrade trailing commas to a warning
//     — a common convention (VS Code's default for these
//     files is the same).
//
//   - **CSS**: Monaco's lint rules flag `vendorPrefix`
//     and `compatibleVendorPrefixes` as **warnings** by
//     default, which produces noise on any real-world
//     stylesheet that uses `-webkit-` / `-moz-` prefixes.
//     `idSelector` and `important` are similarly noisy.
//     The fix is to silence the rules that don't have
//     an objective answer in a normal project.
//
//   - **HTML**: deliberately not configured. Monaco's
//     `HTMLFormatConfiguration` is *all-required* (no
//     partial updates) and the defaults already match
//     the editor's `tabSize: 2` + `insertSpaces: true`.
//     If a future slice needs to pin `wrapAttributes`
//     or similar, it has to enumerate the full config
//     object — see the `--- HTML ---` block below.
//
// Phase 7 already established this pattern for
// `typescriptDefaults` + `javascriptDefaults` (see
// `EditorPane.tsx` `configureTsServiceOnce`). This file
// is the JSON / CSS sibling.
//
// Lifecycle
// ---------
// Like `configureTsServiceOnce`, this is a module-level
// guard. The defaults are *global Monaco state* (one
// `jsonDefaults` per Monaco instance, shared by every
// `.json` model). Configuring them more than once is
// wasteful but not harmful — the guard makes it
// idempotent so `EditorPane.handleMount` can call it
// on every mount without re-paying the cost.
//
// Why a separate file
// -------------------
// `EditorPane.tsx` is already large. The TS-only
// `configureTsServiceOnce` lives there because it needs
// the editor's `compilerOptions` from `tsConfigStore`,
// and that store is editor-local. JSON / CSS defaults
// have no editor-local state, so they don't belong in
// `EditorPane.tsx`. A side-effect module is also
// testable in isolation — `getMonacoWorker.ts`
// established that pattern.
import * as monaco from 'monaco-editor';

// Idempotency guard. Matches the pattern of
// `tsServiceConfigured` in `EditorPane.tsx`.
let languageServicesConfigured = false;

/**
 * Configure Monaco's JSON / CSS default services
 * for the project's conventions. Idempotent —
 * safe to call from `EditorPane.handleMount` on
 * every mount.
 *
 * Behaviour summary:
 * - JSON: allow `//` comments; treat trailing
 *   commas as a warning; disable network schema
 *   fetches (Lipi is offline-first; no CDN calls).
 * - CSS: keep validation on, but silence the lint
 *   rules that flag real-world stylesheets
 *   (vendor prefixes, `!important`, id selectors).
 * - HTML: deliberately not configured. Monaco's
 *   HTML `setOptions` requires *every* field
 *   (`HTMLFormatConfiguration` is all-required),
 *   and the defaults already match the editor's
 *   `tabSize: 2` + `insertSpaces: true`. If a
 *   future slice needs to pin `wrapAttributes`
 *   or similar, it has to enumerate the full
 *   config object (see the `--- HTML ---` block
 *   below for the rationale).
 */
export function configureLanguageServices(): void {
  if (languageServicesConfigured) return;
  languageServicesConfigured = true;

  // --- JSON ---
  // Monaco's hard-coded default is `validate: true,
  // allowComments: false, trailingCommas: 'error'`.
  // The realistic tsconfig.json / package.json files
  // in the wild use `//` comments (TS allows it) and
  // sometimes have trailing commas. We follow VS Code's
  // default for these files.
  //
  // We do **not** set `enableSchemaRequest: true` —
  // that triggers a `fetch()` to the URL in a file's
  // `$schema` field, which fails offline and adds
  // startup cost. Users who want schema validation
  // can register an explicit schema via the schema
  // store (a follow-up, not this slice).
  monaco.languages.json.jsonDefaults.setDiagnosticsOptions({
    validate: true,
    allowComments: true,
    trailingCommas: 'warning',
    enableSchemaRequest: false,
    // The empty `schemas` array disables Monaco's
    // built-in default schemas (which include
    // http://json.schemastore.org/*). They're useful
    // online but not what we want offline.
    schemas: [],
  });

  // --- CSS ---
  // Monaco's `setOptions` (the non-deprecated API for
  // CSS) takes a richer shape than the JSON / TS
  // diagnostic options. We keep `validate: true`
  // (syntax checking) but disable the lint rules
  // that flag legitimate real-world stylesheets.
  //
  // The `format` block is left at Monaco's defaults:
  // the editor's `tabSize: 2` flows through to the
  // formatter via the model's `FormattingOptions`
  // (Monaco reads it from the model registration,
  // not from this defaults object). Pinning format
  // here would mostly just lock in `newlineBetween*`
  // booleans, which are already at the right
  // values.
  monaco.languages.css.cssDefaults.setOptions({
    validate: true,
    lint: {
      // Vendor prefixes are intentional in most
      // production CSS (`-webkit-`, `-moz-`).
      compatibleVendorPrefixes: 'ignore',
      vendorPrefix: 'ignore',
      // The "don't use IDs as selectors" rule is
      // a style preference, not a bug. Project
      // conventions vary.
      idSelector: 'ignore',
      // `!important` is sometimes necessary; let
      // the project decide, not the linter.
      important: 'ignore',
      // The "you forgot a unit on 0" rule has
      // false positives on `calc()` / `transform`
      // expressions.
      zeroUnits: 'ignore',
    },
  });

  // --- HTML ---
  // Monaco's HTML defaults are reasonable. We
  // intentionally don't call `setOptions` here:
  // `HTMLFormatConfiguration` requires *every*
  // field (no partial updates), and the defaults
  // already match our project's `tabSize: 2` +
  // `insertSpaces: true`. If we want to pin
  // `wrapAttributes: 'auto'` later, we'll do it
  // as a separate slice that enumerates the full
  // config object. (The monaco-html 0.52 API
  // doesn't expose a `merge`-style updater.)
  //
  // This asymmetry between JSON / CSS (partial
  // `setOptions` / `setDiagnosticsOptions`) and
  // HTML (all-required) is a Monaco API quirk
  // worth noting in the HANDOFF — if a future
  // slice needs to change HTML format, it has
  // to enumerate the whole shape.
}
