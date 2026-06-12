# Engineering Standards — Lipi

These are the 7 rules every agent (human or AI) must follow when writing
or modifying code in this project. They are not aspirational; they are
the rules a PR is checked against. The source of truth for *what* we
build is `HANDOFF.md`; the source of truth for *how* we build it is
this file.

> **TL;DR for AI agents:** before writing any UI in Lipi, read this file.
> The grep target is `src/shared/components/` — if a component there
> covers your need, use it. If it doesn't, extend it (same name) or
> open an issue. Never reimplement.

---

## Rule 1 — Left and right alignment for spacing

There is a single spacing scale in `src/shared/styles/tokens.css`:

```
--space-1: 4px
--space-2: 8px
--space-3: 12px
--space-4: 16px   ← mobile screen gutter
--space-6: 24px
--space-8: 32px   ← desktop screen gutter
--space-12: 48px
```

- **Mobile screens** use `var(--space-4)` (16px) as the left/right gutter.
- **Desktop screens** use `var(--space-6)` or `var(--space-8)` (24–32px).
- **Every component CSS** reads from these tokens. No raw `padding: 16px`.
- **Vertical rhythm** uses the same scale. No magic pixel values.
- **Use the `Stack` primitive** (`src/shared/components/Stack/`) for
  any flex layout that needs a gap. Stack's `gap` prop is typed to the
  scale (`StackGap = 0 | 1 | 2 | 3 | 4 | 6 | 8 | 12`).

> **Why:** when every screen aligns to the same invisible rails, the
> product feels like one product. Eyeballed spacing is the #1 reason
> apps look "off" without anyone being able to point to a specific bug.

---

## Rule 2 — Name each screen

Every screen has a single canonical name, used identically in:

- the file path: `src/screens/<ScreenName>/`
- the component name: `export function <ScreenName>()`
- the route (when we add routing in 1b): `/<screen-kebab-case>`
- the navigation label and any cross-references

**Naming convention:** `<Domain><Action><State>` in PascalCase.

| Screen             | File                          | Route                  |
|--------------------|-------------------------------|------------------------|
| Welcome            | `src/screens/Welcome/`        | `/`                    |
| EditorWorkspace    | `src/screens/EditorWorkspace/`| `/workspace`           |
| SettingsProvider   | `src/screens/SettingsProvider/` (future) | `/settings/provider` |
| AIPanel            | (sub-component, not a screen) | n/a                  |
| VoiceCapture       | (sub-component, not a screen) | n/a                  |
| DeviceEmulator     | (dev-only, not a screen)       | n/a                  |

**Sub-components inside a screen** are *not* screens. They live in
`src/screens/<ScreenName>/components/`. Don't confuse the two.

> **Why:** one name per concept. When we rename, we rename in one
> place — the screen folder. If we ever add synonyms, the rule is
> "rename, don't add."

---

## Rule 3 — Code lives in folders, screen-wise

```
src/
  screens/
    EditorWorkspace/                 # one folder per screen
      EditorWorkspace.tsx
      EditorWorkspace.module.css
      index.ts                       # re-exports the screen
      components/                    # owned by this screen
        TitleBar/
          TitleBar.tsx
          TitleBar.module.css
          index.ts
        ...
      hooks/                         # owned by this screen
        useViewport.ts
      state/                         # owned by this screen
      index.ts
    Welcome/
      index.ts
  shared/                            # cross-screen primitives only
    components/
      Button/                        # typed component folder
      IconButton/
      Stack/
    hooks/                           # used by 2+ screens
    state/                           # cross-screen stores
    styles/                          # tokens + global
  dev/                               # gated by import.meta.env.DEV
  voice/                             # cross-screen service
  main.tsx                           # entry, NEVER contains UI
  vite-env.d.ts
```

**Two-tier rule:**

- `src/shared/` — used by 2+ screens. If only one screen uses it,
  it doesn't belong here.
- `src/screens/<Name>/` — owned by that screen. Don't import from
  another screen's folder directly. If two screens both need something,
  promote it to `shared/`.

**Each component folder has the same shape:**

```
<ComponentName>/
  <ComponentName>.tsx        # the component
  <ComponentName>.module.css # co-located CSS
  index.ts                   # re-exports the component (and its Props type)
```

> **Why:** the folder is the unit of refactor. Move a whole screen by
> moving its folder; only consumers of `index.ts` need updates.

---

## Rule 4 — Build components, reuse components, AI must use them

**The grep target:** `src/shared/components/index.ts`. Before writing
any UI, search it. If a component covers your need, use it. If it
doesn't, extend it (same name) or open an issue. **Never reimplement.**

**Available now:**

| Component | When to use |
|---|---|
| `Button` | Any clickable action. Variants: `primary` \| `secondary` \| `ghost` \| `danger`. Sizes: `sm` \| `md` \| `lg`. Supports `loading`. |
| `IconButton` | Square icon-only buttons in toolbars / table rows. **Required** `aria-label`. Sizes: `sm` \| `md` \| `lg`. Variants: `default` \| `subtle` \| `danger`. |
| `Stack` | Flexbox row or column with token-driven gap. The universal layout primitive. |

**Component rules:**

- PascalCase name. One component per file. Co-located CSS module.
- Single responsibility (one JSDoc sentence that fits in one line).
- Public `Props` interface, exported alongside the component.
- `index.ts` re-exports the component **and** its `Props` type.

**Audit pass:** when a new component is added to `shared/`, grep every
screen for places that *could* use it and refactor them. This is
part of the workflow, not optional.

> **Why:** divergence compounds. Two slightly-different `Button`
> implementations today mean ten divergent buttons next year, and
> the design system rots from the inside out. AI agents are the
> worst offender — they "helpfully" reimplement instead of searching.
> This rule is the explicit guard against that.

---

## Rule 5 — Best-coding-practice defaults

When writing code, the following are defaults unless you have a
documented reason to deviate. AI agents: surface deviations to the
user, don't just apply them.

1. **TypeScript strict.** No `any`. Use `unknown` + type guards or
   define a proper type. `noUnusedLocals` and `noUnusedParameters` are on.
2. **No magic strings or numbers.** Constants and tokens only.
3. **No raw hex in component code.** Always `var(--color-*)`.
4. **Accessibility first.** Every interactive element has an
   accessible name, focus styles are visible, touch targets ≥ 44×44,
   color contrast AA.
5. **Error states are first-class.** Every async call has a loading
   + error UI, not just success.
6. **Empty states are first-class.** Every list, pane, and screen
   has a designed empty state.
7. **No dead code, no commented-out code, no `TODO` placeholders** in
   shipped code. TODOs in stubs for the *next* phase are fine and
   must be labeled `// TODO(M2):` or similar.
8. **Smallest reasonable abstraction.** A component, a hook, a util —
   not a "framework." We don't introduce a pattern until the second
   use case shows up.
9. **Public APIs are typed and exported. Internal helpers are not.**
10. **Tests for behavior, not implementation.** (No test runner set up
    yet — that's a separate decision for the phase that introduces it.)

---

## Rule 6 — Divide code in sections, isolate changes

**File-level isolation:** each component, hook, and screen lives in
its own file. A change to one is, by construction, isolated from
others. This is the baseline we already have.

**Folder + ownership rules:**

- A screen owns its folder. Edits inside `src/screens/EditorWorkspace/**`
  do not touch `src/screens/SettingsProvider/**`.
- A shared component is owned by whoever built it first; modifications
  to it require a "why" in the commit message.
- `tokens.css` is the only place spacing/colors/typography values
  live. No component CSS may redefine them. So when we change the
  design tokens, the visual change propagates everywhere.

**The practical workflow:**

When changing something, work in one section at a time. If a change
*requires* a cross-section edit, flag it explicitly before doing it:

> "This needs a touch-up in `AIPanel.module.css` too — OK to proceed?"

**Blast-radius check:** before writing a change, state the scope:

> "This affects only `src/screens/EditorWorkspace/components/AIPanel/`."

If the answer is "I have to touch four folders for this one feature",
that's a smell — re-scope before writing.

> **Why:** scoped changes are reviewable. Big-bang changes are not.
> The blast-radius check makes scope visible *before* we commit to
> it, when it's still cheap to re-scope.

---

## Rule 7 — Always choose scalable, upgradeable

When picking between two ways to do something, ask:

1. Can a 100× growth in users / features be handled by *adding*
   (not rewriting)?
2. Can this be replaced with a better tool in 2 years without
   rewriting every consumer?
3. Is the choice the same one Cursor, VS Code, JetBrains, Linear,
   and Figma have already battle-tested?

If yes to all three, that's the scalable choice. If no, surface
the trade-off to the user before writing code.

**Concrete defaults for Lipi:**

| Decision area | Scalable choice |
|---|---|
| State management | Zustand stores split by domain (workspace, settings, voice, git), not one giant store. Each store is independently testable and replaceable. |
| Component design | Composition over configuration. `Button` accepts `as` and `children`; doesn't grow a `variant` prop with 20 cases. |
| Type system | Discriminated unions for variants (`type: 'partial' \| 'final'`), not boolean soup. New variant = add a case, not edit a hundred conditionals. |
| Styling | CSS Modules + design tokens. No styled-components / emotion / Tailwind. We own the tokens and the cascade. |
| IPC (when Tauri arrives) | Typed wrapper around `invoke()`. No raw `invoke('command_name', args)` calls scattered in components. |
| Voice (M2/M3) | `VoiceProvider` interface with multiple impls. Adding a 5th provider is one new file, no edits to consumers. |
| Build / toolchain | Vite + Tauri. Both mainstream and well-maintained. No experimental builds. |
| Distribution | Auto-updater + per-platform package channels. |
| Testing (later) | Vitest + Playwright. Mainstream, fast, plays well with Vite. |

> **Why:** the cheapest day to add scalability is today. The most
> expensive day to add it is six months from now, when there's
> 10× the code to refactor.

---

## Enforcement

These rules are not enforced by a linter (yet). They are enforced
by:

1. **Code review** — every PR is checked against this doc.
2. **AI agents** — every prompt to an AI agent should reference
   this file by name. The first action of any agent picking up
   Lipi work is to read this file.
3. **Audit passes** — when a new pattern is added, the diff
   includes a sweep of existing code that should adopt it.

If a rule needs to change, change it *here* and in any code that
depends on it. The rules are a single source of truth, not folklore.
