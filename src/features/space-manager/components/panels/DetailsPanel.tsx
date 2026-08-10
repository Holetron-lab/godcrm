/**
 * DetailsPanel - Shows details of focused/selected item with inline editing
 */

import { useState, useMemo, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useSpaceManagerStore, parseItemId } from '../../store/spaceManagerStore';
import { useBatchOperations } from '../../hooks/useBatchOperations';
import { Button } from '@/shared/components/ui/Button';
import { Input } from '@/shared/components/ui/Input';
import { projectsApi } from '@/features/projects/api/projectsApi';
import { tablesApi } from '@/features/tables/api/tablesApi';
import { updateWidget } from '@/features/widgets/api/widgetsApi';
import type { TreeNode } from '../../types/space-manager.types';
import { 
  Info, 
  Move, 
  Copy, 
  Trash2, 
  Edit,
  Calendar,
  Layers,
  ExternalLink,
  Save,
  X,
  Loader2,
  Check,
  Lock,
  Users,
  Shield
} from 'lucide-react';

// Simple date formatter
const formatDate = (date: Date): string => {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
};

// Common icons for projects/tables
const COMMON_ICONS = [
  '📁', '📂', '📊', '📈', '📉', '💼', '🎯', '🚀', '⚡', '🔥',
  '💡', '🎨', '🛠️', '⚙️', '🔧', '📝', '📋', '📌', '📍', '🎓',
  '🏆', '💎', '💰', '🛒', '🏢', '🏭', '🌟', '✨', '🎬', '🎮',
  '🧩', '🎁', '🎉', '👥', '👤', '📱', '💻', '🖥️', '📧', '📞',
  '🗂️', '🗃️', '📦', '🔖', '🏷️', '🔑', '🔒', '🔓', '⭐', '❤️'
];

interface DetailsPanelProps {
  spaceId: number;
  tree: TreeNode[];
  onRefresh: () => void;
}

const TYPE_LABELS: Record<string, string> = {
  project: 'PROJECT',
  folder: 'FOLDER',
  table: 'TABLE',
  widget: 'WIDGET',
  dashboard: 'DASHBOARD'
};

export const DetailsPanel = ({ spaceId, tree, onRefresh }: DetailsPanelProps) => {
  const queryClient = useQueryClient();
  const {
    focusedItem,
    selectedItems,
    openMoveModal,
    openDuplicateModal,
    openDeleteConfirm
  } = useSpaceManagerStore();
  
  const { duplicateItems, isLoading } = useBatchOperations(spaceId);
  
  // Edit state
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editIcon, setEditIcon] = useState('');
  const [editPrivacy, setEditPrivacy] = useState<'shared' | 'personal' | 'owner_admin'>('shared');
  const [showIconPicker, setShowIconPicker] = useState(false);
  
  // Find focused node
  const focusedNode: TreeNode | null = useMemo((): TreeNode | null => {
    if (!focusedItem) return null;
    
    const findNode = (nodes: TreeNode[]): TreeNode | null => {
      for (const node of nodes) {
        if (node.id === focusedItem) return node;
        const found = findNode(node.children);
        if (found) return found;
      }
      return null;
    };
    
    return findNode(tree);
  }, [focusedItem, tree]);
  
  // Reset edit state when focused item changes
  useEffect(() => {
    setIsEditing(false);
    setShowIconPicker(false);
    if (focusedNode) {
      const data = focusedNode.data as Record<string, unknown>;
      setEditName(focusedNode.name);
      setEditDescription(String(data.description || ''));
      setEditIcon(String(focusedNode.icon || '📁'));
      // Get privacy for tables
      const configPrivacy = (data.config as { privacy?: string })?.privacy;
      setEditPrivacy((configPrivacy as 'shared' | 'personal' | 'owner_admin') || 'shared');
    }
  }, [focusedItem, focusedNode?.name]);
  
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
      onRefresh();
    }
  });
  
  // Update table mutation
  const updateTableMutation = useMutation({
    mutationFn: async (data: { id: number; displayName: string; description: string | null; icon: string; privacy?: string }) => {
      return tablesApi.updateTable(String(data.id), {
        displayName: data.displayName,
        description: data.description || undefined,
        icon: data.icon,
        privacy: data.privacy
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tables'] });
      queryClient.invalidateQueries({ queryKey: ['project-tables'] });
      queryClient.invalidateQueries({ queryKey: ['space-tree'] });
      setIsEditing(false);
      onRefresh();
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
      onRefresh();
    }
  });
  
  // Count children by type
  const childCounts = useMemo(() => {
    if (!focusedNode) return {};
    
    const counts: Record<string, number> = {};
    
    const countChildren = (nodes: TreeNode[]) => {
      nodes.forEach(node => {
        counts[node.type] = (counts[node.type] || 0) + 1;
        countChildren(node.children);
      });
    };
    
    countChildren(focusedNode.children);
    return counts;
  }, [focusedNode]);
  
  const selectedCount = selectedItems.size;
  const isSaving = updateProjectMutation.isPending || updateTableMutation.isPending || updateWidgetMutation.isPending;
  
  // Handle save
  const handleSave = () => {
    if (!focusedNode || !editName.trim()) return;
    
    const { numericId } = parseItemId(focusedNode.id);
    
    if (focusedNode.type === 'project') {
      updateProjectMutation.mutate({
        id: numericId,
        name: editName.trim(),
        description: editDescription.trim() || null,
        icon: editIcon || '📁'
      });
    } else if (focusedNode.type === 'table') {
      updateTableMutation.mutate({
        id: numericId,
        displayName: editName.trim(),
        description: editDescription.trim() || null,
        icon: editIcon || '📊',
        privacy: editPrivacy
      });
    } else if (focusedNode.type === 'widget') {
      updateWidgetMutation.mutate({
        id: numericId,
        name: editName.trim(),
        description: editDescription.trim() || null,
        icon: editIcon || '📊'
      });
    }
  };
  
  // Handle cancel
  const handleCancel = () => {
    if (focusedNode) {
      const data = focusedNode.data as Record<string, unknown>;
      setEditName(focusedNode.name);
      setEditDescription(String(data.description || ''));
      setEditIcon(String(focusedNode.icon || '📁'));
      const configPrivacy = (data.config as { privacy?: string })?.privacy;
      setEditPrivacy((configPrivacy as 'shared' | 'personal' | 'owner_admin') || 'shared');
    }
    setIsEditing(false);
    setShowIconPicker(false);
  };
  
  // If multiple selected, show batch panel
  if (selectedCount > 1) {
    return (
      <div className="flex-shrink-0 mt-3 p-3 bg-[var(--bg-secondary)] rounded-lg border border-[var(--border-primary)]">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-[var(--accent-primary)]" />
            <span className="text-sm font-medium text-[var(--text-primary)]">
              {selectedCount} selected
            </span>
          </div>
          
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => openMoveModal()}
              className="gap-1 text-xs h-7"
            >
              <Move className="w-3.5 h-3.5" />
              Move
            </Button>
            
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                const items = Array.from(selectedItems);
                items.forEach(item => duplicateItems([item]));
              }}
              disabled={isLoading}
              className="gap-1 text-xs h-7"
            >
              <Copy className="w-3.5 h-3.5" />
              Duplicate
            </Button>
            
            <Button
              variant="ghost"
              size="sm"
              onClick={() => openDeleteConfirm()}
              className="gap-1 text-xs h-7 text-red-500 hover:text-red-400"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Delete
            </Button>
          </div>
        </div>
      </div>
    );
  }
  
  // If nothing focused, show placeholder
  if (!focusedNode) {
    return (
      <div className="flex-shrink-0 mt-3 px-4 py-3 bg-[var(--bg-secondary)] rounded-lg border border-[var(--border-primary)]">
        <div className="flex items-center gap-3 text-[var(--text-tertiary)]">
          <Info className="w-4 h-4" />
          <span className="text-sm">Click an item to view details • Use checkboxes for batch selection</span>
        </div>
      </div>
    );
  }
  
  // Show focused item details
  const data = focusedNode.data as Record<string, unknown>;
  const createdAt = data.created_at ? new Date(data.created_at as string) : null;
  const canEdit = focusedNode.type === 'project' || focusedNode.type === 'table' || focusedNode.type === 'widget';
  
  return (
    <div className="flex-shrink-0 mt-3 p-3 bg-[var(--bg-secondary)] rounded-lg border border-[var(--border-primary)]">
      <div className="flex items-start gap-4">
        {/* Icon + Name + Type */}
        <div className="flex items-center gap-3 min-w-0 flex-shrink-0">
          {isEditing ? (
            <div className="relative">
              <button
                onClick={() => setShowIconPicker(!showIconPicker)}
                className="text-2xl hover:bg-[var(--bg-tertiary)] rounded-lg p-1 transition-colors"
                title="Click to change icon"
              >
                {editIcon}
              </button>
              
              {showIconPicker && (
                <div className="absolute bottom-full left-0 mb-1 p-2 bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-lg shadow-xl z-50 w-64">
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
          ) : (
            <span className="text-2xl">{String(focusedNode.icon)}</span>
          )}
          
          <div className="min-w-0">
            {isEditing ? (
              <input
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="font-medium text-sm text-[var(--text-primary)] bg-transparent border-b border-[var(--accent-primary)] focus:outline-none px-0 py-0.5 w-40"
                autoFocus
              />
            ) : (
              <p className="font-medium text-sm text-[var(--text-primary)] truncate max-w-[180px]">
                {focusedNode.name}
              </p>
            )}
            <span className={`
              inline-block text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded
              ${focusedNode.type === 'project' 
                ? 'bg-[var(--accent-primary)]/10 text-[var(--accent-primary)]'
                : focusedNode.type === 'folder'
                ? 'bg-amber-500/10 text-amber-500'
                : focusedNode.type === 'table'
                ? 'bg-green-500/10 text-green-500'
                : 'bg-purple-500/10 text-purple-500'
              }
            `}>
              {TYPE_LABELS[focusedNode.type]}
            </span>
          </div>
        </div>
        
        {/* Description */}
        <div className="flex-1 min-w-0">
          {isEditing ? (
            <input
              type="text"
              value={editDescription}
              onChange={(e) => setEditDescription(e.target.value)}
              placeholder="Description..."
              className="w-full text-xs text-[var(--text-secondary)] bg-[var(--bg-tertiary)] border border-[var(--border-primary)] rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-[var(--accent-primary)]"
            />
          ) : data.description ? (
            <p className="text-xs text-[var(--text-secondary)] truncate">
              {String(data.description)}
            </p>
          ) : null}
          
          {/* Meta info */}
          <div className="flex items-center gap-3 mt-1 flex-wrap">
            {Object.keys(childCounts).length > 0 && (
              <span className="text-xs text-[var(--text-tertiary)]">
                {Object.entries(childCounts)
                  .map(([type, count]) => `${count} ${type}${count > 1 ? 's' : ''}`)
                  .join(', ')}
              </span>
            )}
            {createdAt && (
              <span className="text-xs text-[var(--text-tertiary)]">
                <Calendar className="w-3 h-3 inline mr-1" />
                {formatDate(createdAt)}
              </span>
            )}
            {/* Privacy/Access for tables */}
            {focusedNode.type === 'table' && (
              isEditing ? (
                <select
                  value={editPrivacy}
                  onChange={(e) => setEditPrivacy(e.target.value as 'shared' | 'personal' | 'owner_admin')}
                  className="text-xs bg-[var(--bg-tertiary)] border border-[var(--border-primary)] rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-[var(--accent-primary)]"
                >
                  <option value="shared">🌐 Shared</option>
                  <option value="personal">👤 Personal</option>
                  <option value="owner_admin">🔒 Owner/Admin</option>
                </select>
              ) : (
                <span className={`
                  text-xs px-1.5 py-0.5 rounded flex items-center gap-1
                  ${editPrivacy === 'personal' 
                    ? 'bg-primary-500/10 text-primary-500' 
                    : editPrivacy === 'owner_admin'
                    ? 'bg-amber-500/10 text-amber-500'
                    : 'bg-green-500/10 text-green-500'
                  }
                `}>
                  {editPrivacy === 'personal' ? (
                    <><Users className="w-3 h-3" /> Personal</>
                  ) : editPrivacy === 'owner_admin' ? (
                    <><Shield className="w-3 h-3" /> Owner/Admin</>
                  ) : (
                    <><Users className="w-3 h-3" /> Shared</>
                  )}
                </span>
              )
            )}
          </div>
        </div>
        
        {/* Actions */}
        <div className="flex items-center gap-1 flex-shrink-0">
          {isEditing ? (
            <>
              <Button
                variant="primary"
                size="sm"
                onClick={handleSave}
                disabled={isSaving || !editName.trim()}
                className="gap-1 text-xs h-7"
              >
                {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                Save
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleCancel}
                disabled={isSaving}
                className="h-7"
              >
                <X className="w-3.5 h-3.5" />
              </Button>
            </>
          ) : (
            <>
              {canEdit && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setIsEditing(true)}
                  className="gap-1 text-xs h-7"
                >
                  <Edit className="w-3.5 h-3.5" />
                  Edit
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => openDuplicateModal(focusedNode.id)}
                className="gap-1 text-xs h-7"
              >
                <Copy className="w-3.5 h-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => openDeleteConfirm([focusedNode.id])}
                className="gap-1 text-xs h-7 text-red-500 hover:text-red-400"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default DetailsPanel;
