/**
 * Tests for the template registry metadata. We don't
 * validate the actual file bodies here — those live in
 * Rust and are unit-tested in `templates.rs`. We do
 * assert the JS-side invariants:
 *   1. Every id is unique (and matches the union).
 *   2. Every template has a non-empty name + description.
 *   3. `byId` returns the matching entry.
 */
import { describe, expect, it } from 'vitest';

import {
  WORKSPACE_TEMPLATES,
  workspaceTemplateById,
  type WorkspaceTemplateId,
} from './registry';

describe('WORKSPACE_TEMPLATES', () => {
  it('has 5 entries (the plan full set)', () => {
    expect(WORKSPACE_TEMPLATES).toHaveLength(5);
  });

  it('has unique ids', () => {
    const ids = WORKSPACE_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every template has a name and a description', () => {
    for (const t of WORKSPACE_TEMPLATES) {
      expect(t.name.length).toBeGreaterThan(0);
      expect(t.description.length).toBeGreaterThan(0);
    }
  });

  it('every id is a known WorkspaceTemplateId', () => {
    const known: WorkspaceTemplateId[] = [
      'react-vite',
      'tauri-rust',
      'node-api',
      'python-venv',
      'go-module',
    ];
    for (const t of WORKSPACE_TEMPLATES) {
      expect(known).toContain(t.id);
    }
  });
});

describe('workspaceTemplateById', () => {
  it('returns the matching template', () => {
    const t = workspaceTemplateById('tauri-rust');
    expect(t?.name).toMatch(/Tauri/);
  });
});
