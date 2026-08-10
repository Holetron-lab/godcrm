/**
 * StructureTab - Main tab with tree view
 */

import { logger } from '@/shared/utils/logger';
import { useMemo, useCallback } from 'react';
import {
  DndContext,
  DragOverlay,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragStartEvent,
  DragEndEvent,
  DragOverEvent
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy
} from '@dnd-kit/sortable';
import { useSpaceManagerStore, parseItemId } from '../../store/spaceManagerStore';
import { useBatchOperations } from '../../hooks/useBatchOperations';
import { TreeItem } from '../tree/TreeItem';
import { DetailsPanel } from '../panels/DetailsPanel';
import type { TreeNode } from '../../types/space-manager.types';
import { Loader2, FolderOpen, ChevronRight, ChevronDown, ExpandIcon, ShrinkIcon, Plus, FolderPlus, Search, Move, Copy, Trash2, Layers, Download, Upload } from 'lucide-react';
import { Button } from '@/shared/components/ui/Button';

interface StructureTabProps {
  tree: TreeNode[];
  spaceId: number;
  onRefresh: () => void;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
}

export const StructureTab = ({ tree, spaceId, onRefresh, searchQuery, setSearchQuery }: StructureTabProps) => {
  const {
    expandedNodes,
    selectedItems,
    focusedItem,
    draggedItem,
    setDraggedItem,
    setDropTarget,
    expandAll,
    collapseAll,
    selectAll,
    deselectAll,
    openExportModal,
    openImportModal,
    openMoveModal,
    openDuplicateModal,
    openDeleteConfirm
  } = useSpaceManagerStore();
  
  const { reorderItems, isLoading } = useBatchOperations(spaceId);
  
  // Sensors for drag and drop
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8, // 8px movement required to start drag
      }
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates
    })
  );
  
  // Flatten tree for sortable context (only first level of each parent)
  const flattenTree = useCallback((nodes: TreeNode[], parentExpanded = true): string[] => {
    if (!parentExpanded) return [];
    
    return nodes.flatMap(node => {
      const isExpanded = expandedNodes.has(node.id);
      return [
        node.id,
        ...flattenTree(node.children, isExpanded)
      ];
    });
  }, [expandedNodes]);
  
  const flatIds = useMemo(() => flattenTree(tree, true), [tree, flattenTree]);
  
  // Find node by ID
  const findNode = useCallback((id: string, nodes: TreeNode[] = tree): TreeNode | null => {
    for (const node of nodes) {
      if (node.id === id) return node;
      const found = findNode(id, node.children);
      if (found) return found;
    }
    return null;
  }, [tree]);
  
  // Drag handlers
  const handleDragStart = useCallback((event: DragStartEvent) => {
    setDraggedItem(event.active.id as string);
  }, [setDraggedItem]);
  
  const handleDragOver = useCallback((event: DragOverEvent) => {
    const { over } = event;
    setDropTarget(over ? over.id as string : null);
  }, [setDropTarget]);
  
  const handleDragEnd = useCallback(async (event: DragEndEvent) => {
    const { active, over } = event;
    
    setDraggedItem(null);
    setDropTarget(null);
    
    if (!over || active.id === over.id) return;
    
    // For now, just reorder within same parent
    // Full parent-changing DnD would need more complex logic
    const activeNode = findNode(active.id as string);
    const overNode = findNode(over.id as string);
    
    if (!activeNode || !overNode) return;
    
    // Only allow reorder within same type and parent
    // TODO: Implement cross-parent moving via drag
    
    // Get siblings at same level
    const findParent = (id: string, nodes: TreeNode[], parent: TreeNode | null = null): TreeNode | null => {
      for (const node of nodes) {
        if (node.children.some(c => c.id === id)) return node;
        const found = findParent(id, node.children, node);
        if (found) return found;
      }
      return null;
    };
    
    const activeParent = findParent(active.id as string, tree);
    const overParent = findParent(over.id as string, tree);
    
    // Same parent check
    if (activeParent?.id !== overParent?.id) return;
    
    const siblings = activeParent ? activeParent.children : tree;
    const activeIndex = siblings.findIndex(n => n.id === active.id);
    const overIndex = siblings.findIndex(n => n.id === over.id);
    
    if (activeIndex === -1 || overIndex === -1) return;
    
    // Create new order
    const newOrder = siblings.map((s, i) => ({
      id: s.id,
      order_index: i === activeIndex ? overIndex : i === overIndex ? activeIndex : i
    }));
    
    try {
      await reorderItems(newOrder);
      onRefresh();
    } catch (err) {
      logger.error('Reorder failed:', err);
    }
  }, [findNode, tree, reorderItems, onRefresh, setDraggedItem, setDropTarget]);
  
  // Drag overlay content
  const draggedNode = draggedItem ? findNode(draggedItem) : null;
  
  // Render tree recursively
  const renderTree = (nodes: TreeNode[], depth = 0) => {
    return nodes.map(node => {
      const isExpanded = expandedNodes.has(node.id);
      const hasChildren = node.children.length > 0;
      
      return (
        <div key={node.id}>
          <TreeItem
            node={node}
            depth={depth}
            isExpanded={isExpanded}
            hasChildren={hasChildren}
          />
          {isExpanded && hasChildren && (
            <div className="ml-0">
              {renderTree(node.children, depth + 1)}
            </div>
          )}
        </div>
      );
    });
  };
  
  return (
    <div className="flex flex-col h-full">
      {/* Tree Panel */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        {/* Toolbar Row 1: Create + Search */}
        <div className="flex items-center gap-1 mb-2 pb-2 border-b border-[var(--border-secondary)]">
          <Button
            variant="ghost"
            size="sm"
            onClick={expandAll}
            className="gap-1 text-xs h-7"
          >
            <ExpandIcon className="w-3.5 h-3.5" />
            Expand
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={collapseAll}
            className="gap-1 text-xs h-7"
          >
            <ShrinkIcon className="w-3.5 h-3.5" />
            Collapse
          </Button>
          <div className="w-px h-4 bg-[var(--border-secondary)] mx-1" />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => useSpaceManagerStore.getState().openCreateProjectModal()}
            className="gap-1 text-xs h-7"
          >
            <Plus className="w-3.5 h-3.5" />
            Project
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => useSpaceManagerStore.getState().openCreateFolderModal()}
            className="gap-1 text-xs h-7"
          >
            <FolderPlus className="w-3.5 h-3.5" />
            Folder
          </Button>
          
          <div className="w-px h-4 bg-[var(--border-secondary)] mx-1" />
          
          {/* Export/Import */}
          <Button
            variant="ghost"
            size="sm"
            onClick={openExportModal}
            className="gap-1 text-xs h-7"
          >
            <Download className="w-3.5 h-3.5" />
            Export
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={openImportModal}
            className="gap-1 text-xs h-7"
          >
            <Upload className="w-3.5 h-3.5" />
            Import
          </Button>
          
          {/* Search */}
          <div className="relative ml-auto">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--text-tertiary)]" />
            <input
              type="text"
              placeholder="Search..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-44 pl-7 pr-2 py-1 text-xs bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-md text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:ring-1 focus:ring-[var(--accent-primary)]/50"
            />
          </div>
        </div>
        
        {/* Toolbar Row 2: Selection + Batch Actions */}
        <div className="flex items-center gap-1 mb-2 pb-2 border-b border-[var(--border-secondary)]">
          <Button
            variant="ghost"
            size="sm"
            onClick={selectAll}
            className="gap-1 text-xs h-7"
          >
            <Layers className="w-3.5 h-3.5" />
            Select all
          </Button>
          {selectedItems.size > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={deselectAll}
              className="text-xs h-7"
            >
              Clear
            </Button>
          )}
          
          {selectedItems.size > 0 && (
            <>
              <div className="w-px h-4 bg-[var(--border-secondary)] mx-1" />
              <span className="text-xs text-[var(--accent-primary)] font-medium px-2">
                {selectedItems.size} selected
              </span>
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
                onClick={() => openDuplicateModal(Array.from(selectedItems)[0])}
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
            </>
          )}
        </div>
        
        {/* Tree */}
        <div className="flex-1 overflow-auto">
          {tree.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-[var(--text-secondary)]">
              <FolderOpen className="w-12 h-12 mb-4 opacity-50" />
              <p>No items in this space</p>
              <p className="text-sm mt-1">Create a project to get started</p>
            </div>
          ) : (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragStart={handleDragStart}
              onDragOver={handleDragOver}
              onDragEnd={handleDragEnd}
            >
              <SortableContext items={flatIds} strategy={verticalListSortingStrategy}>
                <div className="space-y-0.5">
                  {renderTree(tree)}
                </div>
              </SortableContext>
              
              <DragOverlay>
                {draggedNode && (
                  <div className="
                    flex items-center gap-2 px-3 py-2
                    bg-[var(--bg-primary)] border border-[var(--accent-primary)]
                    rounded-lg shadow-lg opacity-90
                  ">
                    <span>{draggedNode.icon}</span>
                    <span className="text-sm font-medium">{draggedNode.name}</span>
                  </div>
                )}
              </DragOverlay>
            </DndContext>
          )}
        </div>
      </div>
      
      {/* Details Panel - Bottom */}
      <DetailsPanel 
        spaceId={spaceId}
        tree={tree}
        onRefresh={onRefresh}
      />
    </div>
  );
};

export default StructureTab;
