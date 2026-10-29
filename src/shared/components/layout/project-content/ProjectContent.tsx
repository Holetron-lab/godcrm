import { useState, useCallback, useMemo, useEffect } from 'react';
import { NavLink } from 'react-router-dom';
import { useProjectWidgets } from '@/features/projects/hooks/useProjectWidgets';
import { LayoutGrid, Folder, Plus, Table } from 'lucide-react';
import { useLanguage } from '@/shared/i18n/LanguageContext';
import { useProjectStore } from '@/features/projects/store/projectStore';
import { CreateTableModal } from '@/features/tables/components/CreateTableModal';
import { DataSourceWizard } from '@/features/data-sources/components/DataSourceWizard';
import {
  DndContext,
  closestCenter,
  pointerWithin,
  KeyboardSensor,
  PointerSensor,
  MouseSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  DragStartEvent,
  CollisionDetection,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';

import type { ProjectContentProps, WidgetItem, WidgetFolder, WidgetOrganization } from './types';
import { widgetTypeConfig } from './types';
import { loadOrganization, saveOrganization } from './utils';
import { SortableWidgetItem } from './SortableWidgetItem';
import { SortableFolder } from './SortableFolder';
import { InlineCreateFolder } from './FolderForms';

export function ProjectContent({
  projectId,
  isPrivileged: callerPrivileged = true,
  searchQuery = '',
  mode = 'private',
  publicSlug,
  widgetsOverride,
}: ProjectContentProps) {
  const isPublic = mode === 'public';
  // Public mode is read-only — forcibly strip privileged affordances even if
  // a caller (e.g. a logged-in admin browsing /s/:slug) passed isPrivileged.
  const isPrivileged = isPublic ? false : callerPrivileged;

  // Skip the auth'd widgets fetch when public-tree data was already injected.
  const { data: fetchedWidgets = [], isLoading } = useProjectWidgets(projectId, {
    enabled: !widgetsOverride,
  });
  const widgets: WidgetItem[] = widgetsOverride
    ? widgetsOverride
    : (fetchedWidgets as unknown as WidgetItem[]);
  const { t } = useLanguage();
  const [activeId, setActiveId] = useState<number | string | null>(null);
  const [organization, setOrganization] = useState<WidgetOrganization | null>(null);
  const [isCreateFolderOpen, setIsCreateFolderOpen] = useState(false);
  const [editingFolder, setEditingFolder] = useState<WidgetFolder | null>(null);
  const [isCreateTableModalOpen, setIsCreateTableModalOpen] = useState(false);
  const [isDataSourceWizardOpen, setIsDataSourceWizardOpen] = useState(false);

  // Create-table affordance (moved here from "Data & Processing" — sits beside
  // the "new module" action). Projects come from the same global store the
  // tables nav uses, so no extra fetch.
  const projects = useProjectStore((state) => state.projects);
  const spaceId = useMemo(
    () => projects.find((p) => p.id === projectId)?.space_id ?? null,
    [projects, projectId],
  );

  // Filter widgets by search query
  const searchLower = searchQuery.toLowerCase().trim();
  const filteredWidgetIds = useMemo(() => {
    if (!searchLower) return null; // null = no filtering
    return new Set(widgets.filter(w =>
      w.title.toLowerCase().includes(searchLower) ||
      (w.preset_name && w.preset_name.toLowerCase().includes(searchLower))
    ).map(w => w.id));
  }, [widgets, searchLower]);

  // Initialize organization from localStorage or create default
  useEffect(() => {
    const stored = loadOrganization(projectId);
    if (stored) {
      // Sync with actual widgets - remove deleted, add new
      const widgetIds = new Set(widgets.map(w => w.id));
      const storedIds = new Set([
        ...stored.rootItems,
        ...stored.folders.flatMap(f => f.items)
      ]);

      // Find new widgets not in storage
      const newWidgets = widgets.filter(w => !storedIds.has(w.id)).map(w => w.id);

      // Filter out deleted widgets
      const newFolders = stored.folders.map(f => ({
        ...f,
        items: f.items.filter(id => widgetIds.has(id))
      }));
      const newRootItems = stored.rootItems.filter(id => widgetIds.has(id));
      const newOrder = stored.order.filter(id => {
        if (typeof id === 'string') return newFolders.some(f => f.id === id);
        return widgetIds.has(id as number);
      });

      // Add new widgets to root
      setOrganization({
        folders: newFolders,
        rootItems: [...newRootItems, ...newWidgets],
        order: [...newOrder, ...newWidgets],
      });
    } else if (widgets.length > 0) {
      const widgetIds = widgets.map(w => w.id);
      setOrganization({
        folders: [],
        rootItems: widgetIds,
        order: widgetIds,
      });
    }
  }, [projectId, widgets]);

  // Create widget lookup map
  const widgetMap = useMemo(() => {
    const map = new Map<number, WidgetItem>();
    widgets.forEach(w => map.set(w.id, w as WidgetItem));
    return map;
  }, [widgets]);

  // Custom collision detection - prioritize folder drop lines
  const collisionDetection: CollisionDetection = useCallback((args) => {
    // First check pointerWithin for folder drop lines
    const pointerCollisions = pointerWithin(args);
    const folderDropCollision = pointerCollisions.find(c =>
      typeof c.id === 'string' && c.id.startsWith('folder-drop-')
    );

    // If pointer is within a folder drop line, prioritize it
    if (folderDropCollision) {
      return [folderDropCollision];
    }

    // Otherwise use closest center for normal sorting
    return closestCenter(args);
  }, []);

  // DnD sensors - use delay to distinguish click from drag
  const sensors = useSensors(
    useSensor(MouseSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(PointerSensor, {
      activationConstraint: {
        delay: 150,
        tolerance: 5,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // DnD handlers
  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(event.active.id as number | string);
  }, []);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);

    if (!over || !organization) return;

    // Skip if same id
    if (active.id === over.id) return;

    const activeIdVal = active.id as number | string;
    const originalOverId = over.id as number | string;

    // Check if dropped on folder drop line (folder-drop-{folderId})
    const isFolderDropLine = typeof originalOverId === 'string' && originalOverId.startsWith('folder-drop-');
    const folderIdFromDropLine = isFolderDropLine && typeof originalOverId === 'string'
      ? originalOverId.replace('folder-drop-', '')
      : null;

    // Find where the active item is (root or in a folder)
    const isActiveInRoot = organization.order.includes(activeIdVal);
    const activeFolderIndex = organization.folders.findIndex(f =>
      typeof activeIdVal === 'number' && f.items.includes(activeIdVal)
    );
    const isActiveInFolder = activeFolderIndex !== -1;

    // Find where we're dropping
    const overIdVal = originalOverId;
    const isOverFolder = typeof overIdVal === 'string' && organization.folders.some(f => f.id === overIdVal);
    const isOverInRoot = organization.order.includes(overIdVal);
    const overFolderIndex = organization.folders.findIndex(f =>
      typeof overIdVal === 'number' && f.items.includes(overIdVal)
    );
    const isOverInFolder = overFolderIndex !== -1;

    const newOrg = { ...organization };

    // CASE 0: Dropped on folder drop line - add widget to folder
    if (isFolderDropLine && folderIdFromDropLine && typeof activeIdVal === 'number') {
      const targetFolder = organization.folders.find(f => f.id === folderIdFromDropLine);
      if (targetFolder && !targetFolder.items.includes(activeIdVal)) {
        // Remove from current location
        if (isActiveInRoot) {
          newOrg.order = organization.order.filter(id => id !== activeIdVal);
          newOrg.rootItems = organization.rootItems.filter(id => id !== activeIdVal);
        }
        // Update folders - add to target, remove from others
        newOrg.folders = organization.folders.map(f => {
          if (f.id === folderIdFromDropLine) {
            return { ...f, items: [...f.items, activeIdVal] };
          }
          return { ...f, items: f.items.filter(id => id !== activeIdVal) };
        });
      }
    }
    // Case 1: Dragging from root to root (reorder)
    else if (isActiveInRoot && isOverInRoot) {
      const activeIndex = organization.order.indexOf(activeIdVal);
      const overIndex = organization.order.indexOf(overIdVal);
      newOrg.order = arrayMove(organization.order, activeIndex, overIndex);
    }
    // Case 2: Dragging from folder to root
    else if (isActiveInFolder && (isOverInRoot || (!isOverFolder && !isOverInFolder))) {
      // Remove from folder
      newOrg.folders = organization.folders.map((f, i) =>
        i === activeFolderIndex
          ? { ...f, items: f.items.filter(id => id !== activeIdVal) }
          : f
      );
      // Add to root
      if (isOverInRoot) {
        const overIndex = organization.order.indexOf(overIdVal);
        newOrg.order = [...organization.order];
        newOrg.order.splice(overIndex, 0, activeIdVal);
      } else {
        newOrg.order = [...organization.order, activeIdVal];
      }
      newOrg.rootItems = [...organization.rootItems, activeIdVal as number];
    }
    // Case 3: Dragging from root/folder into a folder (dropping on folder itself)
    else if (isOverFolder && typeof activeIdVal === 'number') {
      const targetFolder = organization.folders.find(f => f.id === overIdVal);
      if (targetFolder && !targetFolder.items.includes(activeIdVal)) {
        // Remove from current location
        if (isActiveInRoot) {
          newOrg.order = organization.order.filter(id => id !== activeIdVal);
          newOrg.rootItems = organization.rootItems.filter(id => id !== activeIdVal);
        }
        // Update folders
        newOrg.folders = organization.folders.map(f => {
          if (f.id === overIdVal) {
            return { ...f, items: [...f.items, activeIdVal] };
          }
          // Remove from other folders
          return { ...f, items: f.items.filter(id => id !== activeIdVal) };
        });
      }
    }
    // Case 4: Reorder within the same folder
    else if (isActiveInFolder && isOverInFolder && activeFolderIndex === overFolderIndex) {
      const folder = organization.folders[activeFolderIndex];
      const activeIndex = folder.items.indexOf(activeIdVal as number);
      const overIndex = folder.items.indexOf(overIdVal as number);
      const newItems = arrayMove(folder.items, activeIndex, overIndex);
      newOrg.folders = organization.folders.map((f, i) =>
        i === activeFolderIndex ? { ...f, items: newItems } : f
      );
    }
    // Case 5: Moving between folders
    else if (isActiveInFolder && isOverInFolder && activeFolderIndex !== overFolderIndex) {
      newOrg.folders = organization.folders.map((f, i) => {
        if (i === activeFolderIndex) {
          return { ...f, items: f.items.filter(id => id !== activeIdVal) };
        }
        if (i === overFolderIndex) {
          const overIndex = f.items.indexOf(overIdVal as number);
          const newItems = [...f.items];
          newItems.splice(overIndex, 0, activeIdVal as number);
          return { ...f, items: newItems };
        }
        return f;
      });
    }

    setOrganization(newOrg);
    saveOrganization(projectId, newOrg);
  }, [organization, projectId]);

  // Create new folder with name and icon
  const handleCreateFolder = useCallback((name: string, icon?: string) => {
    if (!organization) return;

    const newFolder: WidgetFolder = {
      id: `folder-${Date.now()}`,
      name,
      icon,
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

  // Edit folder (update name and icon)
  const handleEditFolder = useCallback((folderId: string, name: string, icon?: string) => {
    if (!organization) return;

    const newFolders = organization.folders.map(f =>
      f.id === folderId ? { ...f, name, icon } : f
    );
    const newOrg = { ...organization, folders: newFolders };
    setOrganization(newOrg);
    saveOrganization(projectId, newOrg);
  }, [organization, projectId]);

  // Delete folder (move items to root)
  const handleDeleteFolder = useCallback((folderId: string) => {
    if (!organization) return;

    const folder = organization.folders.find(f => f.id === folderId);
    if (!folder) return;

    // Move folder items to root
    const folderIndex = organization.order.indexOf(folderId);
    const newOrder = [...organization.order];
    newOrder.splice(folderIndex, 1, ...folder.items); // Replace folder with its items

    const newOrg = {
      ...organization,
      folders: organization.folders.filter(f => f.id !== folderId),
      rootItems: [...organization.rootItems, ...folder.items],
      order: newOrder,
    };
    setOrganization(newOrg);
    saveOrganization(projectId, newOrg);
  }, [organization, projectId]);

  // Get current path for active state
  const currentPath = typeof window !== 'undefined' ? window.location.pathname : '';

  if (isLoading) {
    return (
      <div className="px-3 py-2 text-xs text-[var(--text-tertiary)]">
        Loading...
      </div>
    );
  }

  // ADR-0060-A A1 — Public mode renders a flat read-only list:
  // no DnD, no folders, no settings cog, no `+ folder` / `+ widget`.
  // URLs are slug-prefixed (`/s/:slug/widgets/:id`).
  if (isPublic) {
    if (widgets.length === 0) {
      return (
        <p className="px-3 py-1 text-[10px] italic text-[var(--text-tertiary)]">
          Пусто
        </p>
      );
    }
    return (
      <div className="space-y-0.5">
        {widgets.map((widget) => {
          if (filteredWidgetIds && !filteredWidgetIds.has(widget.id)) return null;
          const cfg = widgetTypeConfig[widget.preset_name || ''] || { emoji: '📊', labelKey: '' };
          const emoji = widget.icon || cfg.emoji;
          const href = `/s/${publicSlug ?? ''}/widgets/${widget.id}`;
          const isActive = currentPath.includes(`/widgets/${widget.id}`);
          return (
            <NavLink
              key={widget.id}
              to={href}
              title={widget.description || ''}
              className={`flex items-center gap-2 px-1 py-1 rounded text-xs transition ${
                isActive
                  ? 'bg-[var(--color-primary-500)]/20 text-[var(--color-primary-600)]'
                  : 'text-[var(--text-tertiary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-secondary)]'
              }`}
            >
              <span>{emoji}</span>
              <span className="truncate flex-1">{widget.title}</span>
            </NavLink>
          );
        })}
      </div>
    );
  }

  return (
    <div className="space-y-0.5">
      {organization && widgets.length > 0 && (
        <DndContext
          sensors={sensors}
          collisionDetection={collisionDetection}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <div className="space-y-0.5">
            <SortableContext items={organization.order} strategy={verticalListSortingStrategy}>
              {organization.order.map((itemId) => {
                // Check if it's a folder
                if (typeof itemId === 'string') {
                  const folder = organization.folders.find(f => f.id === itemId);
                  if (folder) {
                    return (
                      <SortableFolder
                        key={folder.id}
                        folder={folder}
                        widgets={widgetMap}
                        onToggle={() => toggleFolder(folder.id)}
                        onEdit={() => setEditingFolder(editingFolder?.id === folder.id ? null : folder)}
                        onSave={handleEditFolder}
                        onDelete={handleDeleteFolder}
                        isEditing={editingFolder?.id === folder.id}
                        currentPath={currentPath}
                        isDragging={activeId !== null && typeof activeId === 'number'}
                      />
                    );
                  }
                  return null;
                }

                // It's a widget
                const widget = widgetMap.get(itemId);
                if (widget) {
                  // Filter by search query if active
                  if (filteredWidgetIds && !filteredWidgetIds.has(widget.id)) {
                    return null;
                  }
                  return (
                    <SortableWidgetItem
                      key={widget.id}
                      widget={widget}
                      isActive={currentPath.includes(`/widgets/${widget.id}`) || currentPath.includes(`/tables/${widget.config?.tableId || widget.config?.table_id}`)}
                      isDragging={activeId === widget.id}
                    />
                  );
                }
                return null;
              })}
            </SortableContext>
          </div>
        </DndContext>
      )}

      {/* Compact action buttons - only for privileged users */}
      {isPrivileged && (
        <div className="flex items-center gap-1 px-2 py-1">
          <button
            onClick={() => setIsCreateFolderOpen(!isCreateFolderOpen)}
            className={`flex items-center gap-0.5 p-1 text-[var(--text-tertiary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-secondary)] transition rounded ${isCreateFolderOpen ? 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)]' : ''}`}
            title="New folder"
          >
            <Plus className="w-2.5 h-2.5" />
            <Folder className="w-3.5 h-3.5" />
          </button>
          <NavLink
            to={`/projects/${projectId}/widgets/create`}
            className="flex items-center gap-0.5 p-1 text-[var(--text-tertiary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-secondary)] transition rounded"
            title={t('widgets.newWidget')}
          >
            <Plus className="w-2.5 h-2.5" />
            <LayoutGrid className="w-3.5 h-3.5" />
          </NavLink>
          <button
            onClick={() => setIsCreateTableModalOpen(true)}
            className="flex items-center gap-0.5 p-1 text-[var(--text-tertiary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-secondary)] transition rounded"
            title="Create table"
          >
            <Plus className="w-2.5 h-2.5" />
            <Table className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Create Table Modal — relocated from the Data & Processing nav. */}
      {isPrivileged && (
        <CreateTableModal
          open={isCreateTableModalOpen}
          onOpenChange={setIsCreateTableModalOpen}
          projectId={projectId}
          projects={projects}
          onOpenDataSourceWizard={() => setIsDataSourceWizardOpen(true)}
        />
      )}

      {/* Data Source Wizard — opened from within the create-table modal. */}
      {isPrivileged && isDataSourceWizardOpen && (
        <DataSourceWizard
          workspaceId={String(projectId)}
          defaultSpaceId={spaceId}
          defaultProjectId={projectId}
          onClose={() => setIsDataSourceWizardOpen(false)}
          onSuccess={() => setIsDataSourceWizardOpen(false)}
        />
      )}

      {/* Inline create folder form */}
      {isPrivileged && (
        <InlineCreateFolder
          isOpen={isCreateFolderOpen}
          onClose={() => setIsCreateFolderOpen(false)}
          onCreate={handleCreateFolder}
        />
      )}
    </div>
  );
}
