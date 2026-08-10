/**
 * TreeItem - Sortable tree item component
 */

import { useState } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useQueryClient, useMutation } from '@tanstack/react-query';
import { useSpaceManagerStore, parseItemId } from '../../store/spaceManagerStore';
import type { TreeNode } from '../../types/space-manager.types';
import { projectsApi } from '@/features/projects/api/projectsApi';
import { tablesApi } from '@/features/tables/api/tablesApi';
import { updateWidget } from '@/features/widgets/api/widgetsApi';
import { 
  ChevronRight, 
  ChevronDown, 
  GripVertical,
  MoreHorizontal,
  Copy,
  Move,
  Trash2,
  Check,
  Minus,
  Settings,
  Edit,
  Save,
  X,
  Loader2
} from 'lucide-react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { AccessControlInline } from './AccessControlInline';

// Common icons for quick selection
const COMMON_ICONS = [
  '📁', '📂', '📊', '📈', '📉', '💼', '🎯', '🚀', '⚡', '🔥',
  '💡', '🎨', '🛠️', '⚙️', '🔧', '📝', '📋', '📌', '📍', '🎓',
  '🏆', '💎', '💰', '🛒', '🏢', '🏭', '🌟', '✨', '🎬', '🎮',
  '🧩', '🎁', '🎉', '👥', '👤', '📱', '💻', '🖥️', '📧', '📞'
];

interface TreeItemProps {
  node: TreeNode;
  depth: number;
  isExpanded: boolean;
  hasChildren: boolean;
}

const TYPE_ICONS: Record<string, string> = {
  project: '📊',
  folder: '📁',
  table: '📋',
  widget: '🧩',
  dashboard: '📈'
};

export const TreeItem = ({ node, depth, isExpanded, hasChildren }: TreeItemProps) => {
  const [showActions, setShowActions] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(node.name);
  const [editDescription, setEditDescription] = useState(String((node.data as Record<string, unknown>)?.description || ''));
  const [editIcon, setEditIcon] = useState(node.icon || '📁');
  const [showIconPicker, setShowIconPicker] = useState(false);
  const queryClient = useQueryClient();
  
  const {
    tree,
    selectedItems,
    focusedItem,
    dropTarget,
    toggleExpand,
    toggleSelect,
    toggleSelectWithChildren,
    setFocusedItem,
    openMoveModal,
    openDuplicateModal,
    openDeleteConfirm
  } = useSpaceManagerStore();
  
  // Update project mutation
  const updateProjectMutation = useMutation({
    mutationFn: async (data: { id: number; name: string; description: string | null; icon: string }) => {
      return projectsApi.update(data.id, {
        name: data.name,
        description: data.description,
        icon: data.icon
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      queryClient.invalidateQueries({ queryKey: ['space-tree'] });
      setIsEditing(false);
    }
  });
  
  // Update table mutation
  const updateTableMutation = useMutation({
    mutationFn: async (data: { id: number; displayName: string; description: string | null; icon: string }) => {
      return tablesApi.updateTable(String(data.id), {
        displayName: data.displayName,
        description: data.description || undefined,
        icon: data.icon
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tables'] });
      queryClient.invalidateQueries({ queryKey: ['project-tables'] });
      queryClient.invalidateQueries({ queryKey: ['space-tree'] });
      setIsEditing(false);
    }
  });
  
  // Update widget mutation
  const updateWidgetMutation = useMutation({
    mutationFn: async (data: { id: number; name: string; description: string | null; icon: string }) => {
      return updateWidget(data.id, {
        title: data.name,
        description: data.description || undefined,
        icon: data.icon
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['widgets'] });
      queryClient.invalidateQueries({ queryKey: ['space-tree'] });
      setIsEditing(false);
    }
  });
  
  const isSaving = updateProjectMutation.isPending || updateTableMutation.isPending || updateWidgetMutation.isPending;
  const canEdit = node.type === 'project' || node.type === 'table' || node.type === 'widget';
  
  const handleSave = () => {
    if (!editName.trim()) return;
    const { numericId } = parseItemId(node.id);
    
    if (node.type === 'project') {
      updateProjectMutation.mutate({
        id: numericId,
        name: editName.trim(),
        description: editDescription.trim() || null,
        icon: editIcon || '📁'
      });
    } else if (node.type === 'table') {
      updateTableMutation.mutate({
        id: numericId,
        displayName: editName.trim(),
        description: editDescription.trim() || null,
        icon: editIcon || '📊'
      });
    } else if (node.type === 'widget') {
      updateWidgetMutation.mutate({
        id: numericId,
        name: editName.trim(),
        description: editDescription.trim() || null,
        icon: editIcon || '🧩'
      });
    }
  };
  
  const handleCancelEdit = () => {
    setEditName(node.name);
    setEditDescription(String((node.data as Record<string, unknown>)?.description || ''));
    setEditIcon(node.icon || '📁');
    setIsEditing(false);
    setShowIconPicker(false);
  };
  
  const handleStartEdit = () => {
    setEditName(node.name);
    setEditDescription(String((node.data as Record<string, unknown>)?.description || ''));
    setEditIcon(node.icon || '📁');
    setIsEditing(true);
  };
  
  // Helper to collect all descendant ids
  const collectDescendants = (n: TreeNode): string[] => {
    return n.children.flatMap(child => [
      child.id,
      ...collectDescendants(child)
    ]);
  };
  
  const descendants = collectDescendants(node);
  const hasDescendants = descendants.length > 0;
  const allDescendantsSelected = hasDescendants && descendants.every(id => selectedItems.has(id));
  const someDescendantsSelected = hasDescendants && descendants.some(id => selectedItems.has(id)) && !allDescendantsSelected;
  
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({ 
    id: node.id,
    disabled: node.type === 'project' // Don't drag projects for now
  });
  
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    paddingLeft: `${depth * 20 + 8}px`
  };
  
  const isSelected = selectedItems.has(node.id);
  const isFocused = focusedItem === node.id;
  const isDropTarget = dropTarget === node.id;
  
  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    
    if (e.ctrlKey || e.metaKey) {
      // Toggle selection
      toggleSelect(node.id);
    } else if (e.shiftKey) {
      // Range selection (simplified - just toggle for now)
      toggleSelect(node.id);
    } else {
      // Single select - set focus
      setFocusedItem(node.id);
    }
  };
  
  const handleCheckboxChange = (e: React.MouseEvent) => {
    e.stopPropagation();
    // For folders with children - use smart toggle (3-state)
    if (hasDescendants) {
      toggleSelectWithChildren(node.id);
    } else {
      toggleSelect(node.id);
    }
  };
  
  const handleExpandClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    toggleExpand(node.id);
  };
  
  return (
    <div className="flex flex-col">
      <div
        ref={setNodeRef}
        style={style}
        {...attributes}
        onClick={handleClick}
        className={`
          group flex items-center gap-1 py-1.5 pr-2 rounded-lg cursor-pointer
          transition-all duration-150
          ${isSelected 
            ? '' 
            : 'hover:bg-[var(--bg-secondary)]'
          }
          ${isDropTarget 
            ? 'bg-[var(--bg-tertiary)]' 
            : ''
          }
        `}
      >
        {/* Actions Toggle Arrow */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            setShowActions(!showActions);
          }}
          className={`
            p-0.5 rounded transition-all duration-150
            ${showActions 
              ? 'bg-[var(--bg-tertiary)] text-[var(--text-primary)]' 
              : 'opacity-0 group-hover:opacity-50 hover:!opacity-100 hover:bg-[var(--bg-tertiary)] text-[var(--text-tertiary)]'
            }
          `}
        >
          {showActions ? (
            <ChevronDown className="w-3.5 h-3.5" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5" />
          )}
        </button>
        
        {/* Drag Handle */}
        {node.type !== 'project' && (
          <div
            {...listeners}
            className="opacity-0 group-hover:opacity-50 hover:!opacity-100 cursor-grab active:cursor-grabbing p-1"
          >
            <GripVertical className="w-3.5 h-3.5 text-[var(--text-tertiary)]" />
          </div>
        )}
        {node.type === 'project' && <div className="w-[22px]" />}
      
      {/* Custom Checkbox */}
      <button
        onClick={handleCheckboxChange}
        className={`
          w-4 h-4 rounded-[3px] border-2 flex items-center justify-center
          transition-all duration-150 flex-shrink-0
          ${isSelected 
            ? 'bg-[#3b82f6] border-[#3b82f6]' 
            : someDescendantsSelected
            ? 'bg-[#3b82f6]/50 border-[#3b82f6]'
            : 'bg-transparent border-[var(--border-primary)] hover:border-[#3b82f6]/50'
          }
        `}
      >
        {isSelected && allDescendantsSelected && (
          <Check className="w-3 h-3 text-white" strokeWidth={3} />
        )}
        {isSelected && !allDescendantsSelected && hasDescendants && (
          <Minus className="w-3 h-3 text-white" strokeWidth={3} />
        )}
        {isSelected && !hasDescendants && (
          <Check className="w-3 h-3 text-white" strokeWidth={3} />
        )}
        {!isSelected && someDescendantsSelected && (
          <Minus className="w-2.5 h-2.5 text-white" strokeWidth={3} />
        )}
      </button>
      
      {/* Expand/Collapse */}
      {hasChildren ? (
        <button
          onClick={handleExpandClick}
          className="p-0.5 hover:bg-[var(--bg-tertiary)] rounded"
        >
          {isExpanded ? (
            <ChevronDown className="w-4 h-4 text-[var(--text-secondary)]" />
          ) : (
            <ChevronRight className="w-4 h-4 text-[var(--text-secondary)]" />
          )}
        </button>
      ) : (
        <div className="w-5" />
      )}
      
      {/* Icon */}
      <span className="text-base flex-shrink-0">
        {node.icon || TYPE_ICONS[node.type] || '📄'}
      </span>
      
      {/* Name + ID + Description */}
      <div className="flex-1 min-w-0 flex items-center gap-1.5">
        <span className={`
          text-sm truncate
          ${node.type === 'project' ? 'font-semibold' : ''}
          ${isSelected ? 'text-[var(--accent-primary)]' : 'text-[var(--text-primary)]'}
        `}>
          {node.name}
        </span>
        
        {/* ID badge for all items except virtual folders */}
        {!node.id.startsWith('virtual:') && (
          <span className={`text-[10px] flex-shrink-0 ${
            node.type === 'widget' ? 'text-purple-400' : 'text-[var(--text-tertiary)]'
          }`}>
            ({parseItemId(node.id).numericId})
            {/* Table key */}
            {node.type === 'table' && (node.data as Record<string, unknown>)?.name && (
              <span className="ml-1 text-cyan-500 font-mono">
                {String((node.data as Record<string, unknown>).name)}
              </span>
            )}
          </span>
        )}
        
        {/* Description with ellipsis */}
        {(node.data as Record<string, unknown>)?.description && (
          <span className="text-xs text-[var(--text-tertiary)] truncate opacity-70 hidden sm:inline">
            {String((node.data as Record<string, unknown>).description)}
          </span>
        )}
      </div>
      
      {/* Type Badge */}
      <span className={`
        text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded
        ${node.type === 'project' 
          ? 'bg-[var(--accent-primary)]/10 text-[var(--accent-primary)]'
          : node.type === 'folder'
          ? 'bg-amber-500/10 text-amber-500'
          : node.type === 'table'
          ? 'bg-green-500/10 text-green-500'
          : 'bg-purple-500/10 text-purple-500'
        }
      `}>
        {node.type}
      </span>
      
      {/* Actions Menu */}
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            className="
              opacity-0 group-hover:opacity-100 p-1
              hover:bg-[var(--bg-tertiary)] rounded
              transition-opacity
            "
          >
            <MoreHorizontal className="w-4 h-4 text-[var(--text-secondary)]" />
          </button>
        </DropdownMenu.Trigger>
        
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            className="
              min-w-[160px] p-1
              bg-[var(--bg-primary)] border border-[var(--border-primary)]
              rounded-lg shadow-xl z-[100]
            "
            sideOffset={5}
          >
            {node.type !== 'project' && (
              <DropdownMenu.Item
                onClick={() => openMoveModal([node.id])}
                className="
                  flex items-center gap-2 px-3 py-2 text-sm
                  text-[var(--text-primary)] rounded cursor-pointer
                  hover:bg-[var(--bg-secondary)] outline-none
                "
              >
                <Move className="w-4 h-4" />
                Move to...
              </DropdownMenu.Item>
            )}
            
            <DropdownMenu.Item
              onClick={() => openDuplicateModal(node.id)}
              className="
                flex items-center gap-2 px-3 py-2 text-sm
                text-[var(--text-primary)] rounded cursor-pointer
                hover:bg-[var(--bg-secondary)] outline-none
              "
            >
              <Copy className="w-4 h-4" />
              Duplicate
            </DropdownMenu.Item>
            
            <DropdownMenu.Separator className="h-px bg-[var(--border-primary)] my-1" />
            
            <DropdownMenu.Item
              onClick={() => openDeleteConfirm([node.id])}
              className="
                flex items-center gap-2 px-3 py-2 text-sm
                text-red-500 rounded cursor-pointer
                hover:bg-red-500/10 outline-none
              "
            >
              <Trash2 className="w-4 h-4" />
              Delete
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      </div>
      
      {/* Expandable Actions Panel - Full Width */}
      {showActions && (
        <div 
          className="mx-1 mb-1 p-3 bg-[var(--bg-secondary)] rounded-lg border border-[var(--border-secondary)]"
          onClick={(e) => e.stopPropagation()}
        >
          {isEditing ? (
            /* Edit Mode */
            <div className="space-y-3">
              {/* Icon picker + Name */}
              <div className="flex items-start gap-3">
                <div className="relative">
                  <button
                    onClick={() => setShowIconPicker(!showIconPicker)}
                    className="text-2xl hover:bg-[var(--bg-tertiary)] rounded-lg p-1 transition-colors"
                    title="Click to change icon"
                  >
                    {editIcon}
                  </button>
                  
                  {showIconPicker && (
                    <div className="absolute top-full left-0 mt-1 p-2 bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-lg shadow-xl z-50 w-64">
                      <div className="grid grid-cols-8 gap-1 max-h-32 overflow-y-auto">
                        {COMMON_ICONS.map((icon, i) => (
                          <button
                            key={i}
                            onClick={() => {
                              setEditIcon(icon);
                              setShowIconPicker(false);
                            }}
                            className={`
                              text-lg p-1 rounded hover:bg-[var(--bg-secondary)] transition-colors
                              ${editIcon === icon ? 'bg-[var(--accent-primary)]/20 ring-1 ring-[var(--accent-primary)]' : ''}
                            `}
                          >
                            {icon}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                
                <div className="flex-1 space-y-2">
                  <input
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="w-full px-2 py-1 text-sm font-medium text-[var(--text-primary)] bg-[var(--bg-tertiary)] border border-[var(--border-primary)] rounded focus:outline-none focus:ring-1 focus:ring-[var(--accent-primary)]"
                    placeholder="Name..."
                    autoFocus
                  />
                  <input
                    type="text"
                    value={editDescription}
                    onChange={(e) => setEditDescription(e.target.value)}
                    className="w-full px-2 py-1 text-xs text-[var(--text-secondary)] bg-[var(--bg-tertiary)] border border-[var(--border-primary)] rounded focus:outline-none focus:ring-1 focus:ring-[var(--accent-primary)]"
                    placeholder="Description..."
                  />
                </div>
              </div>
              
              {/* Edit actions */}
              <div className="flex items-center gap-2 pt-2 border-t border-[var(--border-secondary)]">
                <button
                  onClick={handleSave}
                  disabled={isSaving || !editName.trim()}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-[var(--accent-primary)] text-white rounded hover:bg-[var(--accent-primary)]/80 disabled:opacity-50 transition-colors"
                >
                  {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                  Save
                </button>
                <button
                  onClick={handleCancelEdit}
                  disabled={isSaving}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] rounded transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            /* View Mode */
            <>
              {/* Info Row */}
              <div className="flex items-start gap-3 mb-3">
                {/* Icon */}
                <span className="text-2xl">{node.icon || TYPE_ICONS[node.type] || '📄'}</span>
                
                {/* Details */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-medium text-[var(--text-primary)]">{node.name}</span>
                    <span className={`
                      text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded
                      ${node.type === 'project' 
                        ? 'bg-[var(--accent-primary)]/10 text-[var(--accent-primary)]'
                        : node.type === 'folder'
                        ? 'bg-amber-500/10 text-amber-500'
                        : node.type === 'table'
                        ? 'bg-green-500/10 text-green-500'
                        : 'bg-purple-500/10 text-purple-500'
                      }
                    `}>
                      {node.type}
                    </span>
                    {/* Delete button - in the row */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        openDeleteConfirm([node.id]);
                      }}
                      className="ml-auto p-1 text-red-500 hover:bg-red-500/10 rounded transition-colors"
                      title="Delete"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                  
                  {/* Table key */}
                  {node.type === 'table' && (node.data as Record<string, unknown>)?.name && (
                    <div className="text-xs text-cyan-500 font-mono mb-1">
                      key: {String((node.data as Record<string, unknown>).name)}
                    </div>
                  )}
                  
                  {/* Description */}
                  {(node.data as Record<string, unknown>)?.description && (
                    <p className="text-xs text-[var(--text-secondary)] mb-1">
                      {String((node.data as Record<string, unknown>).description)}
                    </p>
                  )}
                  
                  {/* Created date */}
                  {(node.data as Record<string, unknown>)?.created_at && (
                    <p className="text-[10px] text-[var(--text-tertiary)]">
                      Created: {new Date(String((node.data as Record<string, unknown>).created_at)).toLocaleDateString()}
                    </p>
                  )}
                </div>
              </div>
              
              {/* Access Control for tables and projects */}
              {(node.type === 'table' || node.type === 'project') && (
                <div className="mb-2">
                  <AccessControlInline
                    itemType={node.type}
                    itemId={parseItemId(node.id).numericId}
                    onUpdate={() => {
                      queryClient.invalidateQueries({ queryKey: ['space-tree'] });
                    }}
                  />
                </div>
              )}
              
              {/* Actions Row */}
              <div className="flex items-center gap-2 pt-2 border-t border-[var(--border-secondary)]">
                {canEdit && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleStartEdit();
                    }}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] rounded transition-colors"
                  >
                    <Edit className="w-3.5 h-3.5" />
                    Edit
                  </button>
                )}
                {node.type !== 'project' && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      openMoveModal([node.id]);
                    }}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] rounded transition-colors"
                  >
                    <Move className="w-3.5 h-3.5" />
                    Move
                  </button>
                )}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    openDuplicateModal(node.id);
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] rounded transition-colors"
                >
                  <Copy className="w-3.5 h-3.5" />
                  Duplicate
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default TreeItem;
