# ADR #78 — M6a: `WorkspaceTabs` tests use a real DOM render, not `renderToStaticMarkup`

**Date**: June 2026
**Phase**: M6a (Multi-workspace tabs: data model + tab strip)
**Status**: Accepted
**Supersedes**: n/a
**Deciders**: project lead (Vimal Nair)

## Context

The pre-M6a React component tests in the Lipi codebase (e.g. `FileTreePane`, `SettingsProvider` cards) use `renderToStaticMarkup` from `react-dom/server` for structural assertions. It's a one-liner that returns the rendered HTML as a string — no DOM, no event handlers, no `useEffect`. It's the right tool for "is this component tree structurally correct?" and it's faster than `createRoot` for tests that don't care about behaviour.

The M6a `WorkspaceTabs` component reads from `useWorkspaceStore` (Zustand) via `useWorkspaceStore(workspaceSelectors.workspaces)`. The first test of M6a ("renders one pill per workspace") did:

```ts
useWorkspaceStore.setState({ workspaces: [...], activeId: 't1' });
const html = renderToStaticMarkup(createElement(WorkspaceTabs));
expect(html).toMatch(/role="tablist"/);
```

The test failed with `expected null to be truthy` / `html.match(/role="tab"/g)` returning `null` and a `TypeError: Cannot read properties of null (reading 'length')` on the `.toHaveLength(2)` assertion. The component was rendering an empty string — but the `setState` was visible in `useWorkspaceStore.getState()` after the call. The bug wasn't a logic error in the component; it was a **Zustand + SSR + `useSyncExternalStore` interaction** that made the component see the *initial* state, not the test's `setState`.

## Decision

### D1. M6a `WorkspaceTabs` tests use a real DOM render (`createRoot` + `act`)

All 6 `WorkspaceTabs.test.tsx` tests use a `mount()` helper that creates a fresh `div` per test, mounts the component with `createRoot(container)` inside an `act()` block, runs the assertion against `container.querySelector(...)`, and unmounts on cleanup. The `pickFolder` IPC is mocked at the top of the file with `vi.hoisted` + `vi.mock('@/ipc/fs', ...)` so the `+` button test can stub the picker's return value.

### D2. `renderToStaticMarkup` is NOT the right tool for components that read live Zustand state

The Zustand v4 source (see `node_modules/zustand/react.js`):

```js
function useStore(api, selector = identity) {
  const slice = React.useSyncExternalStore(
    api.subscribe,
    React.useCallback(() => selector(api.getState()), [api, selector]),
    React.useCallback(() => selector(api.getInitialState()), [api, selector])
  );
  ...
}
```

The third argument to `useSyncExternalStore` is the **server snapshot** — what `useSyncExternalStore` returns during SSR. Zustand returns `selector(api.getInitialState())` — the *initial* state, not the live state. `renderToStaticMarkup` IS SSR (it runs through React's server renderer), so the component sees the initial state, not whatever the test set up via `useWorkspaceStore.setState({...})` before the render.

The bug is silent for tests that don't mutate the store after module load. The `WorkspaceTabs` tests did mutate the store (to set up the per-test tab list), so the bug surfaced. A test that just renders the component against the default store (e.g. `Welcome` smoke tests that mount the screen with no `setState`) would work fine with `renderToStaticMarkup`, because `getInitialState()` and `getState()` are the same object in that case.

### D3. The pattern: any test that mutates the store before render must use DOM render

The rule of thumb: if a test does `useXxxStore.setState({...})` (or `getState().someAction()`) before mounting the component, the test MUST use a real DOM render, not `renderToStaticMarkup`. The DOM render subscribes to the live state via the regular `useSyncExternalStore` path, so the test's `setState` is visible to the component.

`renderToStaticMarkup` is still the right tool for:
- Tests that don't mutate the store (e.g. `Modal` smoke tests that mount with static props and assert on the resulting HTML).
- Tests that test pure rendering (no React state, no hooks beyond the static props).
- Tests that test error boundaries (the fallback HTML is static).

DOM render is required for:
- Tests that mutate the store after module load (including all `useState`-style tests, click handlers, `useEffect` assertions, etc.).
- Tests that test reactivity (the component re-renders on store change).

## Consequences

### Positive

- The test debug output is unambiguous. The `process.stderr.write` calls in the failing test showed:
  ```
  DEBUG state: [{t1}, {t2}]              // test set up
  DEBUG WorkspaceTabs activeId: null getState activeId: t1  // BUG
  ```
  Once the pattern is identified (the hook returns `null` while `getState()` returns the test's value), the fix (use DOM render) is the obvious one.
- Future tests of components that read Zustand state will go to DOM render by default. The `vi.mock` + `vi.hoisted` pattern for IPC stubs is well-established; the `mount()` helper is two lines and reusable.
- The component's behaviour (click-to-switch, click-to-close, click-to-add) is testable end-to-end, not just structurally. The click tests are the canonical "does this work?" gate.

### Negative

- DOM render is slightly slower than `renderToStaticMarkup` (~10-30ms per test, depending on the component tree). The 6 `WorkspaceTabs` tests run in ~40ms total, which is well within the 5-second vitest budget.
- The `mount()` helper allocates a `div` per test and needs a `try/finally` for the unmount. The `renderToStaticMarkup` one-liner is cleaner. We accept the boilerplate as the cost of correctness.
- The `WorkspaceTabs` "renders nothing" test (the first one) used to be a one-liner: `expect(renderToStaticMarkup(createElement(WorkspaceTabs))).toBe('')`. The DOM-render version is 5 lines: `const { container, root } = mount(); try { expect(container.querySelector('[role="tablist"]')).toBeNull(); } finally { ... }`. The DOM-render version is a stronger test (it actually checks the DOM, not just the static markup), so the boilerplate is justified.

## Implementation notes

- The `pickFolder` mock is hoisted with `vi.hoisted` so the `vi.mock('@/ipc/fs', ...)` factory can reference the same `vi.fn` instance:
  ```ts
  const pickFolderMock = vi.hoisted(() => vi.fn().mockResolvedValue(null));
  vi.mock('@/ipc/fs', () => ({ pickFolder: pickFolderMock }));
  ```
  The `beforeEach` calls `pickFolderMock.mockReset()` to clear the call history between tests. The "click the + button" test calls `pickFolderMock.mockResolvedValueOnce('/projects/picked')` to set up the picker's return value for that one test.
- The `mount()` helper returns `{ container, root }` so the test can `unmount()` + `container.remove()` in a `finally` block. The unmount is wrapped in `act()` to flush the `useEffect` cleanup paths.
- The click tests use `container.querySelector('[data-testid="workspace-tab-t2"]')` to find the tab, then `act(() => t2Pill.click())` to dispatch the click. The `data-testid` attributes are stable (one per tab id, plus one per close button) and the CSS doesn't depend on them.
- The `await act(async () => { addBtn.click(); await Promise.resolve(); await Promise.resolve(); })` pattern in the "click the + button" test gives the awaited `pickFolder()` a chance to resolve (twice — once for the `await` in `onAddTab`, once for the `setState` that `open()` does on completion).

## References

- `src/screens/EditorWorkspace/components/WorkspaceTabs/WorkspaceTabs.test.tsx` — the 6 tests
- `node_modules/zustand/react.js` — the `useStore` definition that motivates the rule
- `HANDOFF.md §9.22` — "M6a — SHIPPED" callout (the "test breakthrough" section walks through the debug)
- `CHANGELOG.md` "Added (M6a — Multi-workspace tabs: data model + tab strip)" — the "Backward compatibility" section mentions this rule

---

*Last touched: M6a (June 2026). See `CHANGELOG.md` "Unreleased" for the user-facing summary.*
