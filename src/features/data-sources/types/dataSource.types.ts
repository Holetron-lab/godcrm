export type DataSourceType = 'mysql' | 'postgresql' | 'sqlite' | 'local_mysql' | 'local_postgresql';
export type DataSourceStatus = 'connected' | 'disconnected' | 'testing' | 'error';

export interface DataSource {
  id: string;
  workspace_id: string;
  name: string;
  description?: string;
  type: DataSourceType;
  // Backend returns db_* fields
  host?: string;
  db_host?: string;
  port?: number;
  db_port?: number;
  database?: string;
  db_name?: string;
  username?: string;
  db_username?: string;
  password?: string; // Not returned from API
  
  // SSH Tunnel settings (optional)
  use_ssh?: boolean;
  ssh_host?: string;
  ssh_port?: number;
  ssh_user?: string;
  ssh_private_key?: string;
  
  // Connection state
  status?: DataSourceStatus;
  last_sync_at?: string | null;
  last_error?: string | null;
  
  // Stats
  table_count?: number;
  
  // Linked tables (NEW - for folder view)
  main_table_id?: string | null;
  
  created_at: string;
  updated_at: string;
}

/**
 * Table info from external data source (MySQL, PostgreSQL, etc.)
 */
export interface DataSourceTable {
  name: string;
  type?: 'table' | 'view';
  row_count?: number;
  columns?: DataSourceColumn[];
}

/**
 * Column info from external data source
 */
export interface DataSourceColumn {
  name: string;
  type: string;
  nullable: boolean;
  primary_key?: boolean;
  default_value?: string | null;
}

/**
 * Response from GET /api/v3/data-sources/:id/tables
 */
export interface DataSourceTablesResponse {
  success: boolean;
  data: DataSourceTable[];
}

/**
 * Linked CRM table info (tables imported from data source)
 */
export interface LinkedTable {
  id: string;
  name: string;
  displayName?: string;
  data_source_id: string;
  source_table_name: string;
  is_main?: boolean;
  row_count?: number;
}

/**
 * Data source with linked CRM tables (for sidebar folder view)
 */
export interface DataSourceWithTables extends DataSource {
  mainTable?: LinkedTable;
  linkedTables: LinkedTable[];
  totalTables: number;
}

export interface CreateDataSourceDto {
  workspace_id: string; // This is used as project_id in backend
  project_id?: number; // Target project for imported tables
  space_id?: number; // Space where System Data project should be created
  name: string;
  description?: string;
  type: DataSourceType;
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  
  // SSH Tunnel (optional)
  use_ssh?: boolean;
  ssh_host?: string;
  ssh_port?: number;
  ssh_user?: string;
  ssh_private_key?: string;
}

export interface UpdateDataSourceDto extends Partial<CreateDataSourceDto> {
  id: string;
}

export interface TestConnectionResult {
  success: boolean;
  message: string;
  latency_ms?: number;
  database_version?: string;
  error?: string;
}
