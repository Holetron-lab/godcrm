/**
 * NavTreeItem - Single tree item component (recursive)
 * Renders project, folder, table, widget, or external-section nodes
 */

import { useRef } from 'react';
import { useSchemaEditorStore } from '../../store/schemaEditorStore';
import type { NavTreeNode, TableVisibilityState, TableNode as TableFlowNode } from '../../types/schema-editor.types';
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
  Table2,
} from 'lucide-react';
import { VisibilityCheckbox } from './VisibilityCheckbox';
import { NavTreeItemContextMenu } from './NavTreeItemContextMenu';
import { NavTreeColumnRow } from './NavTreeColumnRow';
import { getWidgetIcon } from '../widgetIcon';
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

// Holding the table emoji this long opens "Move" (the table keeps a plain click free).
const HOLD_TO_MOVE_MS = 500;

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
    nodes,
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

  // Tables expand into their columns (data comes from the canvas node, so there is no extra request).
  const tableNode = node.type === 'table'
    ? nodes.find((n): n is TableFlowNode => n.type === 'tableNode' && n.data.tableId === node.numericId)
    : undefined;
  const columns = tableNode?.data.columns ?? [];

  const isExpanded =
    node.type === 'project'
      ? expandedProjects.has(node.numericId)
      : node.type === 'folder' || node.type === 'external-section' || node.type === 'table'
        ? expandedFolders.has(node.id)  // Use node.id for virtual folders and tables ("table:<id>")
        : false;

  const hasChildren = node.children.length > 0 || columns.length > 0;

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
    } else if (node.type === 'folder' || node.type === 'external-section' || node.type === 'table') {
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

  // Name click opens the entity settings (table → edit modal, project → edit project).
  const handleNameClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (node.type === 'table') {
      window.dispatchEvent(new CustomEvent('schema-editor:edit-table', { detail: { tableId: node.numericId } }));
    } else if (node.type === 'project') {
      window.dispatchEvent(new CustomEvent('schema-editor:edit-project', { detail: { projectId: node.numericId } }));
    }
  };

  // Hold the table emoji → Move dialog; a released-early press does nothing.
  const holdTimerRef = useRef<number | null>(null);
  const startHold = () => {
    if (node.type !== 'table') return;
    holdTimerRef.current = window.setTimeout(() => {
      holdTimerRef.current = null;
      window.dispatchEvent(new CustomEvent('schema-editor:move-table', { detail: { tableId: node.numericId } }));
    }, HOLD_TO_MOVE_MS);
  };
  const cancelHold = () => {
    if (holdTimerRef.current !== null) {
      window.clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
  };

  // Get row background style based on table color
  const getRowStyle = (): React.CSSProperties => {
    if (node.type === 'table' && node.color) {
      return { backgroundColor: `${node.color}20` }; // 20 = ~12% opacity in hex
    }
    return {};
  };

  const displayText = node.displayName || node.name;

  // Connection colour: external grey, pending blue, related green. The dot is shown only for tables
  // that take part in a relation; the table icon carries the same colour on every table.
  const getIndicatorClass = () => {
    if (node.type !== 'table') return '';
    if (node.isExternal) return 'bg-gray-400 dark:bg-gray-500';
    if (node.hasPending) return 'bg-primary-500 dark:bg-primary-400';
    if (node.hasEdge) return 'bg-emerald-500 dark:bg-green-400';
    return '';
  };
  const tableIconClass = node.isExternal ? 'text-gray-400 dark:text-gray-500'
    : node.hasPending ? 'text-primary-500 dark:text-primary-400'
    : node.hasEdge ? 'text-emerald-500 dark:text-green-400'
    : 'text-gray-400 dark:text-gray-500';

  const showIndicator = node.type === 'table' && (node.hasEdge || node.hasPending);
  const showContextMenuTrigger = node.type !== 'external-section';
  const WidgetIcon = node.type === 'widget' ? getWidgetIcon(node.presetName || node.widgetType, node.widgetConfig) : null;

  const primaryTableId = node.type === 'table' ? node.numericId
    : node.type === 'widget' ? node.mainTableId
    : getChildTableIds(node)[0];

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

  const nameClasses = `text-sm truncate ${
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
    node.type === 'widget' ? 'text-purple-700 dark:text-purple-300' :
    'text-[var(--text-primary)]'
  }`;

  const nameTitle = node.type === 'table'
    ? `${displayText} (ID: ${node.numericId}, key: ${node.name})${node.isExternal && node.sourceSpaceName ? ` • ${node.sourceSpaceName}` : ''} — ${t('schemaEditor.navMenu.openTableSettings')}`
    : node.type === 'project' ? t('schemaEditor.navMenu.openProjectSettings')
    : node.type === 'widget' ? `${node.displayName} (${node.presetName || node.widgetType || 'widget'})` : undefined;

  const rowPaddingLeft = depth * 12 + 8;

  return (
    <div>
      <div
        style={{ paddingLeft: `${rowPaddingLeft}px`, ...getRowStyle() }}
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

        {/* Expand/Collapse */}
        {hasChildren ? (
          <button
            onClick={handleToggleExpand}
            aria-expanded={isExpanded}
            aria-label={`${isExpanded ? t('schemaEditor.collapseAll') : t('schemaEditor.expandAll')}: ${displayText}`}
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

        {/* Visibility Checkbox - for projects, folders and tables (always visible) */}
        {(node.type === 'project' || node.type === 'table' || node.type === 'folder') && (
          <VisibilityCheckbox
            state={visibilityState}
            onChange={handleVisibilityChange}
            t={t}
          />
        )}

        {/* Icon - left side; the table emoji opens Move when held */}
        {node.type === 'table' ? (
          <button
            type="button"
            onPointerDown={startHold}
            onPointerUp={cancelHold}
            onPointerLeave={cancelHold}
            onPointerCancel={cancelHold}
            onClick={(e) => e.stopPropagation()}
            aria-label={`${t('schemaEditor.navMenu.holdToMove')}: ${displayText}`}
            title={t('schemaEditor.navMenu.holdToMove')}
            className="text-sm flex-shrink-0 select-none touch-none"
          >
            {node.icon}
          </button>
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

        {/* Name - a button for tables/projects (opens their settings) */}
        {node.type === 'table' || node.type === 'project' ? (
          <button
            type="button"
            onClick={handleNameClick}
            className={`${nameClasses} text-left hover:text-[var(--accent-primary)] transition-colors`}
            title={nameTitle}
          >
            {displayText}
          </button>
        ) : (
          <span className={nameClasses} title={nameTitle}>
            {displayText}
          </span>
        )}

        {/* ID and Key for tables - flex-1 to push badge to right */}
        {node.type === 'table' && (
          <span className="flex-1 text-[10px] text-[var(--text-secondary)] font-mono truncate">
            #{node.numericId} • {node.name}
          </span>
        )}
        {node.type === 'project' && (
          <span className="flex-1 text-[10px] text-[var(--text-secondary)] font-mono truncate">
            #{node.numericId}
          </span>
        )}
        {node.type === 'widget' && (
          <span className="flex-1 text-[10px] text-purple-700 dark:text-purple-300 truncate">
            {node.presetName || node.widgetType || 'widget'}
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

        {/* Kind icon left of the menu: tables in their connection colour, modules in purple */}
        {node.type === 'table' && (
          <Table2 className={`w-3.5 h-3.5 flex-shrink-0 ${tableIconClass}`} aria-hidden="true" />
        )}
        {WidgetIcon && (
          <WidgetIcon className="w-3.5 h-3.5 flex-shrink-0 text-purple-500" aria-hidden="true" />
        )}

        {/* ⋮ context menu on the right */}
        {showContextMenuTrigger && (
          <NavTreeItemContextMenu
            node={node}
            primaryTableId={primaryTableId}
            t={t}
          />
        )}
      </div>

      {/* Columns of an expanded table - last nesting level, same indent as the table row */}
      {isExpanded && node.type === 'table' && tableNode && columns.length > 0 && (
        <div>
          {columns.map((column, index) => (
            <NavTreeColumnRow
              key={column.id}
              tableId={node.numericId}
              column={column}
              canMoveUp={!column.isPrimaryKey && index > columns.findIndex((c) => !c.isPrimaryKey)}
              canMoveDown={!column.isPrimaryKey && index < columns.length - 1}
              rowsPreview={tableNode.data.rowsPreview}
              rowsLoading={tableNode.data.rowsLoading}
              paddingLeft={rowPaddingLeft}
            />
          ))}
        </div>
      )}

      {/* Children */}
      {isExpanded && node.children.length > 0 && (
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
