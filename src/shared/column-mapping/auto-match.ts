// ADR-207 §2.5 rule 1 — automatic source→target column matching plus the pure
// state transitions a mapping UI needs (reassign target, change type).
import { guessColumnType } from './guess-column-type';
import { normalizeColumnName } from './normalize';
import { NEW_COLUMN, type ColumnMapping, type ColumnMatchKind, type ColumnTarget, type TargetColumnLike } from './types';

export interface ColumnMatch<T extends TargetColumnLike = TargetColumnLike> {
  column: T;
  match: ColumnMatchKind;
}

/**
 * Find the target column for a source header. Exact (case-insensitive) `name`
 * wins, then exact `displayName`, then the same two with whitespace,
 * underscores and hyphens ignored. Returns null when nothing matches.
 */
export function findMatchingColumn<T extends TargetColumnLike>(
  source: string,
  targets: readonly T[],
): ColumnMatch<T> | null {
  const lower = source.toLowerCase();
  const byName = targets.find(c => c.name.toLowerCase() === lower);
  if (byName) return { column: byName, match: 'name' };
  const byDisplay = targets.find(c => c.displayName?.toLowerCase() === lower);
  if (byDisplay) return { column: byDisplay, match: 'display_name' };

  const key = normalizeColumnName(source);
  if (!key) return null;
  const byNormName = targets.find(c => normalizeColumnName(c.name) === key);
  if (byNormName) return { column: byNormName, match: 'normalized_name' };
  const byNormDisplay = targets.find(c => normalizeColumnName(c.displayName) === key);
  if (byNormDisplay) return { column: byNormDisplay, match: 'normalized_display_name' };
  return null;
}

export interface AutoMatchOptions {
  /** Raw sample values per source column, used to guess a type for unmatched columns. */
  sampleValues?: (source: string, index: number) => string[];
  /**
   * Target for columns nothing matched. Default null (skip) keeps the CSV
   * behaviour; the install screen passes NEW_COLUMN so module columns are
   * added by default.
   */
  unmatchedTarget?: ColumnTarget;
}

/**
 * Build the initial mapping list for a set of source headers. Matched columns
 * take the target's type; unmatched ones fall back to `guessColumnType`.
 */
export function autoMatchColumns<T extends TargetColumnLike>(
  sources: readonly string[],
  targets: readonly T[],
  options: AutoMatchOptions = {},
): ColumnMapping[] {
  const { sampleValues, unmatchedTarget = null } = options;
  return sources.map((source, index) => {
    const found = findMatchingColumn(source, targets);
    if (found) {
      return { sourceColumn: source, targetColumn: found.column.id, type: found.column.type, match: found.match };
    }
    const samples = sampleValues ? sampleValues(source, index) : [];
    return { sourceColumn: source, targetColumn: unmatchedTarget, type: guessColumnType(source, samples), match: null };
  });
}

/**
 * Manual reassignment. Choosing an existing column locks the type to that
 * column's type (ADR-207 §2.5 rule 3: an existing column's type never
 * changes); choosing `__new` or null keeps the current type.
 */
export function setMappingTarget<T extends TargetColumnLike>(
  mappings: readonly ColumnMapping[],
  sourceColumn: string,
  target: ColumnTarget,
  targets: readonly T[],
): ColumnMapping[] {
  return mappings.map(m => {
    if (m.sourceColumn !== sourceColumn) return m;
    const targetCol = target && target !== NEW_COLUMN ? targets.find(c => c.id === target) : undefined;
    return { ...m, targetColumn: target, type: targetCol ? targetCol.type : m.type, match: null };
  });
}

/** Change the conversion type of one mapping (meaningful for `__new` / unmatched columns). */
export function setMappingType(
  mappings: readonly ColumnMapping[],
  sourceColumn: string,
  type: string,
): ColumnMapping[] {
  return mappings.map(m => (m.sourceColumn === sourceColumn ? { ...m, type } : m));
}

/** True when the mapping points at an existing target column (not new, not skipped). */
export function isExistingTarget(target: ColumnTarget): target is string {
  return typeof target === 'string' && target !== NEW_COLUMN;
}
