import { useMemo } from 'react';

/**
 * useLaneAxis — shared lane resolver for widgets that group rows by a column
 * (Kanban columns, Timeline groups, …). Resolves `select | multi-select | relation | text`
 * into a stable list of lanes plus a row-bucket map.
 *
 * ADR-0034 P0.
 */

export type LaneKind = 'select' | 'multi-select' | 'relation' | 'text' | 'unknown';

export interface Lane {
  key: string;
  label: string;
  color?: string;
  order: number;
}

export interface LaneAxisColumn {
  name: string;
  type?: string;
  config?: {
    options?: Array<{ value: string; label: string; color?: string }>;
    relation?: {
      enabled?: boolean;
      tableId?: string | number;
      valueColumn?: string;
      labelColumn?: string;
    };
    relatedTableId?: string | number;
    [k: string]: unknown;
  };
}

export type RelationDataMap = Map<
  string,
  Map<string, { label: string; color?: string; order?: number }>
>;

export interface LaneAxisRow {
  id?: string | number;
  data?: Record<string, unknown>;
  [k: string]: unknown;
}

export type UnmatchedRowMode = 'unassigned' | 'derive' | 'drop';

export interface UseLaneAxisParams<R extends LaneAxisRow = LaneAxisRow> {
  groupByColumn: LaneAxisColumn | string | null | undefined;
  columnsInfo?: LaneAxisColumn[];
  rows: R[];
  relationData?: RelationDataMap;
  laneOrderColumn?: string;
  unmatchedRowMode?: UnmatchedRowMode;
  unassignedLabel?: string;
}

export interface UseLaneAxisResult<R extends LaneAxisRow> {
  kind: LaneKind;
  lanes: Lane[];
  rowsByLane: Map<string, R[]>;
  laneByKey: Map<string, Lane>;
}

export const UNASSIGNED_KEY = '__unassigned__';

function resolveColumn(
  groupByColumn: LaneAxisColumn | string | null | undefined,
  columnsInfo?: LaneAxisColumn[],
): LaneAxisColumn | null {
  if (!groupByColumn) return null;
  if (typeof groupByColumn === 'string') {
    return columnsInfo?.find((c) => c.name === groupByColumn) ?? { name: groupByColumn };
  }
  return groupByColumn;
}

function detectKind(column: LaneAxisColumn | null): LaneKind {
  if (!column) return 'unknown';
  const rel = column.config?.relation;
  if (rel?.enabled || column.config?.relatedTableId) return 'relation';
  if (column.type === 'multi-select' || column.type === 'multi_select') return 'multi-select';
  if (column.type === 'select') return 'select';
  return 'text';
}

function relTableId(column: LaneAxisColumn | null): string | null {
  if (!column) return null;
  const id = column.config?.relation?.tableId ?? column.config?.relatedTableId;
  return id == null ? null : String(id);
}

function extractKeys(raw: unknown): string[] {
  if (raw == null || raw === '') return [];
  if (Array.isArray(raw)) {
    return raw.map((v) => (v == null ? '' : String(v))).filter((s) => s !== '');
  }
  return [String(raw)];
}

/**
 * Pure (non-hook) variant — same algorithm, no React. Exposed for unit tests
 * and any non-component callers.
 */
export function buildLaneAxis<R extends LaneAxisRow = LaneAxisRow>(
  params: UseLaneAxisParams<R>,
): UseLaneAxisResult<R> {
  const {
    groupByColumn,
    columnsInfo,
    rows,
    relationData,
    laneOrderColumn,
    unmatchedRowMode = 'unassigned',
    unassignedLabel = 'Unassigned',
  } = params;

  const column = resolveColumn(groupByColumn, columnsInfo);
  const kind = detectKind(column);
  const colName = column?.name;

  const lanes: Lane[] = [];
  const laneByKey = new Map<string, Lane>();

  const pushLane = (lane: Lane) => {
    if (laneByKey.has(lane.key)) return;
    laneByKey.set(lane.key, lane);
    lanes.push(lane);
  };

  // 1) Seed lanes from the column metadata.
  if (kind === 'select' || kind === 'multi-select') {
    const opts = column?.config?.options ?? [];
    opts.forEach((opt, i) => {
      pushLane({
        key: String(opt.value),
        label: opt.label ?? String(opt.value),
        color: opt.color,
        order: i,
      });
    });
  } else if (kind === 'relation') {
    const tid = relTableId(column);
    const tableMap = tid && relationData ? relationData.get(tid) : undefined;
    if (tableMap) {
      const entries = Array.from(tableMap.entries());
      entries.sort((a, b) => {
        const oa = a[1].order;
        const ob = b[1].order;
        if (oa != null && ob != null) return oa - ob;
        if (oa != null) return -1;
        if (ob != null) return 1;
        return a[1].label.localeCompare(b[1].label, undefined, { numeric: true });
      });
      entries.forEach(([rowId, meta], i) => {
        pushLane({ key: rowId, label: meta.label, color: meta.color, order: i });
      });
    }
  }

  // 2) Bucket rows.
  const rowsByLane = new Map<string, R[]>();
  const ensureBucket = (key: string) => {
    let arr = rowsByLane.get(key);
    if (!arr) {
      arr = [];
      rowsByLane.set(key, arr);
    }
    return arr;
  };

  const ensureUnassignedLane = () => {
    if (laneByKey.has(UNASSIGNED_KEY)) return;
    pushLane({
      key: UNASSIGNED_KEY,
      label: unassignedLabel,
      order: lanes.length + 1_000_000,
    });
  };

  if (!colName) {
    // No grouping column → single synthetic lane carries all rows.
    ensureUnassignedLane();
    const bucket = ensureBucket(UNASSIGNED_KEY);
    rows.forEach((r) => bucket.push(r));
    return { kind, lanes, rowsByLane, laneByKey };
  }

  rows.forEach((row) => {
    const keys = extractKeys(row.data?.[colName]);
    if (keys.length === 0) {
      if (unmatchedRowMode === 'drop') return;
      ensureUnassignedLane();
      ensureBucket(UNASSIGNED_KEY).push(row);
      return;
    }
    keys.forEach((rawKey) => {
      if (laneByKey.has(rawKey)) {
        ensureBucket(rawKey).push(row);
        return;
      }
      if (unmatchedRowMode === 'drop') return;
      if (unmatchedRowMode === 'derive') {
        let label = rawKey;
        let color: string | undefined;
        if (kind === 'relation') {
          const tid = relTableId(column);
          const meta = tid && relationData ? relationData.get(tid)?.get(rawKey) : undefined;
          if (meta) {
            label = meta.label;
            color = meta.color;
          }
        }
        pushLane({ key: rawKey, label, color, order: lanes.length });
        ensureBucket(rawKey).push(row);
        return;
      }
      // 'unassigned'
      ensureUnassignedLane();
      ensureBucket(UNASSIGNED_KEY).push(row);
    });
  });

  // 3) Text columns: when no seed exists, derive lanes from observed values.
  //    (Skipped if we already populated lanes via select/relation seeding.)
  const seedCount = laneByKey.has(UNASSIGNED_KEY) ? lanes.length - 1 : lanes.length;
  if (kind === 'text' && seedCount === 0) {
    const observed = new Set<string>();
    rows.forEach((row) => {
      extractKeys(row.data?.[colName]).forEach((k) => observed.add(k));
    });
    const sorted = Array.from(observed).sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true }),
    );
    sorted.forEach((value, i) => {
      if (laneByKey.has(value)) return;
      pushLane({ key: value, label: value, order: i });
    });

    // Re-bucket rows from UNASSIGNED → derived text lanes.
    const unassignedBucket = rowsByLane.get(UNASSIGNED_KEY);
    if (unassignedBucket) {
      const remaining: R[] = [];
      unassignedBucket.forEach((row) => {
        const rowKeys = extractKeys(row.data?.[colName]);
        if (rowKeys.length === 0) {
          remaining.push(row);
          return;
        }
        rowKeys.forEach((k) => {
          if (laneByKey.has(k) && k !== UNASSIGNED_KEY) {
            ensureBucket(k).push(row);
          } else {
            remaining.push(row);
          }
        });
      });
      if (remaining.length === 0) {
        rowsByLane.delete(UNASSIGNED_KEY);
        const idx = lanes.findIndex((l) => l.key === UNASSIGNED_KEY);
        if (idx !== -1) lanes.splice(idx, 1);
        laneByKey.delete(UNASSIGNED_KEY);
      } else {
        rowsByLane.set(UNASSIGNED_KEY, remaining);
      }
    }
  }

  // 4) Optional ordering by laneOrderColumn (min numeric of bucket).
  if (laneOrderColumn) {
    const laneOrderValue = (laneKey: string): number => {
      const bucket = rowsByLane.get(laneKey);
      if (!bucket || bucket.length === 0) return Number.POSITIVE_INFINITY;
      let min = Number.POSITIVE_INFINITY;
      bucket.forEach((row) => {
        const v = row.data?.[laneOrderColumn];
        const n = typeof v === 'number' ? v : Number(v);
        if (!Number.isNaN(n) && n < min) min = n;
      });
      return min;
    };
    lanes.sort((a, b) => {
      if (a.key === UNASSIGNED_KEY) return 1;
      if (b.key === UNASSIGNED_KEY) return -1;
      return laneOrderValue(a.key) - laneOrderValue(b.key);
    });
    lanes.forEach((l, i) => {
      l.order = i;
    });
  }

  return { kind, lanes, rowsByLane, laneByKey };
}

export function useLaneAxis<R extends LaneAxisRow = LaneAxisRow>(
  params: UseLaneAxisParams<R>,
): UseLaneAxisResult<R> {
  const {
    groupByColumn,
    columnsInfo,
    rows,
    relationData,
    laneOrderColumn,
    unmatchedRowMode,
    unassignedLabel,
  } = params;

  return useMemo(
    () =>
      buildLaneAxis({
        groupByColumn,
        columnsInfo,
        rows,
        relationData,
        laneOrderColumn,
        unmatchedRowMode,
        unassignedLabel,
      }),
    [
      groupByColumn,
      columnsInfo,
      rows,
      relationData,
      laneOrderColumn,
      unmatchedRowMode,
      unassignedLabel,
    ],
  );
}
