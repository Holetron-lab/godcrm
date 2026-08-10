export interface StandardField {
  key: string;
  label: string;
  required: boolean;
}

export interface ColumnMapping {
  tableId: number;
  tableName: string;
  mappings: Record<string, string>;
}

export interface ColumnMappingDefaults {
  standardFields: StandardField[];
}
