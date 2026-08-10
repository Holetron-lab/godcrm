import { useState, useCallback, useMemo, useEffect } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import { 
  ChevronRight, ChevronDown, Database, Loader2, Zap, Webhook, 
  HardDrive, Cloud, GripVertical, Folder, FolderOpen, Plus, Key,
  Trash2, Settings, Table, FileText, Search, X, FolderPlus
} from 'lucide-react';
import { useLanguage } from '@/shared/i18n/LanguageContext';
import { useProjectTables } from '@/features/projects/hooks/useProjectTables';
import { DataSourceWizard } from '@/features/data-sources/components/DataSourceWizard';
import { EditTableDisplayModal } from '@/features/tables/components/EditTableDisplayModal';
import { AutomationModal } from '@/features/automations/components/AutomationsPage';
import { CreateApiKeyModal } from '@/features/api-keys/components/CreateApiKeyModal';
import { useAuthStore } from '@/features/auth/store/authStore';
import { useProjectStore } from '@/features/projects/store/projectStore';
import { useDeleteTable } from '@/features/tables/hooks/useDeleteTable';
import { showToast } from '@/shared/hooks/useToast';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  DragOverEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

interface ProjectTablesNavProps {
  projectId: number;
  isExpanded?: boolean;
  isPrivileged?: boolean;
  searchQuery?: string; // Optional search filter
}

interface TableItem {
  id: string;
  name: string;
  displayName?: string;
  sourceName?: string; // Original table name (key)
  sync_target?: string | null;
  data_source_id?: number | null;
  data_source_name?: string | null;
  show_in_nav?: number | null;
}

interface NavFolder {
  id: string;
  name: string;
  items: string[]; // table ids
  isExpanded: boolean;
}

interface NavOrganization {
  folders: NavFolder[];
  rootItems: string[]; // table ids not in folders
  order: string[]; // all ids (folders and root items) in display order
}

// Local storage key for nav organization
const getStorageKey = (projectId: number) => `nav-org-${projectId}`;

// Load organization from localStorage
const loadOrganization = (projectId: number): NavOrganization | null => {
  try {
    const stored = localStorage.getItem(getStorageKey(projectId));
    return stored ? JSON.parse(stored) : null;
  } catch {
    return null;
  }
};

// Save organization to localStorage
const saveOrganization = (projectId: number, org: NavOrganization) => {
  localStorage.setItem(getStorageKey(projectId), JSON.stringify(org));
};

// ============================================================================
// Sortable Table Item Component (simplified - just technical name, no settings)
// ============================================================================
interface SortableTableItemProps {
  table: TableItem;
  isActive: boolean;
  isDragging?: boolean;
  projectId: number;
  isPrivileged?: boolean; // If true, Ctrl+Click copies table ID
}

function SortableTableItem({ table, isActive, isDragging, isPrivileged }: SortableTableItemProps) {
  // Handle Ctrl+Click to copy table ID
  const handleClick = (e: React.MouseEvent) => {
    if (e.ctrlKey && isPrivileged) {
      e.preventDefault();
      e.stopPropagation();
      navigator.clipboard.writeText(table.id);
      showToast(`ID ${table.id} скопирован`, 'success');
    }
  };
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
  } = useSortable({ id: table.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  // Use sourceName (original table name) or name as technical key
  const technicalName = table.sourceName || table.name;

  // Active table (currently open) - still clickable to go to raw view
  if (isActive) {
    return (
      <div
        ref={setNodeRef}
        style={style}
        onClick={handleClick}
        className="group relative flex items-center gap-1 px-1 py-1 rounded text-xs bg-[var(--color-primary-500)]/20 text-[var(--color-primary-600)]"
      >
        <button
          {...attributes}
          {...listeners}
          className="opacity-0 group-hover:opacity-100 cursor-grab active:cursor-grabbing p-0.5 hover:bg-[var(--bg-secondary)] rounded"
        >
          <GripVertical className="w-3 h-3 text-[var(--text-tertiary)]" />
        </button>
        <NavLink
          to={`/tables/${table.id}?mode=raw`}
          className="flex items-center gap-2 flex-1 min-w-0"
          onClick={(e) => e.stopPropagation()}
        >
          <Table className="w-3 h-3 flex-shrink-0 text-slate-400" />
          <span className="truncate font-mono text-[10px]">{technicalName}</span>
          <span className="font-mono text-[10px]">({table.id})</span>
        </NavLink>
      </div>
    );
  }

  // Inactive table
  return (
    <div
      ref={setNodeRef}
      style={style}
      onClick={handleClick}
      className="group relative flex items-center gap-1 px-1 py-1 rounded text-xs transition cursor-grab active:cursor-grabbing text-[var(--text-tertiary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-secondary)]"
    >
      <span
        {...attributes}
        {...listeners}
        className="opacity-0 group-hover:opacity-100 p-0.5"
      >
        <GripVertical className="w-3 h-3 text-[var(--text-tertiary)]" />
      </span>
      <NavLink
        to={`/tables/${table.id}?mode=raw`}
        className="flex items-center gap-2 flex-1 min-w-0"
        onClick={(e) => e.stopPropagation()}
      >
        <Table className="w-3 h-3 flex-shrink-0 text-slate-400" />
        <span className="truncate font-mono text-[10px]">{technicalName}</span>
        <span className="font-mono text-[10px]">({table.id})</span>
      </NavLink>
    </div>
  );
}

// ============================================================================
// Sortable Folder Component
// ============================================================================
interface SortableFolderProps {
  folder: NavFolder;
  tables: Map<string, TableItem>;
  onToggle: () => void;
  onRename: (newName: string) => void;
  onDelete: () => void;
  currentPath: string;
  projectId: number;
  isPrivileged?: boolean;
}

function SortableFolder({ folder, tables, onToggle, currentPath, projectId, isPrivileged }: SortableFolderProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isOver,
  } = useSortable({ id: folder.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const folderTables = folder.items.map(id => tables.get(id)).filter(Boolean) as TableItem[];

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`space-y-0.5 ${isOver ? 'bg-[var(--color-primary-500)]/10 rounded' : ''}`}
    >
      <div className="group flex items-center gap-1">
        <button
          {...attributes}
          {...listeners}
          className="opacity-0 group-hover:opacity-100 cursor-grab active:cursor-grabbing p-0.5 hover:bg-[var(--bg-secondary)] rounded"
        >
          <GripVertical className="w-3 h-3 text-[var(--text-tertiary)]" />
        </button>
        <button
          onClick={onToggle}
          className="flex items-center gap-2 px-1 py-0.5 text-[9px] font-medium text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors flex-1"
        >
          {folder.isExpanded ? (
            <>
              <ChevronDown className="w-2 h-2" />
              <FolderOpen className="w-3 h-3 text-amber-500" />
            </>
          ) : (
            <>
              <ChevronRight className="w-2 h-2" />
              <Folder className="w-3 h-3 text-amber-500" />
            </>
          )}
          <span className="truncate">{folder.name}</span>
          <span className="ml-auto text-[8px] px-1 rounded bg-[var(--bg-tertiary)]">
            {folder.items.length}
          </span>
        </button>
      </div>
      
      {folder.isExpanded && (
        <div className="ml-6 space-y-0.5">
          <SortableContext items={folder.items} strategy={verticalListSortingStrategy}>
            {folderTables.map((table) => (
              <SortableTableItem
                key={table.id}
                table={table}
                isActive={currentPath.includes(`/tables/${table.id}`)}
                projectId={projectId}
                isPrivileged={isPrivileged}
              />
            ))}
          </SortableContext>
          
          {/* Drop zone for dragging items into folder */}
          <div 
            className={`
              flex items-center justify-center gap-1 px-2 py-1.5 rounded border-2 border-dashed 
              text-[10px] text-[var(--text-tertiary)] transition-colors
              ${isOver 
                ? 'border-[var(--color-primary-500)] bg-[var(--color-primary-500)]/10 text-[var(--color-primary-600)]' 
                : 'border-[var(--border-secondary)] hover:border-[var(--border-primary)]'
              }
            `}
          >
            <Plus className="w-3 h-3" />
            <span>Перетащите сюда</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// External DB Group Component
// ============================================================================
// External Table Item Component (simplified - just name, no settings)
// ============================================================================
interface ExternalTableItemProps {
  table: TableItem;
  isActive: boolean;
  projectId: number;
}

function ExternalTableItem({ table, isActive }: ExternalTableItemProps) {
  // Use sourceName (original table name from source) or name as technical key
  const technicalName = table.sourceName || table.name;
  
  return (
    <NavLink
      to={`/tables/${table.id}?mode=raw`}
      className={`flex items-center gap-2 px-2 py-1 rounded text-xs transition ${
        isActive
          ? 'bg-[var(--color-primary-500)]/20 text-[var(--color-primary-600)]'
          : 'text-[var(--text-tertiary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-secondary)]'
      }`}
    >
      <Table className="w-3 h-3 flex-shrink-0 text-slate-400" />
      <span className="truncate font-mono text-[10px]">{technicalName}</span>
      <span className="font-mono text-[10px]">({table.id})</span>
    </NavLink>
  );
}

// ============================================================================
// System Table Item Component (simplified - just name, no settings)
// ============================================================================
interface SystemTableItemProps {
  table: TableItem;
  isActive: boolean;
  projectId: number;
}

function SystemTableItem({ table, isActive }: SystemTableItemProps) {
  // Use sourceName (original table name) or name as technical key
  const technicalName = table.sourceName || table.name;
  
  return (
    <NavLink
      to={`/tables/${table.id}?mode=raw`}
      className={`flex items-center gap-2 px-2 py-1 rounded text-xs transition ${
        isActive
          ? 'bg-[var(--color-primary-500)]/20 text-[var(--color-primary-600)]'
          : 'text-[var(--text-tertiary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-secondary)]'
      }`}
    >
      <Table className="w-3 h-3 flex-shrink-0 text-slate-400" />
      <span className="truncate font-mono text-[10px]">{technicalName}</span>
      <span className="font-mono text-[10px]">({table.id})</span>
    </NavLink>
  );
}

// ============================================================================
// External DB Group Component
// ============================================================================
interface ExternalDbGroupProps {
  dbName: string;
  tables: TableItem[];
  isExpanded: boolean;
  onToggle: () => void;
  currentPath: string;
  projectId: number;
}

function ExternalDbGroup({ dbName, tables, isExpanded, onToggle, currentPath, projectId }: ExternalDbGroupProps) {
  return (
    <div className="space-y-0.5">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-2 px-2 py-0.5 text-[9px] font-medium text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors"
      >
        {isExpanded ? (
          <ChevronDown className="w-2 h-2" />
        ) : (
          <ChevronRight className="w-2 h-2" />
        )}
        <Database className="w-2.5 h-2.5 text-primary-500" />
        <span className="truncate">{dbName}</span>
        <span className="ml-auto text-[8px] w-6 text-right">
          {tables.length}
        </span>
      </button>
      
      {isExpanded && (
        <div className="ml-5 space-y-0.5">
          {tables.map((table) => (
            <ExternalTableItem
              key={table.id}
              table={table}
              isActive={currentPath.includes(`/tables/${table.id}`)}
              projectId={projectId}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================
export function ProjectTablesNav({ projectId, isExpanded = false, isPrivileged = false, searchQuery = '' }: ProjectTablesNavProps) {
  const { t } = useLanguage();
  const [isSectionExpanded, setIsSectionExpanded] = useState(isExpanded);
  const [isDatabasesExpanded, setIsDatabasesExpanded] = useState(false);
  const [isSystemExpanded, setIsSystemExpanded] = useState(false);
  const [isInternalExpanded, setIsInternalExpanded] = useState(false);
  const [isFormsExpanded, setIsFormsExpanded] = useState(false);
  const [isExternalExpanded, setIsExternalExpanded] = useState(false);
  const [expandedDbs, setExpandedDbs] = useState<Set<string>>(new Set());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [organization, setOrganization] = useState<NavOrganization | null>(null);
  const [isDataSourceWizardOpen, setIsDataSourceWizardOpen] = useState(false);
  const [isAutomationModalOpen, setIsAutomationModalOpen] = useState(false);
  const [isApiKeyModalOpen, setIsApiKeyModalOpen] = useState(false);
  const [internalSearch, setInternalSearch] = useState('');
  const [externalSearch, setExternalSearch] = useState('');
  
  // Use searchQuery from props or internal state
  const effectiveInternalSearch = searchQuery || internalSearch;
  const effectiveExternalSearch = searchQuery || externalSearch;
  
  const user = useAuthStore((state) => state.user);
  const projects = useProjectStore((state) => state.projects);
  const currentProject = useMemo(() => projects.find(p => p.id === projectId), [projects, projectId]);
  const spaceId = currentProject?.space_id ?? null;
  const workspaceId = spaceId?.toString() || '1';
  
  const { data: tables = [], isLoading } = useProjectTables(projectId);
  
  // Auto-expand sections when search is active
  useEffect(() => {
    if (searchQuery) {
      setIsSectionExpanded(true);
      setIsDatabasesExpanded(true);
      setIsInternalExpanded(true);
      setIsExternalExpanded(true);
      setIsSystemExpanded(true);
      // Expand all external DBs
      const allDbNames = [...new Set(tables.filter(t => t.data_source_id).map(t => t.data_source_name || 'Unknown'))];
      setExpandedDbs(new Set(allDbNames));
    }
  }, [searchQuery, tables]);
  const location = useLocation();
  const currentPath = location.pathname;

  // Keep Data & Processing collapsed by default

  // Initialize organization from localStorage or create default
  useEffect(() => {
    const stored = loadOrganization(projectId);
    if (stored) {
      setOrganization(stored);
    } else if (tables.length > 0) {
      // Exclude form_ tables from internal organization (they go to Forms section)
      const internalIds = tables
        .filter(t => !t.sync_target && !t.data_source_id && !t.name.startsWith('form_'))
        .map(t => t.id);
      setOrganization({
        folders: [],
        rootItems: internalIds,
        order: internalIds,
      });
    }
  }, [projectId, tables.length]);

  // Create table lookup map
  const tableMap = useMemo(() => {
    const map = new Map<string, TableItem>();
    tables.forEach(t => map.set(t.id, t as TableItem));
    return map;
  }, [tables]);

  // Split tables into 4 categories:
  // 1. System - tables with sync_target (users, projects, etc.)
  // 2. Internal - user tables without sync_target or data_source (excluding forms)
  // 3. Forms - tables starting with "form_"
  // 4. External - tables from external databases (data_source_id)
  const systemTables = useMemo(() => 
    tables.filter(t => t.sync_target && !t.data_source_id) as TableItem[],
    [tables]
  );
  
  const internalTables = useMemo(() => 
    tables.filter(t => !t.sync_target && !t.data_source_id && t.show_in_nav !== 0 && !t.name.startsWith('form_')) as TableItem[],
    [tables]
  );

  const formTables = useMemo(() => 
    tables.filter(t => !t.sync_target && !t.data_source_id && t.name.startsWith('form_')) as TableItem[],
    [tables]
  );
  
  const externalTables = useMemo(() => 
    tables.filter(t => t.data_source_id) as TableItem[],
    [tables]
  );

  // Group external tables by database
  const externalByDb = useMemo(() => {
    const groups = new Map<string, TableItem[]>();
    externalTables.forEach(table => {
      const dbName = table.data_source_name || 'System BD';
      if (!groups.has(dbName)) {
        groups.set(dbName, []);
      }
      groups.get(dbName)!.push(table);
    });
    return groups;
  }, [externalTables]);

  // DnD sensors
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // DnD handlers
  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  }, []);

  const handleDragOver = useCallback((event: DragOverEvent) => {
    // Handle drag over folders for nesting
  }, []);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);

    if (!over || active.id === over.id || !organization) return;

    const activeId = active.id as string;
    const overId = over.id as string;

    // Check if dragging within root items
    const activeIndex = organization.order.indexOf(activeId);
    const overIndex = organization.order.indexOf(overId);

    if (activeIndex !== -1 && overIndex !== -1) {
      const newOrder = arrayMove(organization.order, activeIndex, overIndex);
      const newOrg = { ...organization, order: newOrder };
      setOrganization(newOrg);
      saveOrganization(projectId, newOrg);
    }

    // Check if dragging into a folder
    const targetFolder = organization.folders.find(f => f.id === overId);
    if (targetFolder && !targetFolder.items.includes(activeId)) {
      // Move item into folder
      const newFolders = organization.folders.map(f => {
        if (f.id === overId) {
          return { ...f, items: [...f.items, activeId] };
        }
        // Remove from other folders
        return { ...f, items: f.items.filter(id => id !== activeId) };
      });
      const newRootItems = organization.rootItems.filter(id => id !== activeId);
      const newOrder = organization.order.filter(id => id !== activeId);
      
      const newOrg = { ...organization, folders: newFolders, rootItems: newRootItems, order: newOrder };
      setOrganization(newOrg);
      saveOrganization(projectId, newOrg);
    }
  }, [organization, projectId]);

  // Create new folder
  const handleCreateFolder = useCallback(() => {
    if (!organization) return;
    
    const newFolder: NavFolder = {
      id: `folder-${Date.now()}`,
      name: 'New Folder',
      items: [],
      isExpanded: true,
    };
    
    const newOrg = {
      ...organization,
      folders: [...organization.folders, newFolder],
      order: [...organization.order, newFolder.id],
    };
    setOrganization(newOrg);
    saveOrganization(projectId, newOrg);
  }, [organization, projectId]);

  // Toggle folder expansion
  const toggleFolder = useCallback((folderId: string) => {
    if (!organization) return;
    
    const newFolders = organization.folders.map(f => 
      f.id === folderId ? { ...f, isExpanded: !f.isExpanded } : f
    );
    const newOrg = { ...organization, folders: newFolders };
    setOrganization(newOrg);
    saveOrganization(projectId, newOrg);
  }, [organization, projectId]);

  // Toggle external DB expansion
  const toggleDb = useCallback((dbName: string) => {
    setExpandedDbs(prev => {
      const next = new Set(prev);
      if (next.has(dbName)) {
        next.delete(dbName);
      } else {
        next.add(dbName);
      }
      return next;
    });
  }, []);

  // Get dragged item for overlay
  const draggedTable = activeId ? tableMap.get(activeId) : null;

  return (
    <div className="space-y-1">
      {/* Section Header */}
      <button
        onClick={() => setIsSectionExpanded(!isSectionExpanded)}
        className="w-full flex items-center gap-2 px-2 py-1.5 text-xs font-semibold text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors"
      >
        {isSectionExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        <Database className="w-3.5 h-3.5" />
        <span>Data & Processing</span>
      </button>
      
      {isSectionExpanded && (
        <div className="ml-4 space-y-1">
          {/* Databases */}
          {tables.length > 0 && (
            <div className="space-y-0.5">
              <button
                onClick={() => setIsDatabasesExpanded(!isDatabasesExpanded)}
                className="w-full flex items-center gap-2 px-2 py-1 text-[10px] font-medium text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors uppercase tracking-wider"
              >
                {isDatabasesExpanded ? <ChevronDown className="w-2.5 h-2.5" /> : <ChevronRight className="w-2.5 h-2.5" />}
                <Database className="w-3 h-3" />
                <span>Databases</span>
                <span className="ml-auto text-[9px] w-6 text-right">{tables.length}</span>
              </button>
              
              {isDatabasesExpanded && (
                <div className="ml-2 space-y-1">
                  {/* Internal Tables with DnD - FIRST */}
                  {internalTables.length > 0 && (
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => setIsInternalExpanded(!isInternalExpanded)}
                          className="flex items-center gap-2 px-2 py-0.5 text-[9px] font-medium text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors flex-1"
                        >
                          {isInternalExpanded ? <ChevronDown className="w-2 h-2" /> : <ChevronRight className="w-2 h-2" />}
                          <Database className="w-2.5 h-2.5 text-emerald-500" />
                          <span>Internal</span>
                          <span className="ml-auto text-[8px] w-6 text-right">{internalTables.length}</span>
                        </button>
                      </div>
                      
                      {isInternalExpanded && organization && (
                        <>
                          {/* Toolbar with search and add folder */}
                          <div className="ml-5 flex items-center gap-1 mb-1">
                            <div className="flex-1 relative">
                              <Search className="w-3 h-3 absolute left-1.5 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]" />
                              <input
                                type="text"
                                value={internalSearch}
                                onChange={(e) => setInternalSearch(e.target.value)}
                                placeholder={t('common.searchPlaceholder')}
                                className="w-full pl-5 pr-5 py-0.5 text-[10px] bg-[var(--bg-tertiary)] border border-[var(--border-secondary)] rounded focus:outline-none focus:border-[var(--color-primary-500)] text-[var(--text-primary)]"
                              />
                              {internalSearch && (
                                <button
                                  onClick={() => setInternalSearch('')}
                                  className="absolute right-1 top-1/2 -translate-y-1/2 p-0.5 hover:bg-[var(--bg-secondary)] rounded"
                                >
                                  <X className="w-2.5 h-2.5 text-[var(--text-tertiary)]" />
                                </button>
                              )}
                            </div>
                            <button
                              onClick={handleCreateFolder}
                              className="p-1 hover:bg-[var(--bg-tertiary)] rounded"
                              title={t('common.createFolder')}
                            >
                              <FolderPlus className="w-3 h-3 text-[var(--text-tertiary)]" />
                            </button>
                          </div>
                          
                          <DndContext
                            sensors={sensors}
                            collisionDetection={closestCenter}
                            onDragStart={handleDragStart}
                            onDragOver={handleDragOver}
                            onDragEnd={handleDragEnd}
                          >
                            <div className="ml-5 space-y-0.5">
                              <SortableContext items={organization.order} strategy={verticalListSortingStrategy}>
                                {organization.order.map((itemId) => {
                                  // Check if it's a folder
                                  const folder = organization.folders.find(f => f.id === itemId);
                                  if (folder) {
                                    return (
                                      <SortableFolder
                                        key={folder.id}
                                        folder={folder}
                                        tables={tableMap}
                                        onToggle={() => toggleFolder(folder.id)}
                                        onRename={() => {}}
                                        onDelete={() => {}}
                                        currentPath={currentPath}
                                        projectId={projectId}
                                        isPrivileged={isPrivileged}
                                      />
                                    );
                                  }
                                  
                                  // It's a table
                                  const table = tableMap.get(itemId);
                                  // Skip form_ tables - they belong to Forms section
                                  if (table && !table.sync_target && !table.data_source_id && !table.name.startsWith('form_')) {
                                    // Filter by search (use effective search which combines prop and internal state)
                                    const searchLower = effectiveInternalSearch.toLowerCase();
                                    const tableName = (table.sourceName || table.name).toLowerCase();
                                    if (effectiveInternalSearch && !tableName.includes(searchLower) && !table.id.includes(searchLower)) {
                                      return null;
                                    }
                                    return (
                                      <SortableTableItem
                                        key={table.id}
                                        table={table}
                                        isActive={currentPath.includes(`/tables/${table.id}`)}
                                        isDragging={activeId === table.id}
                                        projectId={projectId}
                                        isPrivileged={isPrivileged}
                                      />
                                    );
                                  }
                                  return null;
                                })}
                              </SortableContext>
                            </div>
                            
                            <DragOverlay dropAnimation={null}>
                              {draggedTable && (
                                <div 
                                  className="flex items-center gap-2 px-2 py-1 rounded text-xs bg-[var(--bg-primary)] shadow-lg border border-[var(--border-primary)]"
                                  style={{
                                    cursor: 'grabbing',
                                    width: 'fit-content',
                                    maxWidth: '200px'
                                  }}
                                >
                                  <Table className="w-3 h-3" />
                                  <span className="truncate">{draggedTable.sourceName || draggedTable.name}</span>
                                </div>
                              )}
                            </DragOverlay>
                          </DndContext>
                        </>
                      )}
                    </div>
                  )}

                  {/* System Tables - SECOND */}
                  {systemTables.length > 0 && (
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => setIsSystemExpanded(!isSystemExpanded)}
                          className="flex items-center gap-2 px-2 py-0.5 text-[9px] font-medium text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors flex-1"
                        >
                          {isSystemExpanded ? <ChevronDown className="w-2 h-2" /> : <ChevronRight className="w-2 h-2" />}
                          <HardDrive className="w-2.5 h-2.5 text-slate-500" />
                          <span>System</span>
                          <span className="ml-auto text-[8px] w-6 text-right">{systemTables.length}</span>
                        </button>
                      </div>
                      
                      {isSystemExpanded && (
                        <div className="ml-5 space-y-0.5">
                          {systemTables.map((table) => (
                            <SystemTableItem
                              key={table.id}
                              table={table}
                              isActive={currentPath.includes(`/tables/${table.id}`)}
                              projectId={projectId}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Forms Tables - THIRD */}
                  {formTables.length > 0 && (
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => setIsFormsExpanded(!isFormsExpanded)}
                          className="flex items-center gap-2 px-2 py-0.5 text-[9px] font-medium text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors flex-1"
                        >
                          {isFormsExpanded ? <ChevronDown className="w-2 h-2" /> : <ChevronRight className="w-2 h-2" />}
                          <FileText className="w-2.5 h-2.5 text-violet-500" />
                          <span>Forms</span>
                          <span className="ml-auto text-[8px] w-6 text-right">{formTables.length}</span>
                        </button>
                      </div>
                      
                      {isFormsExpanded && (
                        <div className="ml-5 space-y-0.5">
                          {formTables.map((table) => (
                            <NavLink
                              key={table.id}
                              to={`/tables/${table.id}?mode=raw`}
                              className={({ isActive }) =>
                                `flex items-center gap-2 px-2 py-1 rounded text-xs transition ${isActive ? 'bg-[var(--color-primary-500)]/20 text-[var(--color-primary-600)]' : 'text-[var(--text-tertiary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-secondary)]'}`
                              }
                            >
                              <Table className="w-3 h-3 flex-shrink-0 text-slate-400" />
                              <span className="truncate font-mono text-[10px]">{table.name}</span>
                              <span className="font-mono text-[10px]">({table.id})</span>
                            </NavLink>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                  
                  {/* External Tables grouped by DB */}
                  {externalTables.length > 0 && (
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => setIsExternalExpanded(!isExternalExpanded)}
                          className="flex items-center gap-2 px-2 py-0.5 text-[9px] font-medium text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors flex-1"
                        >
                          {isExternalExpanded ? <ChevronDown className="w-2 h-2" /> : <ChevronRight className="w-2 h-2" />}
                          <Cloud className="w-2.5 h-2.5" />
                          <span>External</span>
                          <span className="ml-auto text-[8px] w-6 text-right">{externalTables.length}</span>
                        </button>
                      </div>
                      
                      {isExternalExpanded && (
                        <div className="ml-5 space-y-0.5">
                          {/* Search toolbar */}
                          <div className="flex items-center gap-1 mb-1">
                            <div className="flex-1 relative">
                              <Search className="w-3 h-3 absolute left-1.5 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]" />
                              <input
                                type="text"
                                value={externalSearch}
                                onChange={(e) => setExternalSearch(e.target.value)}
                                placeholder={t('common.searchPlaceholder')}
                                className="w-full pl-5 pr-5 py-0.5 text-[10px] bg-[var(--bg-tertiary)] border border-[var(--border-secondary)] rounded focus:outline-none focus:border-[var(--color-primary-500)] text-[var(--text-primary)]"
                              />
                              {externalSearch && (
                                <button
                                  onClick={() => setExternalSearch('')}
                                  className="absolute right-1 top-1/2 -translate-y-1/2 p-0.5 hover:bg-[var(--bg-secondary)] rounded"
                                >
                                  <X className="w-2.5 h-2.5 text-[var(--text-tertiary)]" />
                                </button>
                              )}
                            </div>
                          </div>
                          {Array.from(externalByDb.entries()).map(([dbName, dbTables]) => {
                            // Filter tables by search
                            const filteredTables = externalSearch
                              ? dbTables.filter(t => {
                                  const searchLower = externalSearch.toLowerCase();
                                  const tableName = (t.sourceName || t.name).toLowerCase();
                                  return tableName.includes(searchLower) || t.id.includes(searchLower);
                                })
                              : dbTables;
                            
                            if (filteredTables.length === 0) return null;
                            
                            return (
                              <ExternalDbGroup
                                key={dbName}
                                dbName={dbName}
                                tables={filteredTables}
                                isExpanded={expandedDbs.has(dbName)}
                                onToggle={() => toggleDb(dbName)}
                                currentPath={currentPath}
                                projectId={projectId}
                              />
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                  
                  {isLoading && (
                    <div className="flex items-center gap-2 px-2 py-1 text-xs text-[var(--text-tertiary)]">
                      <Loader2 className="w-3 h-3 animate-spin" />
                      Loading...
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
          
          {/* Automations */}
          <NavLink
            to={`/projects/${projectId}/automations`}
            className={({ isActive }) =>
              `flex items-center gap-2 px-2 py-1 rounded text-xs transition ${
                isActive
                  ? 'bg-[var(--color-primary-500)]/20 text-[var(--color-primary-600)]'
                  : 'text-[var(--text-tertiary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-secondary)]'
              }`
            }
          >
            <Zap className="w-3 h-3 flex-shrink-0" />
            <span>Automations</span>
          </NavLink>
          
          {/* Webhooks */}
          <NavLink
            to={`/projects/${projectId}/webhooks`}
            className={({ isActive }) =>
              `flex items-center gap-2 px-2 py-1 rounded text-xs transition ${
                isActive
                  ? 'bg-[var(--color-primary-500)]/20 text-[var(--color-primary-600)]'
                  : 'text-[var(--text-tertiary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-secondary)]'
              }`
            }
          >
            <Webhook className="w-3 h-3 flex-shrink-0" />
            <span>Webhooks</span>
          </NavLink>
          
          {/* API Keys */}
          <NavLink
            to={`/projects/${projectId}/api-keys`}
            className={({ isActive }) =>
              `flex items-center gap-2 px-2 py-1 rounded text-xs transition ${
                isActive
                  ? 'bg-[var(--color-primary-500)]/20 text-[var(--color-primary-600)]'
                  : 'text-[var(--text-tertiary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-secondary)]'
              }`
            }
          >
            <Key className="w-3 h-3 flex-shrink-0" />
            <span>API Keys</span>
          </NavLink>
          
          {/* Files */}
          <NavLink
            to={`/projects/${projectId}/files`}
            className={({ isActive }) =>
              `flex items-center gap-2 px-2 py-1 rounded text-xs transition ${
                isActive
                  ? 'bg-[var(--color-primary-500)]/20 text-[var(--color-primary-600)]'
                  : 'text-[var(--text-tertiary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-secondary)]'
              }`
            }
          >
            <Folder className="w-3 h-3 flex-shrink-0" />
            <span>Files</span>
          </NavLink>
          
          {/* Compact action buttons */}
          <div className="flex items-center gap-1 px-2 py-1 mt-1">
            <button
              onClick={() => setIsAutomationModalOpen(true)}
              className="flex items-center gap-0.5 p-1 text-[var(--text-tertiary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-secondary)] transition rounded"
              title="New automation"
            >
              <Plus className="w-2.5 h-2.5" />
              <Zap className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setIsApiKeyModalOpen(true)}
              className="flex items-center gap-0.5 p-1 text-[var(--text-tertiary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-secondary)] transition rounded"
              title="Create API Key"
            >
              <Plus className="w-2.5 h-2.5" />
              <Key className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setIsDataSourceWizardOpen(true)}
              className="flex items-center gap-0.5 p-1 text-[var(--text-tertiary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-secondary)] transition rounded"
              title="Connect database"
            >
              <Plus className="w-2.5 h-2.5" />
              <Database className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Data Source Wizard */}
      {isDataSourceWizardOpen && (
        <DataSourceWizard
          workspaceId={String(projectId)}
          defaultSpaceId={spaceId ?? null}
          defaultProjectId={projectId}
          onClose={() => setIsDataSourceWizardOpen(false)}
          onSuccess={() => setIsDataSourceWizardOpen(false)}
        />
      )}
      
      {/* Automation Modal */}
      {isAutomationModalOpen && (
        <AutomationModal
          projectId={projectId}
          spaceId={spaceId}
          onClose={() => setIsAutomationModalOpen(false)}
          onSave={() => {
            setIsAutomationModalOpen(false);
            // Optionally refetch or update data
          }}
          language="ru"
        />
      )}
      
      {/* API Key Modal */}
      <CreateApiKeyModal
        open={isApiKeyModalOpen}
        onClose={() => setIsApiKeyModalOpen(false)}
        projectId={projectId}
      />
    </div>
  );
}
