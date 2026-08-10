export interface ExternalTableInfo {
  name: string;
  row_count: number;
  columns: ExternalColumnInfo[];
}

export interface ExternalColumnInfo {
  name: string;
  type: string;
  nullable: boolean;
  default_value?: string;
  is_primary_key: boolean;
}

export interface CustomColumnDefinition {
  name: string;
  display_name: string;
  type: string;
  is_required: boolean;
}

export interface SyncConfig {
  enabled: boolean;
  interval_minutes: number;
  auto_archive_deleted: boolean;
}

export interface ImportTableConfig {
  // Step 1: Data Source
  dataSourceId: string;
  
  // Step 2: Table Selection
  tableName: string;
  tableInfo?: ExternalTableInfo;
  
  // Step 3: ID Column
  idColumn: string;
  idColumnValid?: boolean;
  
  // Step 4: Sync Config
  syncConfig: SyncConfig;
  
  // Step 5: Custom Columns (Optional)
  customColumns: CustomColumnDefinition[];
  
  // Metadata
  displayName?: string;
  description?: string;
  icon?: string;
}

export interface ImportTablePayload {
  workspace_id: string;
  project_id?: string;
  data_source_id: string;
  source_table_name: string;
  source_id_column: string;
  display_name: string;
  description?: string;
  icon?: string;
  table_type: 'external' | 'hybrid';
  sync_enabled: boolean;
  sync_interval_minutes: number;
  custom_columns?: CustomColumnDefinition[];
}
