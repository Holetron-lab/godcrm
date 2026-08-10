/**
 * Space Manager Store (Zustand)
 * Based on ADR-004: Space Manager XL Modal
 */

import { create } from 'zustand';
import type { TreeNode, BatchItem, SpaceManagerTab, MoveTarget } from '../types/space-manager.types';

interface SpaceManagerState {
  // Current context
  spaceId: number | null;
  
  // UI state
  activeTab: SpaceManagerTab;
  searchQuery: string;
  isLoading: boolean;
  error: string | null;
  
  // Tree state
  tree: TreeNode[];
  expandedNodes: Set<string>;
  
  // Selection
  selectedItems: Set<string>;
  focusedItem: string | null;
  
  // Drag-drop
  draggedItem: string | null;
  dropTarget: string | null;
  
  // Modals
  moveModalOpen: boolean;
  moveModalItems: string[];
  duplicateModalOpen: boolean;
  duplicateModalItem: string | null;
  createFolderModalOpen: boolean;
  createFolderParentId: number | null;
  createProjectModalOpen: boolean;
  deleteConfirmOpen: boolean;
  deleteConfirmItems: string[];
  exportModalOpen: boolean;
  importModalOpen: boolean;
}

interface SpaceManagerActions {
  // Actions - UI
  setActiveTab: (tab: SpaceManagerTab) => void;
  setSearchQuery: (query: string) => void;
  setSpaceId: (id: number | null) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  
  // Actions - Tree
  setTree: (tree: TreeNode[]) => void;
  toggleExpand: (nodeId: string) => void;
  expandAll: () => void;
  collapseAll: () => void;
  
  // Actions - Selection
  toggleSelect: (nodeId: string) => void;
  toggleSelectWithChildren: (nodeId: string) => void;
  selectAll: () => void;
  deselectAll: () => void;
  setFocusedItem: (nodeId: string | null) => void;
  selectMultiple: (nodeIds: string[]) => void;
  deselectMultiple: (nodeIds: string[]) => void;
  
  // Actions - Drag-drop
  setDraggedItem: (nodeId: string | null) => void;
  setDropTarget: (nodeId: string | null) => void;
  
  // Actions - Modals
  openMoveModal: (items?: string[]) => void;
  closeMoveModal: () => void;
  openDuplicateModal: (item: string) => void;
  closeDuplicateModal: () => void;
  openCreateFolderModal: (parentId?: number) => void;
  closeCreateFolderModal: () => void;
  openCreateProjectModal: () => void;
  closeCreateProjectModal: () => void;
  openDeleteConfirm: (items?: string[]) => void;
  closeDeleteConfirm: () => void;
  
  // Export/Import Modals
  openExportModal: () => void;
  closeExportModal: () => void;
  openImportModal: () => void;
  closeImportModal: () => void;
  
  // Reset
  reset: () => void;
}

const initialState: SpaceManagerState = {
  spaceId: null,
  activeTab: 'structure',
  searchQuery: '',
  isLoading: false,
  error: null,
  tree: [],
  expandedNodes: new Set(),
  selectedItems: new Set(),
  focusedItem: null,
  draggedItem: null,
  dropTarget: null,
  moveModalOpen: false,
  moveModalItems: [],
  duplicateModalOpen: false,
  duplicateModalItem: null,
  createFolderModalOpen: false,
  createFolderParentId: null,
  createProjectModalOpen: false,
  deleteConfirmOpen: false,
  deleteConfirmItems: [],
  exportModalOpen: false,
  importModalOpen: false
};

export const useSpaceManagerStore = create<SpaceManagerState & SpaceManagerActions>((set, get) => ({
  ...initialState,
  
  // UI Actions
  setActiveTab: (tab) => set({ activeTab: tab }),
  setSearchQuery: (query) => set({ searchQuery: query }),
  setSpaceId: (id) => set({ spaceId: id }),
  setLoading: (loading) => set({ isLoading: loading }),
  setError: (error) => set({ error }),
  
  // Tree Actions
  setTree: (tree) => set({ tree }),
  
  toggleExpand: (nodeId) => set((state) => {
    const next = new Set(state.expandedNodes);
    if (next.has(nodeId)) {
      next.delete(nodeId);
    } else {
      next.add(nodeId);
    }
    return { expandedNodes: next };
  }),
  
  expandAll: () => {
    const { tree } = get();
    const collectIds = (nodes: TreeNode[]): string[] => {
      return nodes.flatMap(node => [
        node.id,
        ...collectIds(node.children)
      ]);
    };
    set({ expandedNodes: new Set(collectIds(tree)) });
  },
  
  collapseAll: () => set({ expandedNodes: new Set() }),
  
  // Selection Actions
  toggleSelect: (nodeId) => set((state) => {
    const next = new Set(state.selectedItems);
    if (next.has(nodeId)) {
      next.delete(nodeId);
    } else {
      next.add(nodeId);
    }
    return { selectedItems: next };
  }),
  
  toggleSelectWithChildren: (nodeId) => {
    const { tree, selectedItems } = get();
    
    // Helper to find node and its children
    const findNode = (nodes: TreeNode[], id: string): TreeNode | null => {
      for (const node of nodes) {
        if (node.id === id) return node;
        const found = findNode(node.children, id);
        if (found) return found;
      }
      return null;
    };
    
    // Helper to collect all descendant ids
    const collectDescendants = (node: TreeNode): string[] => {
      return node.children.flatMap(child => [
        child.id,
        ...collectDescendants(child)
      ]);
    };
    
    const node = findNode(tree, nodeId);
    if (!node) return;
    
    const descendants = collectDescendants(node);
    const hasDescendants = descendants.length > 0;
    const isNodeSelected = selectedItems.has(nodeId);
    const allChildrenSelected = hasDescendants && descendants.every(id => selectedItems.has(id));
    const anyChildrenSelected = hasDescendants && descendants.some(id => selectedItems.has(id));
    
    set((state) => {
      const next = new Set(state.selectedItems);
      
      // No descendants - simple toggle
      if (!hasDescendants) {
        if (isNodeSelected) {
          next.delete(nodeId);
        } else {
          next.add(nodeId);
        }
        return { selectedItems: next };
      }
      
      // With descendants - 4-state cycle
      if (!isNodeSelected && !anyChildrenSelected) {
        // State 1: Nothing selected -> Select only folder
        next.add(nodeId);
      } else if (isNodeSelected && !allChildrenSelected) {
        // State 2: Folder selected but not all children -> Select all children too
        descendants.forEach(id => next.add(id));
      } else if (isNodeSelected && allChildrenSelected) {
        // State 3: Everything selected -> Deselect folder, keep children
        next.delete(nodeId);
      } else if (!isNodeSelected && anyChildrenSelected) {
        // State 4: Only children selected -> Deselect all
        descendants.forEach(id => next.delete(id));
      }
      
      return { selectedItems: next };
    });
  },

  selectAll: () => {
    const { tree } = get();
    const collectIds = (nodes: TreeNode[]): string[] => {
      return nodes.flatMap(node => [
        node.id,
        ...collectIds(node.children)
      ]);
    };
    set({ selectedItems: new Set(collectIds(tree)) });
  },
  
  deselectAll: () => set({ selectedItems: new Set() }),
  
  setFocusedItem: (nodeId) => set({ focusedItem: nodeId }),
  
  selectMultiple: (nodeIds) => set((state) => {
    const next = new Set(state.selectedItems);
    nodeIds.forEach(id => next.add(id));
    return { selectedItems: next };
  }),
  
  deselectMultiple: (nodeIds) => set((state) => {
    const next = new Set(state.selectedItems);
    nodeIds.forEach(id => next.delete(id));
    return { selectedItems: next };
  }),
  
  // Drag-drop Actions
  setDraggedItem: (nodeId) => set({ draggedItem: nodeId }),
  setDropTarget: (nodeId) => set({ dropTarget: nodeId }),
  
  // Modal Actions
  openMoveModal: (items) => {
    const { selectedItems } = get();
    set({ 
      moveModalOpen: true, 
      moveModalItems: items || Array.from(selectedItems)
    });
  },
  closeMoveModal: () => set({ moveModalOpen: false, moveModalItems: [] }),
  
  openDuplicateModal: (item) => set({ duplicateModalOpen: true, duplicateModalItem: item }),
  closeDuplicateModal: () => set({ duplicateModalOpen: false, duplicateModalItem: null }),
  
  openCreateFolderModal: (parentId) => set({ 
    createFolderModalOpen: true, 
    createFolderParentId: parentId ?? null 
  }),
  closeCreateFolderModal: () => set({ createFolderModalOpen: false, createFolderParentId: null }),
  
  openCreateProjectModal: () => set({ createProjectModalOpen: true }),
  closeCreateProjectModal: () => set({ createProjectModalOpen: false }),
  
  openDeleteConfirm: (items) => {
    const { selectedItems } = get();
    set({ 
      deleteConfirmOpen: true, 
      deleteConfirmItems: items || Array.from(selectedItems)
    });
  },
  closeDeleteConfirm: () => set({ deleteConfirmOpen: false, deleteConfirmItems: [] }),
  
  // Export/Import Modal Actions
  openExportModal: () => set({ exportModalOpen: true }),
  closeExportModal: () => set({ exportModalOpen: false }),
  openImportModal: () => set({ importModalOpen: true }),
  closeImportModal: () => set({ importModalOpen: false }),
  
  // Reset
  reset: () => set(initialState)
}));

// Helper function to parse item ID
export const parseItemId = (id: string): { type: string; numericId: number } => {
  const [type, idStr] = id.split(':');
  return { type, numericId: parseInt(idStr, 10) };
};

// Helper to convert selection to BatchItems
export const selectionToBatchItems = (selection: Set<string>): BatchItem[] => {
  return Array.from(selection).map(id => {
    const { type, numericId } = parseItemId(id);
    return { type: type as BatchItem['type'], id: numericId };
  });
};
