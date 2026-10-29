export interface CreateTableModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId?: number | null;
  projects?: Array<{ id: number; name: string; space_id?: number | null }>;
  onOpenDataSourceWizard?: () => void;
}

export interface ColorPickerProps {
  value: string | null;
  onChange: (color: string | null) => void;
  compact?: boolean;
}

// CSV Column Definition
export interface CSVColumnDefinition {
  colIndex: number; // Original column index in CSV (for unique keys)
  csvColumn: string;
  name: string;
  displayName: string;
  type: string;
  emoji?: string; // Column emoji icon
  excluded?: boolean; // Column excluded from import
  // Notion relation fields
  isNotionRelation?: boolean;
  relationTargetFileId?: string; // Which CSV file this relates to
  // Relation config for creating the column
  relationValueColumn?: string; // Column to use for value (notion_id, id, name)
  relationLabelColumn?: string; // Column to use for display (name, title)
  relationStorageFormat?: 'comma' | 'json' | 'semicolon' | 'single'; // How to store multiple values
  // Relation select - select that gets options from another table
  isRelationSelect?: boolean;
  relationSelectTargetFileId?: string;
  // Reverse relations (lookups from other tables)
  reverseRelations?: Array<{
    targetFileId: string; // Target table file id
    targetColumn: string; // Column in target table to write to
    labelColumn?: string; // Column to use for display value
  }>;
}

// Type for CSVColumnDefinition field values
export type CSVColumnFieldValue = CSVColumnDefinition[keyof CSVColumnDefinition];

// Excel preview contract — backend/services/README.excel-import.md
export type ExcelCellValue = string | number | boolean | null;

export interface ExcelSheetInfo {
  index: number;
  name: string;
  rowCount: number;
  columnCount: number;
  hidden: boolean;
}

export interface ExcelWarning {
  code: string;
  message: string;
  sheetIndex?: number;
  rowIndex?: number;
  colIndex?: number;
}

export interface ExcelPreviewResponse {
  format: 'xls' | 'xlsx';
  sheets: ExcelSheetInfo[];
  sheet: null | (ExcelSheetInfo & {
    rows: string[][];
    values: ExcelCellValue[][];
    emptyRowCount: number;
    skippedCellCount: number;
  });
  warnings: ExcelWarning[];
  limits: Record<string, number>;
}

// One fixed rows/import request. Each batch keeps its own stable UUID.
export interface ExcelImportBatch {
  importId: string;
  rows: Record<string, unknown>[];
}

// Frozen once creation starts; retried verbatim so the backend receipts match.
export interface ExcelImportState {
  importId: string;
  createBody: string;
  batches: ExcelImportBatch[];
  skippedEmptyRows: number;
  excludedColumns: number;
  tableId?: number;
  completedBatchIds: string[];
  importedRows: number;
  error?: string | null;
}

export interface ExcelFileState {
  file: File;
  format: 'xls' | 'xlsx' | null;
  sheets: ExcelSheetInfo[];
  sheetIndex: number | null;
  values: ExcelCellValue[][];
  warnings: ExcelWarning[];
  emptyRowCount: number;
  skippedCellCount: number;
  loading: boolean;
  error: string | null;
  importId: string; // regenerated whenever another sheet is chosen
  importState?: ExcelImportState;
}

// CSV File Definition for multi-file support
export interface CSVFileData {
  id: string;
  fileName: string;
  tableName: string;
  tableDisplayName: string;
  tableDescription: string;
  icon: string;
  color: string | null; // Table header color
  showInMenu: boolean;
  menuWidgetTitle: string;
  menuWidgetIcon: string;
  menuWidgetDescription: string;
  data: string[][];
  headers: string[];
  columnDefinitions: CSVColumnDefinition[];
  // Map of primary value (Name) -> row index for relation matching
  primaryValueIndex?: Map<string, number>;
  // 'csv' (default) keeps every existing path; 'excel' is server-previewed.
  source?: 'csv' | 'excel';
  excel?: ExcelFileState;
}

export interface NotionImportLogEntry {
  text: string;
  resolved: boolean;
  source?: string;
}
