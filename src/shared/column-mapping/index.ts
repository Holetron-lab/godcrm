// ADR-207 §2.5 — shared column-mapping module.
// Consumers: CreateTableModal CSV/Excel import (W3.1) and InstallPlanTree (W3.3).
export * from './types';
export { normalizeColumnName } from './normalize';
export { parseCSV } from './parse-csv';
export { guessColumnType } from './guess-column-type';
export { convertValue } from './convert-value';
export {
  findMatchingColumn,
  autoMatchColumns,
  setMappingTarget,
  setMappingType,
  isExistingTarget,
  type ColumnMatch,
  type AutoMatchOptions,
} from './auto-match';
export { applyColumnMappings, countMappedColumns, type ApplyMappingsOptions } from './apply-mappings';
export { ColumnMappingRow, type ColumnMappingRowProps, type ColumnMappingRowLabels } from './ColumnMappingRow';
