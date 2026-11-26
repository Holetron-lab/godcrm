// ADR-207 §2.6 — what the confirmation step of the module page says about a dry-run plan (owner, chat
// 3813, 11.11.2026): how many tables the module glues to existing ones and which, what it creates, what
// it seeds, and how much else it places. Read off the plan as the server sent it; nothing is decided here.
import type { InstallPlan, ModuleBlueprint } from './types';

export interface PlanSummary {
  /** Tables the module connects to existing tables of the space: module name → space table name. */
  connect: { name: string; target: string }[];
  /** Tables the module creates. */
  create: string[];
  /** Tables left out by the user. */
  skip: string[];
  /** Rows the install seeds, per table, once the seed is on and the table is not skipped. */
  seed: { name: string; insert: number }[];
  apps: number;
  tiles: number;
  changes: number;
  blocked: boolean;
}

export function summarizePlan(plan: InstallPlan, blueprint: ModuleBlueprint): PlanSummary {
  const declared = [...(blueprint.tables ?? []), ...(blueprint.requires?.tables ?? [])];
  const name = (key: string) => declared.find(table => table.key === key)?.display_name || plan.tables.find(table => table.key === key)?.name || key;
  const placed = (entries: { action: string }[] | undefined) => (entries ?? []).filter(entry => entry.action === 'create' || entry.action === 'adopt').length;
  const skipped = new Set(plan.tables.filter(table => table.action === 'skip').map(table => table.key));
  return {
    connect: plan.tables.filter(table => table.action === 'connect' || table.action === 'columns_added')
      .map(table => ({ name: name(table.key), target: table.name ? `${table.name} #${table.table_id}` : `#${table.table_id}` })),
    create: plan.tables.filter(table => table.action === 'create').map(table => name(table.key)),
    skip: [...skipped].map(name),
    seed: plan.seed.filter(entry => !entry.skipped && !entry.disabled_reason && entry.insert > 0 && !skipped.has(entry.table))
      .map(entry => ({ name: name(entry.table), insert: entry.insert })),
    apps: placed(plan.apps),
    tiles: placed(plan.tiles),
    changes: plan.changes,
    blocked: plan.conflicts.some(conflict => conflict.blocking),
  };
}
