export interface SMTPConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  from: string;
}

// ADR-039: Backup Types
export interface BackupInfo {
  filename: string;
  type: 'daily' | 'weekly' | 'manual';
  size_mb: number;
  created_at: string;
  path: string;
}

export interface BackupsResponse {
  last_backup: BackupInfo | null;
  db_size_mb: number;
  backups: BackupInfo[];
  schedule: {
    daily: string;
    weekly: string;
  };
}

// ADR-039: DB Monitoring Types
export interface TableStat {
  schemaname: string;
  table_name: string;
  row_count: number;
  dead_rows: number;
  last_vacuum: string | null;
  last_autovacuum: string | null;
}

export interface SlowQuery {
  query: string;
  calls: number;
  mean_time_ms: number;
  total_time_ms: number;
}

export interface DbStatsResponse {
  database_type: 'postgresql' | 'sqlite';
  active_connections?: number;
  db_size_mb?: number;
  table_stats?: TableStat[];
  slow_queries?: SlowQuery[];
  slow_queries_enabled?: boolean;
  last_vacuum?: string | null;
  max_connections?: number;
  message?: string;
}
