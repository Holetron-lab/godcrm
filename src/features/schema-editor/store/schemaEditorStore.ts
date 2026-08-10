import { create } from 'zustand';
import { logger } from '@/shared/utils/logger';
import type {
  TableNode,
  SchemaConnection,
  SchemaEditorState,
  ColumnData,
  PendingConnection,
  NavTreeNode,
  TableVisibilityState,
  EdgeShapeType,
  LineStyleType,
  EdgeStyleConfig,
} from '../types/schema-editor.types';
import { schemaApi } from '../api/schemaApi';
import { tablesApi } from '@/features/tables/api/tablesApi';
import { apiClient } from '@/shared/utils/apiClient';
import {
  moveSystemDataToBottom,
  transformApiNodeToNavNode,
  type TreeApiNode,
  type TableRowResponse,
} from './navTreeHelpers';
import { loadSchemaData } from './loadSchemaLogic';

interface SchemaEditorActions {
  // Initialization
  loadSchema: (spaceId: number) => Promise<void>;
  reset: () => void;

  // Nodes
  setNodes: (nodes: TableNode[]) => void;
  addNode: (node: TableNode) => void;
  updateNodePosition: (nodeId: string, x: number, y: number) => void;
  removeNode: (nodeId: string) => void;

  // Edges
  setEdges: (edges: SchemaConnection[]) => void;
  addEdge: (edge: SchemaConnection) => void;
  removeEdge: (edgeId: string) => void;
  invertEdgeDirection: (edgeId: string) => void;

  // Pending Connections
  addPendingConnection: (connection: Omit<PendingConnection, 'id' | 'createdAt'>) => void;
  removePendingConnection: (id: string) => void;
  clearPendingConnections: () => void;
  applyPendingConnections: () => Promise<void>;

  // Column Selection for connection mode
  selectColumn: (tableId: number, columnName: string) => void;
  clearColumnSelection: () => void;

  // Selection
  selectNode: (nodeId: string | null) => void;
  selectEdge: (edgeId: string | null) => void;

  // Connection mode
  startConnection: (
    nodeId: string,
    columnName: string,
    handleType: 'source' | 'target'
  ) => void;
  cancelConnection: () => void;

  // Persistence
  saveLayout: () => Promise<void>;

  // Refresh
  refreshSchema: () => Promise<void>;
  refreshNavTree: () => Promise<void>;
  loadTableRows: (tableId: number) => Promise<void>;
  updateTableColor: (tableId: number, color: string | null) => Promise<void>;

  // UI toggles
  toggleAIChat: () => void;
  toggleTablesList: () => void;
  toggleProjectBoundaries: () => void;
  toggleProjectConnectionLines: () => void;

  // Edge style
  setEdgeShape: (shape: EdgeShapeType) => void;
  setLineStyle: (style: LineStyleType) => void;
  setEdgeStyleConfig: (config: EdgeStyleConfig) => void;
  // Legacy alias
  setEdgeStyle: (style: EdgeShapeType) => void;

  // Navigation tree visibility
  setTableVisibility: (tableId: number, state: 'visible' | 'hidden' | 'partial' | 'inherit') => void;
  setProjectVisibility: (projectId: number, state: 'visible' | 'hidden' | 'partial' | 'inherit') => void;
  setFolderVisibility: (folderId: string, state: 'visible' | 'hidden' | 'partial' | 'inherit') => void;
  toggleProjectExpanded: (projectId: number) => void;
  toggleFolderExpanded: (folderId: string) => void;
  showAllTables: () => void;
  hideAllTables: () => void;

  // Navigation tree data
  navTree: NavTreeNode[];
  setNavTree: (tree: NavTreeNode[]) => void;

  // Table selection for bulk operations
  selectedTables: Set<number>;
  setSelectedTables: (tableIds: number[]) => void;
  toggleTableSelection: (tableId: number) => void;
  selectAllTablesInProject: (tableIds: number[]) => void;
  clearTableSelection: () => void;
  bulkDeleteTables: () => Promise<void>;
  bulkMoveTables: (targetProjectId: number) => Promise<void>;
}

const initialState: SchemaEditorState = {
  spaceId: null,
  nodes: [],
  edges: [],
  pendingConnections: [],
  selectedNodeId: null,
  selectedEdgeId: null,
  selectedColumnKey: null,
  zoom: 1,
  isConnecting: false,
  connectionStart: null,
  showAIChat: false,
  showTablesList: true,
  showProjectBoundaries: true,
  showProjectConnectionLines: false,
  edgeShape: 'rounded', // Default edge shape
  lineStyle: 'solid', // Default line style
  edgeStyle: 'rounded', // Legacy alias
  edgeStyleConfig: {
    pathStyle: 'smoothstep',
    sourceMarker: 'dot',
    targetMarker: 'dot',
    animated: true,
    animationSpeed: 'normal',
    showGlow: true,
    strokeWidth: 2,
  },
  tableVisibility: {},
  projectVisibility: {},
  folderVisibility: {},
  expandedProjects: new Set(),
  expandedFolders: new Set(),
  projectColors: {},
  selectedTables: new Set(),
};

export const useSchemaEditorStore = create<SchemaEditorState & SchemaEditorActions>(
  (set, get) => ({
    ...initialState,

    // Load schema from API
    loadSchema: async (spaceId: number) => {
      try {
        const result = await loadSchemaData(spaceId);
        set({
          spaceId,
          nodes: result.nodes,
          edges: result.edges,
          navTree: result.navTree,
          expandedProjects: result.expandedProjects,
          expandedFolders: result.expandedFolders,
          folderVisibility: result.folderVisibility,
          projectColors: result.projectColors,
        });
      } catch (error) {
        logger.error('Failed to load schema:', error);
      }
    },

    reset: () => set(initialState),

    // Nodes
    setNodes: (nodes) => set({ nodes }),

    addNode: (node) =>
      set((state) => ({
        nodes: [...state.nodes, node],
      })),

    updateNodePosition: (nodeId, x, y) =>
      set((state) => ({
        nodes: state.nodes.map((n) =>
          n.id === nodeId ? { ...n, position: { x, y } } : n
        ),
      })),

    removeNode: (nodeId) =>
      set((state) => ({
        nodes: state.nodes.filter((n) => n.id !== nodeId),
        edges: state.edges.filter(
          (e) => e.source !== nodeId && e.target !== nodeId
        ),
      })),

    // Edges
    setEdges: (edges) => set({ edges }),

    addEdge: (edge) =>
      set((state) => ({
        edges: [...state.edges, edge],
      })),

    removeEdge: (edgeId) =>
      set((state) => ({
        edges: state.edges.filter((e) => e.id !== edgeId),
      })),

    invertEdgeDirection: (edgeId) =>
      set((state) => ({
        edges: state.edges.map((e) => {
          if (e.id !== edgeId) return e;
          return {
            ...e,
            source: e.target,
            target: e.source,
            sourceHandle: e.targetHandle,
            targetHandle: e.sourceHandle,
            data: e.data
              ? { ...e.data, isReversed: !e.data.isReversed }
              : undefined,
          };
        }),
      })),

    // Selection
    selectNode: (nodeId) =>
      set({ selectedNodeId: nodeId, selectedEdgeId: null }),
    selectEdge: (edgeId) =>
      set({ selectedEdgeId: edgeId, selectedNodeId: null }),

    // Column selection for connection mode
    selectColumn: (tableId: number, columnName: string) => {
      const { selectedColumnKey, nodes } = get();
      const newKey = `${tableId}:${columnName}`;

      if (!selectedColumnKey) {
        // First column selected - start connection
        set({ selectedColumnKey: newKey });
      } else if (selectedColumnKey === newKey) {
        // Same column clicked - deselect
        set({ selectedColumnKey: null });
      } else {
        // Second column selected - create pending connection
        const [sourceTableId, sourceColumn] = selectedColumnKey.split(':');
        const sourceNode = nodes.find(n => n.data.tableId === parseInt(sourceTableId));
        const targetNode = nodes.find(n => n.data.tableId === tableId);

        if (sourceNode && targetNode) {
          const pendingConnection: PendingConnection = {
            id: `pending-${Date.now()}`,
            sourceTableId: parseInt(sourceTableId),
            sourceTableName: sourceNode.data.displayName || sourceNode.data.name,
            sourceColumn,
            targetTableId: tableId,
            targetTableName: targetNode.data.displayName || targetNode.data.name,
            targetColumn: columnName,
            createdAt: new Date(),
          };

          set((state) => ({
            pendingConnections: [...state.pendingConnections, pendingConnection],
            selectedColumnKey: null,
          }));
        }
      }
    },

    clearColumnSelection: () => set({ selectedColumnKey: null }),

    // Pending connections
    addPendingConnection: (connection) =>
      set((state) => ({
        pendingConnections: [
          ...state.pendingConnections,
          {
            ...connection,
            id: `pending-${Date.now()}`,
            createdAt: new Date(),
          },
        ],
      })),

    removePendingConnection: (id) =>
      set((state) => ({
        pendingConnections: state.pendingConnections.filter((c) => c.id !== id),
      })),

    clearPendingConnections: () => set({ pendingConnections: [] }),

    applyPendingConnections: async () => {
      const { pendingConnections, spaceId, edges, nodes } = get();
      if (!spaceId || pendingConnections.length === 0) return;

      logger.debug('[Schema Editor] Applying pending connections:', pendingConnections);

      // Process each pending connection - update column configs via API
      for (const pc of pendingConnections) {
        try {
          // Find source node and column
          const sourceNode = nodes.find(n => n.data.tableId === pc.sourceTableId);
          const sourceColumn = sourceNode?.data.columns?.find((c: ColumnData) => c.name === pc.sourceColumn);

          if (!sourceColumn) {
            logger.warn(`[Schema Editor] Source column not found: ${pc.sourceColumn}`);
            continue;
          }

          // Determine labelColumn - prefer 'name' or 'title', else first text column
          const targetNode = nodes.find(n => n.data.tableId === pc.targetTableId);
          const targetColumns = targetNode?.data.columns || [];
          let labelColumn = pc.targetColumn;

          // If target is 'id', find a better label column
          if (pc.targetColumn === 'id') {
            const nameCol = targetColumns.find((c: ColumnData) => c.name === 'name' || c.name === 'title');
            if (nameCol) {
              labelColumn = nameCol.name;
            } else {
              const firstTextCol = targetColumns.find((c: ColumnData) => c.type === 'text');
              labelColumn = firstTextCol?.name || 'name';
            }
          }

          // Update the source column with relation config
          await tablesApi.updateColumn(String(pc.sourceTableId), sourceColumn.id, {
            type: 'relation',
            config: {
              ...(sourceColumn.config || {}),
              relation: {
                enabled: true,
                tableId: String(pc.targetTableId),
                valueColumn: pc.targetColumn,
                labelColumn: labelColumn,
              }
            }
          });

          logger.debug(`[Schema Editor] Updated column ${pc.sourceColumn} with relation to table ${pc.targetTableId}`);
        } catch (err) {
          logger.error(`[Schema Editor] Failed to update relation for ${pc.sourceColumn}:`, err);
        }
      }

      // Create new edges from pending connections
      const newEdges = pendingConnections.map(pc => {
        // Find target node to check if target column exists
        const targetNode = nodes.find(n => n.data.tableId === pc.targetTableId);
        const targetColExists = targetNode?.data.columns?.some((c: ColumnData) => c.name === pc.targetColumn);
        const targetHandle = targetColExists ? `target-col-${pc.targetColumn}` : 'target-table-center';

        // Find source node to check if source column exists
        const sourceNode = nodes.find(n => n.data.tableId === pc.sourceTableId);
        const sourceColExists = sourceNode?.data.columns?.some((c: ColumnData) => c.name === pc.sourceColumn);
        const sourceHandle = sourceColExists ? `source-col-${pc.sourceColumn}` : 'source-table-center';

        return {
          id: `edge-${pc.sourceTableId}-${pc.sourceColumn}-${pc.targetTableId}-${Date.now()}`,
          source: `table-${pc.sourceTableId}`,
          target: `table-${pc.targetTableId}`,
          sourceHandle,
          targetHandle,
          type: 'glowEdge',
          animated: false,
          style: { stroke: '#22c55e', strokeWidth: 2 },
          data: {
            sourceColumn: pc.sourceColumn,
            targetColumn: pc.targetColumn,
            relationType: 'one-to-many',
            isReversed: false,
            isNew: true, // Mark as newly created
          },
        };
      });

      // Add new edges to existing edges and reload schema to get fresh data
      set({
        edges: [...edges, ...newEdges as any[]],
        pendingConnections: []
      });

      logger.debug('[Schema Editor] Created edges and persisted relations:', newEdges);

      // Reload schema to refresh with actual database state
      setTimeout(() => {
        get().loadSchema(spaceId);
      }, 500);
    },

    // Connection mode
    startConnection: (nodeId, columnName, handleType) =>
      set({
        isConnecting: true,
        connectionStart: { nodeId, columnName, handleType },
      }),

    cancelConnection: () =>
      set({
        isConnecting: false,
        connectionStart: null,
      }),

    // Save layout
    saveLayout: async () => {
      const { spaceId, nodes } = get();
      if (!spaceId) return;

      const layout = nodes.map((n) => ({
        tableId: n.data.tableId,
        x: n.position.x,
        y: n.position.y,
      }));

      try {
        await schemaApi.saveLayout(spaceId, { nodes: layout });
      } catch (error) {
        logger.error('Failed to save layout:', error);
      }
    },

    // Refresh all schema and row data
    refreshSchema: async () => {
      const { spaceId, loadSchema } = get();
      if (!spaceId) return;

      // Reload schema
      await loadSchema(spaceId);

      // Then reload rows for all tables in parallel
      const updatedNodes = get().nodes;
      await Promise.all(
        updatedNodes.map(async (node) => {
          try {
            const response = await tablesApi.getRows(String(node.data.tableId), 1, 10);
            // tablesApi.getRows returns already parsed rows with data spread
            const rows = response.rows.map((row: TableRowResponse) => ({
              id: String(row.id),
              ...(typeof row.data === 'string' ? JSON.parse(row.data) : row.data),
            }));

            set((state) => ({
              nodes: state.nodes.map((n) =>
                n.id === node.id
                  ? { ...n, data: { ...n.data, rowsPreview: rows, rowsLoading: false } }
                  : n
              ),
            }));
          } catch (err) {
            logger.error(`Failed to load rows for table ${node.data.tableId}:`, err);
          }
        })
      );
    },

    // Refresh nav tree only (preserve expanded/visibility states)
    refreshNavTree: async () => {
      const { spaceId } = get();
      if (!spaceId) return;

      try {
        const treeData = await apiClient.request<{ success: boolean; data: TreeApiNode[] }>(
          `/spaces/${spaceId}/tree`
        );
        if (treeData.success && treeData.data) {
          const navTree = moveSystemDataToBottom(
            treeData.data.map((node) => transformApiNodeToNavNode(node, null))
          );
          const newProjectColors: Record<number, string> = {};
          navTree.forEach((node) => {
            if (node.type === 'project' && node.color) {
              newProjectColors[node.numericId] = node.color;
            }
          });
          set((state) => ({
            navTree,
            projectColors: { ...state.projectColors, ...newProjectColors },
          }));
        }
      } catch (error) {
        logger.error('[Schema Editor] Failed to refresh nav tree:', error);
      }
    },

    // Load rows for a single table
    loadTableRows: async (tableId: number) => {
      const { nodes } = get();
      const node = nodes.find((n) => n.data.tableId === tableId);
      if (!node) return;

      logger.debug('[Schema Editor] loadTableRows called for table:', tableId);

      // Set loading state
      set((state) => ({
        nodes: state.nodes.map((n) =>
          n.data.tableId === tableId
            ? { ...n, data: { ...n.data, rowsLoading: true } }
            : n
        ),
      }));

      try {
        const response = await tablesApi.getRows(String(tableId), 1, 10);
        logger.debug('[Schema Editor] loadTableRows response:', response);
        // tablesApi.getRows returns already parsed rows with data spread
        const rows = response.rows.map((row: TableRowResponse) => ({
          id: String(row.id),
          ...(typeof row.data === 'string' ? JSON.parse(row.data) : row.data || row),
        }));
        logger.debug('[Schema Editor] Parsed rows for table', tableId, ':', rows);

        set((state) => ({
          nodes: state.nodes.map((n) =>
            n.data.tableId === tableId
              ? { ...n, data: { ...n.data, rowsPreview: rows, rowsLoading: false } }
              : n
          ),
        }));
      } catch (err) {
        logger.error(`Failed to load rows for table ${tableId}:`, err);
        set((state) => ({
          nodes: state.nodes.map((n) =>
            n.data.tableId === tableId
              ? { ...n, data: { ...n.data, rowsLoading: false } }
              : n
          ),
        }));
      }
    },

    // Update table color
    updateTableColor: async (tableId: number, color: string | null) => {
      try {
        await tablesApi.updateTable(String(tableId), { color });
        // Update local state
        set((state) => ({
          nodes: state.nodes.map((n) =>
            n.data.tableId === tableId
              ? { ...n, data: { ...n.data, color } }
              : n
          ),
        }));
      } catch (err) {
        logger.error(`Failed to update table color ${tableId}:`, err);
      }
    },

    // UI
    toggleAIChat: () => set((state) => ({ showAIChat: !state.showAIChat })),
    toggleTablesList: () =>
      set((state) => ({ showTablesList: !state.showTablesList })),
    toggleProjectBoundaries: () =>
      set((state) => ({ showProjectBoundaries: !state.showProjectBoundaries })),
    toggleProjectConnectionLines: () =>
      set((state) => ({ showProjectConnectionLines: !state.showProjectConnectionLines })),
    setEdgeShape: (shape) => set({ edgeShape: shape, edgeStyle: shape }),
    setLineStyle: (style) => set({ lineStyle: style }),
    setEdgeStyle: (style) => set({ edgeStyle: style, edgeShape: style }), // Legacy alias
    setEdgeStyleConfig: (config) => set({ edgeStyleConfig: config }),

    // Navigation tree
    navTree: [],
    setNavTree: (tree) => set({ navTree: tree }),

    // Visibility controls
    setTableVisibility: (tableId, state) =>
      set((s) => ({
        tableVisibility: { ...s.tableVisibility, [tableId]: state },
      })),

    setProjectVisibility: (projectId, state) =>
      set((s) => ({
        projectVisibility: { ...s.projectVisibility, [projectId]: state },
      })),

    setFolderVisibility: (folderId: string, state: TableVisibilityState) =>
      set((s) => ({
        folderVisibility: { ...s.folderVisibility, [folderId]: state },
      })),

    toggleProjectExpanded: (projectId) =>
      set((s) => {
        const newSet = new Set(s.expandedProjects);
        if (newSet.has(projectId)) {
          newSet.delete(projectId);
        } else {
          newSet.add(projectId);
        }
        return { expandedProjects: newSet };
      }),

    toggleFolderExpanded: (folderId) =>
      set((s) => {
        const newSet = new Set(s.expandedFolders);
        if (newSet.has(folderId)) {
          newSet.delete(folderId);
        } else {
          newSet.add(folderId);
        }
        return { expandedFolders: newSet };
      }),

    showAllTables: () => {
      const { nodes } = get();
      const visibility: Record<number, 'visible'> = {};
      nodes.forEach((n) => {
        visibility[n.data.tableId] = 'visible';
      });
      set({ tableVisibility: visibility });
    },

    hideAllTables: () => {
      const { nodes } = get();
      const visibility: Record<number, 'hidden'> = {};
      nodes.forEach((n) => {
        visibility[n.data.tableId] = 'hidden';
      });
      set({ tableVisibility: visibility });
    },

    // Table selection for bulk operations
    selectedTables: new Set(),

    setSelectedTables: (tableIds) => set({ selectedTables: new Set(tableIds) }),

    toggleTableSelection: (tableId) =>
      set((s) => {
        const newSet = new Set(s.selectedTables);
        if (newSet.has(tableId)) {
          newSet.delete(tableId);
        } else {
          newSet.add(tableId);
        }
        return { selectedTables: newSet };
      }),

    selectAllTablesInProject: (tableIds) =>
      set((s) => {
        const newSet = new Set(s.selectedTables);
        tableIds.forEach((id) => newSet.add(id));
        return { selectedTables: newSet };
      }),

    clearTableSelection: () => set({ selectedTables: new Set() }),

    bulkDeleteTables: async () => {
      const { selectedTables, spaceId, loadSchema } = get();
      if (selectedTables.size === 0 || !spaceId) return;

      // Use batch API with correct format: operation in body, not in items
      const items = Array.from(selectedTables).map((id) => ({
        type: 'table',
        id,
      }));

      try {
        logger.debug('[Schema Editor] Bulk delete items:', items);
        const result = await apiClient.request(`/spaces/${spaceId}/batch`, {
          method: 'POST',
          body: JSON.stringify({ operation: 'delete', items }),
        });
        logger.debug('[Schema Editor] Bulk delete result:', result);
        set({ selectedTables: new Set() });
        await loadSchema(spaceId);
      } catch (e) {
        logger.error('Bulk delete failed:', e);
        throw e; // Re-throw so modal knows it failed
      }
    },

    bulkMoveTables: async (targetProjectId) => {
      const { selectedTables, spaceId, loadSchema } = get();
      if (selectedTables.size === 0 || !spaceId) return;

      // Use batch API with correct format
      const items = Array.from(selectedTables).map((id) => ({
        type: 'table',
        id,
      }));

      try {
        logger.debug('[Schema Editor] Bulk move items:', items, 'to project:', targetProjectId);
        const result = await apiClient.request(`/spaces/${spaceId}/batch`, {
          method: 'POST',
          body: JSON.stringify({ operation: 'move', items, target: { project_id: targetProjectId } }),
        });
        logger.debug('[Schema Editor] Bulk move result:', result);
        set({ selectedTables: new Set() });
        if (spaceId) {
          await loadSchema(spaceId);
        }
      } catch (e) {
        logger.error('Bulk move failed:', e);
        throw e;
      }
    },
  })
);
