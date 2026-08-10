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
}

export interface NotionImportLogEntry {
  text: string;
  resolved: boolean;
  source?: string;
}
