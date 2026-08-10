import { useEffect, useCallback, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useParams } from 'react-router-dom';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  BackgroundVariant,
  useReactFlow,
  Panel,
  type Node,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Database, PanelLeftClose, PanelLeft } from 'lucide-react';

import { useSchemaEditorStore } from '../store/schemaEditorStore';
import { TableNode } from './nodes/TableNode';
import { WidgetNode } from './nodes/WidgetNode';
import { GlowEdge } from './edges/GlowEdge';
import { PendingEdge } from './edges/PendingEdge';
import { EditorToolbar } from './toolbar/EditorToolbar';
import { NavTreePanel } from './panels/NavTreePanel';
import { MoveTablesModal } from './modals/MoveTablesModal';
import { DeleteTablesModal } from './modals/DeleteTablesModal';
import { ProjectBoundaries } from './layers/ProjectBoundaries';
import type { TableNodeData, ColumnData } from '../types/schema-editor.types';
import { useApplyLayout } from './useApplyLayout';
import { Button } from '@/shared/components/ui/Button';

// Register custom node types
const nodeTypes = {
  tableNode: TableNode as any,
  widgetNode: WidgetNode as any,
};

// Register custom edge types
const edgeTypes = {
  glowEdge: GlowEdge as any,
  pendingEdge: PendingEdge as any,
};

// Custom styles for React Flow
const rfStyle = {
  backgroundColor: 'var(--bg-primary)',
};

export const SchemaEditorPage = () => {
  const { spaceId } = useParams<{ spaceId: string }>();
  const {
    nodes: storeNodes,
    edges: storeEdges,
    pendingConnections,
    loadSchema,
    setNodes,
    saveLayout,
    showTablesList,
    toggleTablesList,
    tableVisibility,
    projectVisibility,
    folderVisibility,
    navTree,
    selectedTables,
    setSelectedTables,
    toggleTableSelection,
    clearTableSelection,
    bulkDeleteTables,
    bulkMoveTables,
    projectColors,
    showProjectBoundaries,
    showProjectConnectionLines,
    toggleProjectBoundaries,
  } = useSchemaEditorStore();

  // Build map of tableId -> parent folder ids for visibility inheritance
  const tableFolderMap = useMemo(() => {
    const map = new Map<number, string[]>();
    
    const traverse = (nodes: typeof navTree, parentFolders: string[] = []) => {
      for (const node of nodes) {
        const currentFolders = node.type === 'folder' 
          ? [...parentFolders, node.id] 
          : parentFolders;
        
        if (node.type === 'table') {
          map.set(node.numericId, currentFolders);
        }
        
        if (node.children?.length > 0) {
          traverse(node.children, currentFolders);
        }
      }
    };
    
    traverse(navTree);
    return map;
  }, [navTree]);

  // Filter nodes based on visibility settings
  const visibleNodes = useMemo(() => {
    return storeNodes.filter(node => {
      // Widget nodes are always visible
      if (node.type === 'widgetNode') return true;
      
      const tableId = node.data.tableId;
      const projectId = node.data.projectId;
      
      // Check table-specific visibility first
      const tableVis = tableVisibility[tableId];
      if (tableVis === 'visible') return true;
      if (tableVis === 'hidden') return false;
      
      // Check folder visibility (parent folders)
      const parentFolders = tableFolderMap.get(tableId) || [];
      for (const folderId of parentFolders) {
        const folderVis = folderVisibility[folderId];
        if (folderVis === 'hidden') return false;
      }
      
      // Check project visibility (inherit or not set)
      if (projectId) {
        const projVis = projectVisibility[projectId];
        if (projVis === 'hidden') return false;
        if (projVis === 'visible') return true;
        // partial - show some tables, determined by table-level settings
      }
      
      // Default: show if not explicitly hidden
      return tableVis !== 'hidden';
    });
  }, [storeNodes, tableVisibility, projectVisibility, folderVisibility, tableFolderMap]);

  // React Flow state
  const [nodes, setLocalNodes, onNodesChange] = useNodesState(visibleNodes as any[]);
  const [edges, setLocalEdges, onEdgesChange] = useEdgesState(storeEdges as any[]);
  const [showMiniMap, setShowMiniMap] = useState(true);
  const [zoomLevel, setZoomLevel] = useState(1);

  // React Flow instance for zoom/pan control
  const reactFlowInstance = useReactFlow();
  const flowWrapperRef = useRef<HTMLDivElement | null>(null);
  const selectionSyncRef = useRef(false);
  
  // Move modal state
  const [moveModalOpen, setMoveModalOpen] = useState(false);
  
  // Delete modal state
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);

  // Load schema on mount
  useEffect(() => {
    if (spaceId) {
      loadSchema(parseInt(spaceId));
    }
  }, [spaceId, loadSchema]);

  useEffect(() => {
    const handleMove = (event: Event) => {
      const detail = (event as CustomEvent<{ tableId?: number }>).detail;
      if (!detail?.tableId) return;
      clearTableSelection();
      toggleTableSelection(detail.tableId);
      setMoveModalOpen(true);
    };
    const handleDelete = (event: Event) => {
      const detail = (event as CustomEvent<{ tableId?: number }>).detail;
      if (!detail?.tableId) return;
      clearTableSelection();
      toggleTableSelection(detail.tableId);
      setDeleteModalOpen(true);
    };

    window.addEventListener('schema-editor:move-table', handleMove as EventListener);
    window.addEventListener('schema-editor:delete-table', handleDelete as EventListener);
    return () => {
      window.removeEventListener('schema-editor:move-table', handleMove as EventListener);
      window.removeEventListener('schema-editor:delete-table', handleDelete as EventListener);
    };
  }, [clearTableSelection, toggleTableSelection]);

  // Sync visible nodes to local state
  useEffect(() => {
    setLocalNodes(visibleNodes as any[]);
  }, [visibleNodes, setLocalNodes]);

  useEffect(() => {
    selectionSyncRef.current = true;
    setLocalNodes((prevNodes) =>
      prevNodes.map((node: Node) => {
        if (node.type !== 'tableNode') return node;
        const isSelected = selectedTables.has((node.data as TableNodeData).tableId);
        if (node.selected === isSelected) return node;
        return { ...node, selected: isSelected };
      })
    );
    const resetId = window.setTimeout(() => {
      selectionSyncRef.current = false;
    }, 0);
    return () => window.clearTimeout(resetId);
  }, [selectedTables, setLocalNodes]);

  // Combine store edges with pending connection edges, filter by visible nodes
  useEffect(() => {
    // Get IDs of visible nodes
    const visibleNodeIds = new Set(visibleNodes.map(n => n.id));
    
    // Filter store edges to only show connections between visible nodes
    const filteredStoreEdges = (storeEdges as any[]).filter(edge => 
      visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target)
    );
    
    const pendingEdges = pendingConnections
      .filter(pc => {
        // Only show pending edges for visible tables
        const sourceId = `table-${pc.sourceTableId}`;
        const targetId = `table-${pc.targetTableId}`;
        return visibleNodeIds.has(sourceId) && visibleNodeIds.has(targetId);
      })
      .map((pc) => {
        // Find target node to check if target column exists
        const targetNode = storeNodes.find(n => n.data.tableId === pc.targetTableId);
        const targetColExists = targetNode?.data.columns?.some((c: ColumnData) => c.name === pc.targetColumn);
        const targetHandle = targetColExists ? `target-col-${pc.targetColumn}` : 'target-table-center';
        
        // Find source node to check if source column exists  
        const sourceNode = storeNodes.find(n => n.data.tableId === pc.sourceTableId);
        const sourceColExists = sourceNode?.data.columns?.some((c: ColumnData) => c.name === pc.sourceColumn);
        const sourceHandle = sourceColExists ? `source-col-${pc.sourceColumn}` : 'source-table-center';
        
        return {
          id: `pending-${pc.id}`,
          source: `table-${pc.sourceTableId}`,
          target: `table-${pc.targetTableId}`,
          sourceHandle,
          targetHandle,
          type: 'pendingEdge',
          animated: false,
          style: { stroke: '#3b82f6', strokeWidth: 2 },
          data: {
            isPending: true,
            sourceColumn: pc.sourceColumn,
            targetColumn: pc.targetColumn,
            sourceTableId: pc.sourceTableId,
            targetTableId: pc.targetTableId,
            sourceTableName: sourceNode?.data?.name || '',
            targetTableName: targetNode?.data?.name || '',
          },
        };
      });
    
    // Removed noisy debug log for pending edges
    setLocalEdges([...filteredStoreEdges, ...pendingEdges]);
  }, [storeEdges, pendingConnections, storeNodes, visibleNodes, setLocalEdges]);

  // Handle node drag end - save positions
  const onNodeDragStop = useCallback(() => {
    setNodes(nodes as any);
    saveLayout();
  }, [nodes, setNodes, saveLayout]);

  // Toolbar handlers
  const handleZoomIn = useCallback(() => {
    reactFlowInstance.zoomIn({ duration: 200 });
  }, [reactFlowInstance]);

  const handleZoomOut = useCallback(() => {
    reactFlowInstance.zoomOut({ duration: 200 });
  }, [reactFlowInstance]);

  const handleFitView = useCallback(() => {
    reactFlowInstance.fitView({ duration: 300, padding: 0.2 });
  }, [reactFlowInstance]);

  useEffect(() => {
    setZoomLevel(reactFlowInstance.getZoom());
  }, [reactFlowInstance]);

  const handleZoomChange = useCallback((value: number) => {
    const nextZoom = Math.min(Math.max(value, 0.25), 2);
    reactFlowInstance.zoomTo(nextZoom);
    setZoomLevel(nextZoom);
  }, [reactFlowInstance]);

  const handleViewportChange = useCallback((_: unknown, viewport: { zoom: number }) => {
    setZoomLevel(viewport.zoom);
  }, []);

  const handleToggleMiniMap = useCallback(() => {
    setShowMiniMap((prev) => !prev);
  }, []);

  // Smart layout handler — extracted into a dedicated hook (useApplyLayout.ts)
  // to keep this file under the 800-line guard. Behavior preserved verbatim.
  const handleApplyLayout = useApplyLayout({
    nodes,
    storeEdges: storeEdges as any,
    setLocalNodes,
    setNodes,
    saveLayout,
    reactFlowInstance,
  });

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        saveLayout();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [saveLayout]);

  // Bulk action handlers
  const handleBulkDelete = useCallback(() => {
    if (selectedTables.size === 0) return;
    setDeleteModalOpen(true);
  }, [selectedTables]);

  // Get table data for delete modal
  const tablesToDelete = useMemo(() => {
    return storeNodes
      .filter(node => selectedTables.has(node.data.tableId))
      .map(node => ({
        id: node.data.tableId,
        name: node.data.tableName || node.data.name || `Table ${node.data.tableId}`,
        displayName: node.data.displayName || node.data.tableName || node.data.name,
        icon: node.data.icon
      }));
  }, [storeNodes, selectedTables]);

  const handleBulkMove = useCallback(() => {
    if (selectedTables.size === 0) return;
    setMoveModalOpen(true);
  }, [selectedTables]);

  const handleSelectionChange = useCallback(
    ({ nodes: selectedNodes }: { nodes: Array<{ type?: string; data?: TableNodeData }> }) => {
      if (selectionSyncRef.current) return;
      const tableIds = selectedNodes
        .filter((node) => node.type === 'tableNode' && node.data?.tableId)
        .map((node) => node.data!.tableId);
      setSelectedTables(tableIds);
    },
    [setSelectedTables]
  );

  const focusTable = useCallback(
    (tableId: number) => {
      const targetNode = nodes.find((node) => node.id === `table-${tableId}`);
      if (!targetNode) return;
      const nodeWidth = targetNode.width || 320;
      const nodeHeight = targetNode.height || 220;
      const centerX = targetNode.position.x + nodeWidth / 2;
      const centerY = targetNode.position.y + nodeHeight / 2;
      reactFlowInstance.setCenter(centerX, centerY, { duration: 300, zoom: 1.1 });
      setSelectedTables([tableId]);
    },
    [nodes, reactFlowInstance, setSelectedTables]
  );

  const moveTableToCenter = useCallback(
    (tableId: number) => {
      const targetNode = nodes.find((node) => node.id === `table-${tableId}`);
      if (!targetNode || !flowWrapperRef.current) return;
      const rect = flowWrapperRef.current.getBoundingClientRect();
      const flowCenter = reactFlowInstance.screenToFlowPosition({
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      });
      const nodeWidth = targetNode.width || 320;
      const nodeHeight = targetNode.height || 220;
      const nextPosition = {
        x: flowCenter.x - nodeWidth / 2,
        y: flowCenter.y - nodeHeight / 2,
      };
      const nextNodes = nodes.map((node) =>
        node.id === targetNode.id ? { ...node, position: nextPosition } : node
      );
      setLocalNodes(nextNodes as any);
      setNodes(nextNodes as any);
      saveLayout();
      setSelectedTables([tableId]);
    },
    [nodes, reactFlowInstance, saveLayout, setLocalNodes, setNodes, setSelectedTables]
  );

  useEffect(() => {
    const handleFocus = (event: Event) => {
      const detail = (event as CustomEvent<{ tableId?: number }>).detail;
      if (!detail?.tableId) return;
      focusTable(detail.tableId);
    };
    const handleCenter = (event: Event) => {
      const detail = (event as CustomEvent<{ tableId?: number }>).detail;
      if (!detail?.tableId) return;
      moveTableToCenter(detail.tableId);
    };

    window.addEventListener('schema-editor:focus-table', handleFocus as EventListener);
    window.addEventListener('schema-editor:center-table', handleCenter as EventListener);
    return () => {
      window.removeEventListener('schema-editor:focus-table', handleFocus as EventListener);
      window.removeEventListener('schema-editor:center-table', handleCenter as EventListener);
    };
  }, [focusTable, moveTableToCenter]);

  return (
    <div className="flex flex-col h-full bg-[var(--bg-primary)] p-4">
      {/* Main container with rounded corners */}
      <div className="flex-1 flex flex-col rounded-xl border border-[var(--border-primary)] bg-[var(--bg-primary)] overflow-hidden shadow-lg">
        {/* Toolbar */}
        <EditorToolbar
          onApplyLayout={handleApplyLayout}
          onZoomIn={handleZoomIn}
          onZoomOut={handleZoomOut}
          onFitView={handleFitView}
          selectedTables={selectedTables}
          onBulkDelete={handleBulkDelete}
          onBulkMove={handleBulkMove}
          onClearSelection={clearTableSelection}
          miniMapVisible={showMiniMap}
          onToggleMiniMap={handleToggleMiniMap}
          zoomLevel={zoomLevel}
          onZoomChange={handleZoomChange}
        />

        {/* Main content with left panel and canvas */}
        <div className="flex-1 flex overflow-hidden relative">
          {/* Left Navigation Panel - resizable */}
          {showTablesList && (
            <NavTreePanel onClose={toggleTablesList} />
          )}

          {/* Toggle button for left panel - only show when panel is closed */}
          {!showTablesList && (
            <Button
              variant="ghost"
              size="sm"
              onClick={toggleTablesList}
              className="absolute top-2 left-0 z-10 p-1 h-8 rounded-l-none bg-[var(--bg-secondary)] border border-l-0 border-[var(--border-primary)]"
              title="Show tables list"
            >
              <PanelLeft className="w-4 h-4" />
            </Button>
          )}

          {/* React Flow Canvas */}
          <div ref={flowWrapperRef} className="flex-1">
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onSelectionChange={handleSelectionChange}
              onNodeDragStop={onNodeDragStop}
              onMove={handleViewportChange}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              fitView
              fitViewOptions={{ padding: 0.2 }}
              style={rfStyle}
              connectionLineStyle={{ stroke: '#22c55e', strokeWidth: 2 }}
              defaultEdgeOptions={{
                type: 'glowEdge',
                style: { stroke: '#22c55e', strokeWidth: 2 },
              }}
              panOnDrag
              zoomOnScroll
              selectionOnDrag={false}
            >
              {/* Project boundaries layer - behind nodes */}
              {showProjectBoundaries && (
                <ProjectBoundaries 
                  nodes={nodes} 
                  projectColors={projectColors}
                  showConnectionLines={showProjectConnectionLines}
                />
              )}
              
              <Background
                variant={BackgroundVariant.Dots}
              gap={20}
              size={1}
              color="var(--border-secondary)"
            />
            <Controls
              showZoom={false}
              showFitView={false}
              showInteractive={false}
              className="!bg-[var(--bg-secondary)] !border-[var(--border-primary)] !shadow-lg"
            />
            {showMiniMap && (
              <MiniMap
                nodeColor={(node: Node) => {
                  const data = node.data as TableNodeData;
                  return data?.isExternal ? '#f59e0b' : 'var(--accent-primary)';
                }}
                maskColor="rgba(0, 0, 0, 0.5)"
                className="!bg-[var(--bg-secondary)] !border-[var(--border-primary)]"
              />
            )}

            {/* Empty state */}
            {nodes.length === 0 && (
              <Panel position="top-center" className="mt-20">
                <div className="text-center p-8 bg-[var(--bg-secondary)] rounded-lg border border-[var(--border-primary)] shadow-lg">
                  <Database className="w-12 h-12 text-[var(--text-tertiary)] mx-auto mb-4" />
                  <h2 className="text-lg font-medium text-[var(--text-primary)] mb-2">
                    No tables yet
                  </h2>
                  <p className="text-sm text-[var(--text-secondary)] mb-4">
                    Create your first table to start designing the schema
                  </p>
                  <button className="px-4 py-2 rounded-md bg-[var(--accent-primary)] text-white hover:bg-[var(--accent-primary-hover)] transition-colors">
                    Create Table
                  </button>
                </div>
              </Panel>
            )}
          </ReactFlow>
        </div>
      </div>
      </div>
      
      {/* Move Tables Modal - render in portal to avoid clipping inside ReactFlow */}
      {spaceId &&
        createPortal(
          <MoveTablesModal
            open={moveModalOpen}
            onClose={() => setMoveModalOpen(false)}
            tableIds={Array.from(selectedTables)}
            currentSpaceId={parseInt(spaceId)}
            onSuccess={() => {
              clearTableSelection();
              loadSchema(parseInt(spaceId));
            }}
          />,
          document.body
        )}
      
      {/* Delete Tables Modal */}
      <DeleteTablesModal
        open={deleteModalOpen}
        onOpenChange={setDeleteModalOpen}
        tables={tablesToDelete}
        onConfirm={async () => {
          await bulkDeleteTables();
          clearTableSelection();
        }}
      />
    </div>
  );
};
