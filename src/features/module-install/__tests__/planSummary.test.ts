// ADR-207 §2.6 — summarizePlan: what the confirmation step tells about a dry-run plan.
import { describe, expect, it } from 'vitest';
import { summarizePlan } from '../planSummary';
import { blueprint, plan } from './fixtures';

describe('summarizePlan', () => {
  it('counts the tables glued to the space by name and target, the created ones, the seed and the surfaces', () => {
    expect(summarizePlan(plan(), blueprint)).toEqual({
      connect: [{ name: 'tickets', target: 'tickets #1708' }],
      create: ['SLA rules'],
      skip: [],
      seed: [{ name: 'SLA rules', insert: 12 }],
      apps: 1,
      tiles: 1,
      changes: 17,
      blocked: false,
    });
  });

  it('leaves out a skipped table and its seed, a seed the server turned off, and counts existing surfaces as nothing new', () => {
    const summary = summarizePlan(plan({
      tables: [
        { key: 'sla', name: 'sla_rules', table_id: null, action: 'skip', columns_added: [] },
        { key: 'companies', name: 'companies', table_id: 100846, action: 'columns_added', columns_added: ['inn'] },
      ],
      seed: [{ table: 'sla', insert: 12, existing: 8 }, { table: 'companies', insert: 3, existing: 0, disabled_reason: 'rows exist' }],
      apps: [{ key: 'board', preset_name: 'kanban', title: 'Board', dashboard_id: null, widget_id: 110, action: 'adopt', binds: [] }],
      tiles: [{ key: 'open_count', preset_name: 'number_widget', title: 'Open tickets', dashboard_id: 7536, widget_id: 9, action: 'existing', binds: [] }],
      conflicts: [{ kind: 'TABLE_SKIP_DEPENDENCY', blocking: true, table: 'sla' }],
      changes: 2,
    }), blueprint);
    expect(summary.connect).toEqual([{ name: 'Companies', target: 'companies #100846' }]);
    expect(summary.create).toEqual([]);
    expect(summary.skip).toEqual(['SLA rules']);
    expect(summary.seed).toEqual([]);
    expect(summary.apps).toBe(1);
    expect(summary.tiles).toBe(0);
    expect(summary.blocked).toBe(true);
  });
});
