# ADR #80 — M6a: closing a workspace tab preserves its path in recents ("closed is not forgotten")

**Date**: June 2026
**Phase**: M6a (Multi-workspace tabs: data model + tab strip)
**Status**: Accepted
**Supersedes**: n/a (the pre-M6a close behaviour was implicitly the same — closing the only workspace navigated to Welcome, and the recents list was unchanged; the explicit policy is now a decision)
**Deciders**: project lead (Vimal Nair)

## Context

The pre-M6a `useWorkspaceStore` had two ways to "leave" a workspace:
- **Close the only open workspace** — the `currentPath` flipped to `null`, the user was routed to the Welcome screen. The recents list was unchanged.
- **Remove a path from recents** — explicit "remove from recents" action (the per-row `×` button in the Welcome screen's recents list).

The "remove from recents" action was a deliberate "I don't want this in my history" gesture. The "close the only open workspace" was a "I want to switch contexts" gesture, not a "forget this folder" gesture. The two gestures were conflated in the UI: closing the only open workspace didn't remove the path from recents, but a user could reasonably interpret "close" as "forget".

M6a's tab model makes the conflation more visible: with multiple tabs open, "close a tab" is a much more frequent gesture than the pre-M6a "close the only open workspace". A user who closes a tab to declutter the strip is signalling "I don't want this open right now", not "I never want to see this folder again". The recents list is the right place to keep the path — the user might re-open it tomorrow, and "I had to re-pick the folder from disk" is a worse UX than "I had to pick from recents".

The architectural question is: does closing a tab remove the closed path from recents, or preserve it?

The two options considered:

1. **Remove on close** — closing a tab also removes the path from recents. The recents list is "the paths I'd want to re-open from the Welcome screen", and a closed path is by definition not in that set. Selected against: the recents list is a history, not a "currently open" set; the pre-M6a UX preserved closed paths in recents, and the M6a UX should be consistent with that.

2. **Preserve on close** — closing a tab keeps the path in recents. The recents list is a history, and a closed path can be re-opened from the Welcome screen. Selected.

## Decision

### D1. Closing a tab preserves the closed path in recents

The `close(tabId?)` action's body:

```ts
close: (tabId) => {
  const state = get();
  const targetId = tabId ?? state.activeId;
  if (!targetId) return;
  const target = state.workspaces.find((w) => w.id === targetId);
  if (!target) return; // unknown tab id — no-op
  const nextWorkspaces = state.workspaces.filter((w) => w.id !== targetId);
  // ... pick the next active tab (right of closed, else last left, else null) ...
  set({
    workspaces: nextWorkspaces,
    activeId: nextActiveId,
    status: nextActivePath
      ? { kind: 'ready', path: nextActivePath }
      : { kind: 'idle' },
  });
  writeJson(STORAGE_KEY_WORKSPACES_V2, nextWorkspaces);
  writeJson(STORAGE_KEY_ACTIVE_ID_V2, nextActiveId);
  // We deliberately do NOT remove the closed path from `recents` — the
  // user might want to re-open the same folder later, and "closed" is
  // not "forgetting".
},
```

The closing action does NOT touch the `recents` field. The closed path stays in the recents list (if it was there before the tab was opened) or gets added to the recents list (if the user opened the path via the picker and never had it in recents before — the `open` action adds the path to recents as part of the dedup-and-cap logic).

The recents list is a `MAX_RECENTS` (5)-capped, deduped, newest-first list of paths. The "remove from recents" action (the per-row `×` button in the Welcome screen) is the explicit "forget this" gesture, and it stays unchanged. The "close a tab" action is the "I don't want this open right now" gesture, and it does not touch the recents list.

### D2. The "remove from recents" gesture is still explicit

The Welcome screen's recents list has a per-row `×` button (and a header "Clear all" button) that calls `useWorkspaceStore.getState().removeRecent(path)` (or `clearRecents()` for the header). These actions remove the path from recents and persist the change. The user can also open the same path from recents (the "Open Recent" Command Palette entries call `openWorkspace(path)` which delegates to `open(chosen)` — this re-activates the existing tab if the path is open, or adds a new tab if not).

The two gestures are orthogonal: "close a tab" doesn't touch recents, and "remove from recents" doesn't close any tab. The user can have a path in recents without having a tab open for it (e.g. they removed the tab but the path is still in their history), and they can have a tab open for a path that's not in recents (e.g. they opened it via the picker and the recents list is at its cap, so the open didn't add it).

### D3. The pre-M6a "close the only open workspace" UX is preserved

Pre-M6a, closing the only open workspace (which set `currentPath` to `null`) didn't touch the recents list. M6a's `close()` action preserves this behavior: closing the active tab (which sets `activeId` to `null` if it was the only one) doesn't touch the recents list. A user who closes their last tab is on the Welcome screen with the just-closed path in their recents — they can re-open it from the recents list (via the per-row Open button or the "Open Recent" Command Palette entry) without re-picking the folder from disk.

This is the "closed is not forgotten" semantic. The user can re-open a recently-closed path with one click.

## Consequences

### Positive

- "Close a tab" is a low-stakes gesture. The user can close a tab to declutter the strip without losing the path from their history.
- The recents list is a true history, not a "currently open" set. The user can see "I closed tab X yesterday and tab Y today" in the recents list, which is a useful audit trail.
- The "remove from recents" gesture is explicit. The user has to deliberately click `×` on a recents row to forget a path — they can't do it by accident via "close a tab".
- The pre-M6a UX is preserved. A user who relied on "close the only open workspace" to navigate to the Welcome screen (with the just-closed path still in recents) gets the same behavior in M6a.

### Negative

- The recents list can grow stale. A user who closes a tab and never re-opens it will see the path in their recents list for a long time. The `MAX_RECENTS` cap (5) limits this — older paths fall off the end of the list as newer ones are added. The "Clear all" button is the explicit "I want a fresh recents list" gesture.
- The distinction between "close" and "remove from recents" is implicit. A user who wants to "forget" a folder has to know that "close a tab" doesn't forget it, and they have to find the recents row's `×` button. The Welcome screen's recents list has a "Clear all" button at the top, but the per-row `×` is the only "forget this one" gesture. A future polish phase could add a "Remove from recents" entry to the recents row's right-click menu (the file-tree right-click menu is the canonical place for per-row destructive actions; a recents row's right-click menu is a natural extension).

## Implementation notes

- The `close()` action's body has a comment explaining the recents preservation: `// We deliberately do NOT remove the closed path from \`recents\` — the user might want to re-open the same folder later, and "closed" is not "forgetting".` This is a maintenance-tripwire: a future contributor who "fixes" the close action to also remove the path from recents will see the comment and understand the design intent.
- The `open()` action's body adds the path to recents (via `dedupAndCap(state.recents, path)`), but does NOT remove the path from recents when the tab is closed. The two actions are intentionally asymmetric: "open" adds to history, "close" does not touch history.
- The `removeRecent(path)` action's body filters the path out of the recents list and persists. The action is a no-op if the path is not in the list (the `if (!state.recents.includes(path)) return;` early-return). This is the explicit "forget this" gesture.
- The `clearRecents()` action's body sets the recents list to `[]` and persists. The Welcome screen's "Clear all" button is the only caller.

## References

- `src/shared/state/workspaceStore.ts` — the `close`, `open`, `removeRecent`, `clearRecents` actions
- `src/shared/state/workspaceStore.test.ts` — the `close` tests (including the "closed path is preserved in recents" assertion)
- `src/screens/Welcome/Welcome.tsx` — the "Remove from recents" `×` button and the "Clear all" header button
- `HANDOFF.md §9.22` — "M6a — SHIPPED" callout (the "Recents are unchanged in shape" section mentions this decision)
- `CHANGELOG.md` "Added (M6a — Multi-workspace tabs: data model + tab strip)" — the "Data model" section

---

*Last touched: M6a (June 2026). See `CHANGELOG.md` "Unreleased" for the user-facing summary.*
