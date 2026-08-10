/**
 * NavTreePanel - Navigation tree for Schema Editor
 * Shows projects, folders, and tables with 4-state visibility controls
 * Resizable width, external tables section, and improved legend
 */

import { useCallback, useState } from 'react';
import { useSchemaEditorStore } from '../../store/schemaEditorStore';
import type { NavTreeNode } from '../../types/schema-editor.types';
import { GripVertical, X, FolderPlus, Plus } from 'lucide-react';
import { Button } from '@/shared/components/ui/Button';
import { useLanguage } from '@/shared/i18n/LanguageContext';
import { useSpacesQuery } from '@/features/spaces/hooks/useSpacesQuery';
import { SpaceManagerModal } from '@/features/space-manager';
import { CreateProjectModal } from '@/features/projects/components/CreateProjectModal';
import { NavTreeItem } from './NavTreeItem';
import { NavTreeToolbar } from './NavTreeToolbar';
import { CreateFolderModal } from './CreateFolderModal';
import { useNavTreeData } from './useNavTreeData';
import { useProjectSelection } from './useProjectSelection';
import { usePanelResize } from './usePanelResize';
import type { NavTreePanelProps } from './navTreeTypes';

export const NavTreePanel = ({ className = '', onClose }: NavTreePanelProps) => {
  const { t } = useLanguage();
  const {
    expandedProjects,
    showAllTables,
    hideAllTables,
    spaceId,
    refreshNavTree,
  } = useSchemaEditorStore();

  // Get space info
  const { data: spaces = [] } = useSpacesQuery();
  const currentSpace = spaces.find(s => s.id === spaceId);
  const spaceName = currentSpace?.name || 'Space';
  const spaceIcon = currentSpace?.icon || '📁';

  // Modals and UI state
  const [isSpaceManagerOpen, setIsSpaceManagerOpen] = useState(false);
  const [isCreateProjectOpen, setIsCreateProjectOpen] = useState(false);
  const [createFolderOpen, setCreateFolderOpen] = useState(false);
  const [allVisible, setAllVisible] = useState(true);
  const [sortMode, setSortMode] = useState(false);

  // Composed hooks
  const { navTree, externalTables, footerStats, projects } = useNavTreeData();
  const {
    selectedTables,
    selectedProjects,
    handleToggleSelect,
    handleToggleProjectSelect,
  } = useProjectSelection();
  const { panelRef, panelWidth, isResizing, handleMouseDown } = usePanelResize();

  const handleExpandAll = useCallback(() => {
    navTree.forEach((project) => {
      if (!expandedProjects.has(project.numericId)) {
        useSchemaEditorStore.getState().toggleProjectExpanded(project.numericId);
      }
    });
  }, [navTree, expandedProjects]);

  const handleCollapseAll = useCallback(() => {
    navTree.forEach((project) => {
      if (expandedProjects.has(project.numericId)) {
        useSchemaEditorStore.getState().toggleProjectExpanded(project.numericId);
      }
    });
  }, [navTree, expandedProjects]);

  const handleToggleAllVisibility = useCallback(() => {
    if (allVisible) {
      hideAllTables();
      setAllVisible(false);
    } else {
      showAllTables();
      setAllVisible(true);
    }
  }, [allVisible, hideAllTables, showAllTables]);

  const externalSectionNode: NavTreeNode = {
    id: 'external-section',
    type: 'external-section',
    numericId: -1,
    name: t('schemaEditor.externalTables'),
    displayName: t('schemaEditor.externalTables'),
    icon: '',
    children: externalTables,
    parentId: null,
    tableCount: externalTables.length,
  };

  return (
    <div
      ref={panelRef}
      style={{ width: panelWidth }}
      className={`absolute left-0 top-0 z-20 flex flex-col h-full bg-[var(--bg-primary)] border-r border-[var(--border-secondary)] shadow-xl ${className} ${isResizing ? 'select-none' : ''}`}
    >
      {/* Header - Space name + Create buttons + Close */}
      <div className="flex items-center gap-1 px-3 py-2 border-b border-[var(--border-secondary)]">
        <button
          onClick={() => setIsSpaceManagerOpen(true)}
          className="flex-1 min-w-0 flex items-center gap-1.5 text-sm font-medium text-[var(--text-primary)] hover:text-[var(--accent-primary)] transition-colors cursor-pointer"
          title="Open Space Manager"
        >
          <span className="flex-shrink-0">{spaceIcon}</span>
          <span className="truncate">{spaceName}</span>
          <span className="flex-shrink-0 text-xs text-[var(--text-tertiary)] font-mono">#{spaceId}</span>
        </button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setCreateFolderOpen(true)}
          className="p-1 h-auto flex-shrink-0"
          title="Create folder"
        >
          <FolderPlus className="w-3.5 h-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setIsCreateProjectOpen(true)}
          className="p-1 h-auto flex-shrink-0"
          title="Create project"
        >
          <Plus className="w-3.5 h-3.5" />
        </Button>
        {onClose && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="p-1 h-auto flex-shrink-0 hover:bg-red-500/20 hover:text-red-500"
            title={t('common.close')}
          >
            <X className="w-4 h-4" />
          </Button>
        )}
      </div>

      {/* Toolbar - Visibility toggle + Sort + Expand/Collapse + Help */}
      <NavTreeToolbar
        allVisible={allVisible}
        sortMode={sortMode}
        onToggleVisibility={handleToggleAllVisibility}
        onToggleSortMode={() => setSortMode(!sortMode)}
        onExpandAll={handleExpandAll}
        onCollapseAll={handleCollapseAll}
        t={t}
      />

      {/* Tree */}
      <div className="flex-1 overflow-auto py-2">
        {navTree.length === 0 && externalTables.length === 0 ? (
          <div className="flex items-center justify-center h-full text-[var(--text-tertiary)] text-sm">
            {t('schemaEditor.noTables')}
          </div>
        ) : (
          <>
            {navTree.map((node) => (
              <NavTreeItem
                key={node.id}
                node={node}
                depth={0}
                t={t}
                selectedTables={selectedTables}
                selectedProjects={selectedProjects}
                onToggleSelect={handleToggleSelect}
                onToggleProjectSelect={handleToggleProjectSelect}
                sortMode={sortMode}
              />
            ))}

            {/* External Tables Section */}
            {externalTables.length > 0 && (
              <NavTreeItem
                node={externalSectionNode}
                depth={0}
                t={t}
                selectedTables={selectedTables}
                selectedProjects={selectedProjects}
                onToggleSelect={handleToggleSelect}
                onToggleProjectSelect={handleToggleProjectSelect}
                sortMode={sortMode}
              />
            )}
          </>
        )}
      </div>

      <div className="px-3 py-1 border-t border-[var(--border-secondary)] bg-[var(--bg-secondary)] text-[10px] text-[var(--text-tertiary)]">
        <span className="block truncate whitespace-nowrap">
          #{spaceId}: Проектов <span className="text-[var(--text-primary)]">{footerStats.projectCount}</span> • Виджетов{' '}
          <span className="text-purple-400">{footerStats.widgetCount}</span> • Таблиц{' '}
          <span className="text-green-400">{footerStats.tableCount}</span>
        </span>
      </div>

      {/* Resize Handle */}
      <div
        onMouseDown={handleMouseDown}
        className={`absolute top-0 right-0 w-1.5 h-full cursor-ew-resize hover:bg-[var(--accent-primary)]/30 transition-colors ${
          isResizing ? 'bg-[var(--accent-primary)]/50' : ''
        }`}
        title="Drag to resize"
      >
        <div className="absolute top-1/2 right-0 -translate-y-1/2 opacity-0 group-hover:opacity-100">
          <GripVertical className="w-3 h-3 text-[var(--text-tertiary)]" />
        </div>
      </div>

      {/* Create Folder Modal */}
      <CreateFolderModal
        open={createFolderOpen}
        onOpenChange={setCreateFolderOpen}
        projects={projects}
        spaceId={spaceId}
        t={t}
      />

      {/* Space Manager Modal */}
      {spaceId && (
        <SpaceManagerModal
          open={isSpaceManagerOpen}
          onOpenChange={setIsSpaceManagerOpen}
          spaceId={spaceId}
          spaceName={spaceName}
          spaceIcon={spaceIcon}
          initialTab="structure"
        />
      )}

      {/* Create Project Modal */}
      {spaceId && (
        <CreateProjectModal
          open={isCreateProjectOpen}
          onOpenChange={setIsCreateProjectOpen}
          spaceId={spaceId}
          onCreated={() => {
            refreshNavTree();
          }}
        />
      )}
    </div>
  );
};

export default NavTreePanel;
