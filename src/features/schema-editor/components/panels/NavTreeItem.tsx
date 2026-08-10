/**
 * NavTreeItem - Single tree item component (recursive)
 * Renders project, folder, table, widget, or external-section nodes
 */

import { useState } from 'react';
import { useSchemaEditorStore } from '../../store/schemaEditorStore';
import type { NavTreeNode, TableVisibilityState } from '../../types/schema-editor.types';
import {
  ChevronRight,
  ChevronDown,
  GripVertical,
  Square,
  CheckSquare,
  Minus,
  ExternalLink,
  Folder,
  Database,
  HardDrive,
  RefreshCw,
  Globe,
  FileText,
  Component,
} from 'lucide-react';
import { VisibilityCheckbox } from './VisibilityCheckbox';
import { NavTreeItemContextMenu } from './NavTreeItemContextMenu';
import type { ParentSelectionState } from './navTreeTypes';

interface NavTreeItemProps {
  node: NavTreeNode;
  depth: number;
  t: (key: string) => string;
  selectedTables: Set<number>;
  selectedProjects: Map<number, ParentSelectionState>;
  onToggleSelect: (tableId: number) => void;
  onToggleProjectSelect: (projectId: number, children: number[]) => void;
  sortMode?: boolean;
}

// Get all table IDs from children (recursive)
const getChildTableIds = (n: NavTreeNode): number[] => {
  const ids: number[] = [];
  n.children.forEach(child => {
    if (child.type === 'table') {
      ids.push(child.numericId);
    }
    ids.push(...getChildTableIds(child));
  });
  return ids;
};

export const NavTreeItem = ({
  node,
  depth,
  t,
  selectedTables,
  selectedProjects,
  onToggleSelect,
  onToggleProjectSelect,
  sortMode = false,
}: NavTreeItemProps) => {
  const {
    tableVisibility,
    projectVisibility,
    folderVisibility,
    expandedProjects,
    expandedFolders,
    setTableVisibility,
    setProjectVisibility,
    setFolderVisibility,
    toggleProjectExpanded,
    toggleFolderExpanded,
  } = useSchemaEditorStore();

  const isExpanded =
    node.type === 'project'
      ? expandedProjects.has(node.numericId)
      : node.type === 'folder' || node.type === 'external-section'
        ? expandedFolders.has(node.id)  // Use node.id for virtual folders
        : false;

  const hasChildren = node.children.length > 0;

  // Get visibility state for this node
  const visibilityState: TableVisibilityState =
    node.type === 'table'
      ? (tableVisibility[node.numericId] || 'inherit')
      : node.type === 'project'
        ? (projectVisibility[node.numericId] || 'visible')
        : node.type === 'folder'
          ? (folderVisibility[node.id] || 'visible')
          : 'inherit';

  const handleToggleExpand = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (node.type === 'project') {
      toggleProjectExpanded(node.numericId);
    } else if (node.type === 'folder' || node.type === 'external-section') {
      toggleFolderExpanded(node.id);  // Use node.id for virtual folders
    }
  };

  const handleVisibilityChange = (newState: TableVisibilityState) => {
    if (node.type === 'table') {
      setTableVisibility(node.numericId, newState);
    } else if (node.type === 'project') {
      setProjectVisibility(node.numericId, newState);
    } else if (node.type === 'folder') {
      setFolderVisibility(node.id, newState);
    }
  };

  // Get row background style based on table color
  const getRowStyle = (): React.CSSProperties => {
    if (node.type === 'table' && node.color) {
      return { backgroundColor: `${node.color}20` }; // 20 = ~12% opacity in hex
    }
    return {};
  };

  // Build display text for tables: "DisplayName" with (#id . key) styled like node
  const getDisplayText = () => {
    if (node.type === 'table') {
      return node.displayName || node.name;
    }
    if (node.type === 'widget') {
      return node.displayName || node.name;
    }
    if (node.type === 'external-section') {
      return node.displayName || node.name;
    }
    return node.displayName || node.name;
  };

  // Get connection indicator color
  const getIndicatorClass = () => {
    if (node.type !== 'table') return '';
    if (node.isExternal) return 'bg-gray-400 dark:bg-gray-500';
    if (node.hasPending) return 'bg-primary-500 dark:bg-primary-400';
    if (node.hasEdge) return 'bg-emerald-500 dark:bg-green-400';
    return '';
  };

  const showIndicator = node.type === 'table' && (node.hasEdge || node.hasPending || node.isExternal);
  const showContextMenuTrigger = node.type === 'table' || node.type === 'project' || node.type === 'folder';

  const primaryTableId = node.type === 'table' ? node.numericId : getChildTableIds(node)[0];

  // Get selection state for project/folder
  const getParentSelectionState = (): ParentSelectionState => {
    if (node.type !== 'project' && node.type !== 'folder') return 'none';
    return selectedProjects.get(node.numericId) || 'none';
  };

  const parentState = getParentSelectionState();

  // Get icon for parent selection state
  const getParentCheckIcon = () => {
    switch (parentState) {
      case 'self': return <CheckSquare className="w-3.5 h-3.5 text-[var(--accent-primary)]" />;
      case 'all': return <CheckSquare className="w-3.5 h-3.5 text-green-500" />;
      case 'children-only': return <Minus className="w-3.5 h-3.5 text-amber-500" />;
      default: return <Square className="w-3.5 h-3.5 text-[var(--text-tertiary)] opacity-0 group-hover:opacity-100" />;
    }
  };

  const getParentCheckTitle = () => {
    switch (parentState) {
      case 'none': return t('schemaEditor.selection.clickToSelectParent');
      case 'self': return t('schemaEditor.selection.clickToSelectAll');
      case 'all': return t('schemaEditor.selection.clickToKeepChildren');
      case 'children-only': return t('schemaEditor.selection.clickToClear');
      default: return '';
    }
  };

  return (
    <div>
      <div
        style={{ paddingLeft: `${depth * 12 + 8}px`, ...getRowStyle() }}
        className={`group relative flex items-center gap-1 h-7 pr-2 rounded hover:bg-[var(--bg-secondary)] cursor-pointer ${
          node.type === 'external-section' ? 'border-t border-[var(--border-secondary)] mt-2' : ''
        } ${sortMode ? 'cursor-grab active:cursor-grabbing' : ''}`}
        draggable={sortMode && node.type === 'table'}
      >
        {/* Drag handle - visible in sort mode */}
        {sortMode && node.type === 'table' && (
          <div className="flex-shrink-0 cursor-grab active:cursor-grabbing">
            <GripVertical className="w-3.5 h-3.5 text-[var(--text-tertiary)]" />
          </div>
        )}

        {/* Smart Selection Checkbox - for projects and folders (hidden in sort mode) */}
        {!sortMode && (node.type === 'project' || node.type === 'folder') && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleProjectSelect(node.numericId, getChildTableIds(node));
            }}
            className="p-0.5 rounded hover:bg-[var(--bg-tertiary)] transition-colors flex-shrink-0"
            title={getParentCheckTitle()}
          >
            {getParentCheckIcon()}
          </button>
        )}

        {/* Expand/Collapse */}
        {hasChildren ? (
          <button
            onClick={handleToggleExpand}
            className="p-0.5 hover:bg-[var(--bg-tertiary)] rounded flex-shrink-0"
          >
            {isExpanded ? (
              <ChevronDown className="w-3.5 h-3.5 text-[var(--text-secondary)]" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5 text-[var(--text-secondary)]" />
            )}
          </button>
        ) : (
          <div className="w-4.5" />
        )}

        {/* Selection Checkbox - only for tables (hidden in sort mode) */}
        {!sortMode && node.type === 'table' && (
          <button
            onClick={(e) => { e.stopPropagation(); onToggleSelect(node.numericId); }}
            className="p-0.5 rounded hover:bg-[var(--bg-tertiary)] transition-colors flex-shrink-0"
            title={selectedTables.has(node.numericId) ? t('common.deselect') : t('common.select')}
          >
            {selectedTables.has(node.numericId) ? (
              <CheckSquare className="w-3.5 h-3.5 text-[var(--accent-primary)]" />
            ) : (
              <Square className="w-3.5 h-3.5 text-[var(--text-tertiary)] opacity-0 group-hover:opacity-100" />
            )}
          </button>
        )}

        {/* Visibility Checkbox - for projects, folders and tables (always visible) */}
        {(node.type === 'project' || node.type === 'table' || node.type === 'folder') && (
          <VisibilityCheckbox
            state={visibilityState}
            onChange={handleVisibilityChange}
            t={t}
          />
        )}

        {/* Icon - left side */}
        {node.type === 'table' ? (
          <span className="text-sm flex-shrink-0">{node.icon}</span>
        ) : node.type === 'external-section' ? (
          <ExternalLink className="w-3.5 h-3.5 text-gray-500 flex-shrink-0" />
        ) : node.type === 'folder' ? (
          // Special icons for virtual folders (DATABASES, Internal, Forms, etc.)
          node.id.includes('virtual:databases') ? <Database className="w-3.5 h-3.5 text-yellow-500 flex-shrink-0" /> :
          node.id.includes('virtual:internal') ? <HardDrive className="w-3.5 h-3.5 text-primary-500 flex-shrink-0" /> :
          node.id.includes('virtual:synced') ? <RefreshCw className="w-3.5 h-3.5 text-cyan-500 flex-shrink-0" /> :
          node.id.includes('virtual:external') ? <Globe className="w-3.5 h-3.5 text-indigo-500 flex-shrink-0" /> :
          node.id.includes('virtual:forms') ? <FileText className="w-3.5 h-3.5 text-orange-500 flex-shrink-0" /> :
          <Folder className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
        ) : (
          <span className="text-sm flex-shrink-0">{node.icon}</span>
        )}

        {/* Name */}
        <span
          className={`text-sm truncate ${
            node.type === 'project' ? 'font-medium text-[var(--text-primary)]' :
            node.type === 'folder' ? (
              node.id.includes('virtual:databases') ? 'font-medium text-yellow-500' :
              node.id.includes('virtual:internal') ? 'font-medium text-primary-500' :
              node.id.includes('virtual:synced') ? 'font-medium text-cyan-500' :
              node.id.includes('virtual:external') ? 'font-medium text-indigo-500' :
              node.id.includes('virtual:forms') ? 'font-medium text-orange-500' :
              'font-medium text-amber-500'
            ) :
            node.type === 'external-section' ? 'font-medium text-gray-500 dark:text-gray-400 text-xs uppercase tracking-wide' :
            node.type === 'widget' ? 'text-purple-400' :
            'text-[var(--text-primary)]'
          }`}
          title={node.type === 'table'
            ? `${node.displayName || node.name} (ID: ${node.numericId}, key: ${node.name})${node.isExternal && node.sourceSpaceName ? ` • ${node.sourceSpaceName}` : ''}`
            : node.type === 'widget' ? `${node.displayName} (${node.widgetType})` : undefined
          }
        >
          {getDisplayText()}
        </span>

        {/* ID and Key for tables - flex-1 to push badge to right */}
        {node.type === 'table' && (
          <span className="flex-1 text-[10px] text-gray-500 dark:text-gray-500 font-mono opacity-70 truncate">
            #{node.numericId} • {node.name}
          </span>
        )}
        {node.type === 'project' && (
          <span className="flex-1 text-[10px] text-[var(--text-tertiary)] font-mono opacity-70 truncate">
            #{node.numericId}
          </span>
        )}
        {node.type === 'widget' && (
          <span className="flex-1 text-[10px] text-purple-400 opacity-70 truncate">
            {node.widgetType || 'widget'}
          </span>
        )}
        {node.type !== 'table' && node.type !== 'widget' && node.type !== 'project' && (
          <span className="flex-1" />
        )}

        {/* Connection indicator for tables */}
        {showIndicator && (
          <span
            className={`w-2 h-2 rounded-full flex-shrink-0 ${getIndicatorClass()}`}
            title={
              node.isExternal ? t('schemaEditor.connections.externalConnections') :
              node.hasPending ? t('schemaEditor.connections.pendingConnections') :
              t('schemaEditor.connections.existingRelations')
            }
          />
        )}

        {/* Type Badge - right side icons + context menu */}
        {showContextMenuTrigger ? (
          <NavTreeItemContextMenu
            node={node}
            primaryTableId={primaryTableId}
            t={t}
          />
        ) : (
          <span
            className="flex-shrink-0 text-purple-500"
            title={node.type.toUpperCase()}
          >
            {node.type === 'widget' ? <Component className="w-3.5 h-3.5" /> : null}
          </span>
        )}
      </div>

      {/* Children */}
      {isExpanded && hasChildren && (
        <div>
          {node.children.map((child) => (
            <NavTreeItem
              key={child.id}
              node={child}
              depth={depth + 1}
              t={t}
              selectedTables={selectedTables}
              selectedProjects={selectedProjects}
              onToggleSelect={onToggleSelect}
              onToggleProjectSelect={onToggleProjectSelect}
              sortMode={sortMode}
            />
          ))}
        </div>
      )}
    </div>
  );
};
