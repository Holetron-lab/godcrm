// backend/services/audit/__tests__/rowDiff.test.js
//
// ADR-0066 P1 — Unit tests for computeRowDiff.
//
// Pure CPU; no DB. Validates the diff helper used by row.update audits
// to stay within the 8 KiB cap on writeAudit() details.

import { describe, it, expect } from 'vitest';
import { computeRowDiff } from '../rowDiff.js';

describe('computeRowDiff — per-column diff for row.update audits', () => {
  it('returns null when nothing changed', () => {
    const a = { title: 'x', status: 'open' };
    const b = { title: 'x', status: 'open' };
    expect(computeRowDiff(a, b)).toBeNull();
  });

  it('emits only the columns whose values differ', () => {
    const a = { title: 'x', status: 'open', priority: 1 };
    const b = { title: 'x', status: 'closed', priority: 1 };
    expect(computeRowDiff(a, b)).toEqual({
      changed_columns: ['status'],
      before: { status: 'open' },
      after: { status: 'closed' },
    });
  });

  it('captures additions as before=null', () => {
    const a = { title: 'x' };
    const b = { title: 'x', registry_table_id: 2197 };
    const diff = computeRowDiff(a, b);
    expect(diff.changed_columns).toEqual(['registry_table_id']);
    expect(diff.before).toEqual({ registry_table_id: null });
    expect(diff.after).toEqual({ registry_table_id: 2197 });
  });

  it('captures removals as after=null (ADR-0067 canonical-erase detector)', () => {
    // The stop-condition (a) for P3 soak: someone saves a documents-widget
    // config that strips registry_table_id. This is what the soak detector
    // SQL grep'es for.
    const a = { registry_table_id: 2197, documents_table_id: 2197, project_id: 146 };
    const b = { documents_table_id: 2197, project_id: 146 };
    const diff = computeRowDiff(a, b);
    expect(diff.changed_columns).toEqual(['registry_table_id']);
    expect(diff.before).toEqual({ registry_table_id: 2197 });
    expect(diff.after).toEqual({ registry_table_id: null });
  });

  it('treats null/non-object inputs as empty objects', () => {
    expect(computeRowDiff(null, { x: 1 })).toEqual({
      changed_columns: ['x'],
      before: { x: null },
      after: { x: 1 },
    });
    expect(computeRowDiff({ x: 1 }, null)).toEqual({
      changed_columns: ['x'],
      before: { x: 1 },
      after: { x: null },
    });
    expect(computeRowDiff(null, null)).toBeNull();
  });

  it('uses deep-equality for nested objects (no false positives)', () => {
    const a = { config: { registry_table_id: 2197, project_id: 146 } };
    const b = { config: { registry_table_id: 2197, project_id: 146 } };
    expect(computeRowDiff(a, b)).toBeNull();

    const c = { config: { registry_table_id: 2197 } };
    const d = { config: { registry_table_id: 100008 } };
    const diff = computeRowDiff(c, d);
    expect(diff.changed_columns).toEqual(['config']);
  });
});
