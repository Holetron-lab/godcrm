export interface ProjectTablesNavProps {
  projectId: number;
  isExpanded?: boolean;
  isPrivileged?: boolean;
  searchQuery?: string; // Optional search filter
}

export interface TableItem {
  id: string;
  name: string;
  displayName?: string;
  sourceName?: string; // Original table name (key)
  sync_target?: string | null;
  data_source_id?: number | null;
  data_source_name?: string | null;
  show_in_nav?: number | null;
}

export interface NavFolder {
  id: string;
  name: string;
  items: string[]; // table ids
  isExpanded: boolean;
}

export interface NavOrganization {
  folders: NavFolder[];
  rootItems: string[]; // table ids not in folders
  order: string[]; // all ids (folders and root items) in display order
}

export interface SortableTableItemProps {
  table: TableItem;
  isActive: boolean;
  isDragging?: boolean;
  projectId: number;
  isPrivileged?: boolean; // If true, Ctrl+Click copies table ID
}

export interface SortableFolderProps {
  folder: NavFolder;
  tables: Map<string, TableItem>;
  onToggle: () => void;
  onRename: (newName: string) => void;
  onDelete: () => void;
  currentPath: string;
  projectId: number;
  isPrivileged?: boolean;
}

export interface ExternalTableItemProps {
  table: TableItem;
  isActive: boolean;
  projectId: number;
}

export interface SystemTableItemProps {
  table: TableItem;
  isActive: boolean;
  projectId: number;
}

export interface ExternalDbGroupProps {
  dbName: string;
  tables: TableItem[];
  isExpanded: boolean;
  onToggle: () => void;
  currentPath: string;
  projectId: number;
}
