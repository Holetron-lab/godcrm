// ADR-207 §2.5 — shared column-mapping contract.
//
// One vocabulary for every place that lines a source column up with a target
// column: the CSV import (source = CSV header, target = table column) and the
// module install plan (source = blueprint column, target = column of the
// connected instance table). The three outcomes per column mirror the server
// `bindings.tables[].columns[].target`: an existing column, `__new`, or null.

/** Sentinel target: add the source column to the target table as a new column. */
export const NEW_COLUMN = '__new' as const;

/** Where a source column lands: an existing column id/name, a new column, or nowhere. */
export type ColumnTarget = string | typeof NEW_COLUMN | null;

/** Which rule produced an automatic match. */
export type ColumnMatchKind = 'name' | 'display_name' | 'normalized_name' | 'normalized_display_name';

/** Minimal shape a target column must expose. `ColumnModel` and server plan rows both satisfy it. */
export interface TargetColumnLike {
  /** Stable identifier used as `ColumnMapping.targetColumn` (column id for CSV, `column_name` for installs). */
  id: string;
  name: string;
  displayName?: string | null;
  type: string;
}

export interface ColumnMapping {
  /** Source column label (CSV header / blueprint `module_column`). */
  sourceColumn: string;
  targetColumn: ColumnTarget;
  /** Type used for value conversion; follows the target column when one is chosen. */
  type: string;
  /** Set when the target was chosen automatically; cleared on manual reassignment. */
  match?: ColumnMatchKind | null;
}

/** Server-side verdict for one mapping row (ADR-207 §2.5 response). Presentational only on the client. */
export interface ColumnMappingCompat {
  compat: 'ok' | 'conflict';
  reason?: string | null;
}

export interface ColumnTypeOption {
  value: string;
  label: string;
  icon?: string;
}
