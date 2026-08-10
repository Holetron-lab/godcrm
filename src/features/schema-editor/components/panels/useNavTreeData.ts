/**
 * useNavTreeData - Hook for building enriched navigation tree data
 * Combines store nav tree with edge/pending connection status
 */

import { useMemo } from 'react';
import { useSchemaEditorStore } from '../../store/schemaEditorStore';
import type { NavTreeNode } from '../../types/schema-editor.types';

export const useNavTreeData = () => {
  const {
    nodes,
    edges,
    pendingConnections,
    tableVisibility,
    projectVisibility,
    navTree: storeNavTree,
  } = useSchemaEditorStore();

  // Build sets of table IDs that have edges (green) or pending connections (blue)
  // Exclude form edges (orange) - they are self-evident system relations
  const tablesWithEdges = useMemo(() => {
    const set = new Set<number>();
    edges.forEach(edge => {
      // Skip form edges - they start with 'form-edge-'
      if (edge.id.startsWith('form-edge-')) return;
      const sourceId = parseInt(edge.source.replace('table-', ''));
      const targetId = parseInt(edge.target.replace('table-', ''));
      if (!isNaN(sourceId)) set.add(sourceId);
      if (!isNaN(targetId)) set.add(targetId);
    });
    return set;
  }, [edges]);

  const tablesWithPending = useMemo(() => {
    const set = new Set<number>();
    pendingConnections.forEach(pc => {
      set.add(pc.sourceTableId);
      set.add(pc.targetTableId);
    });
    return set;
  }, [pendingConnections]);

  // Enrich navTree from store with edge/pending status and count tables for projects
  const { navTree, externalTables } = useMemo<{ navTree: NavTreeNode[]; externalTables: NavTreeNode[] }>(() => {
    // Build external tables from nodes (not in tree API)
    const external: NavTreeNode[] = [];
    nodes.forEach((node) => {
      if (node.data.isExternal) {
        external.push({
          id: `table:${node.data.tableId}`,
          type: 'table' as const,
          numericId: node.data.tableId,
          name: node.data.name,
          displayName: node.data.displayName,
          icon: node.data.icon,
          color: node.data.color,
          children: [],
          parentId: 'external-section',
          hasEdge: tablesWithEdges.has(node.data.tableId),
          hasPending: tablesWithPending.has(node.data.tableId),
          isExternal: true,
          sourceSpaceName: node.data.sourceSpaceName,
        });
      }
    });

    // Helper to count tables/widgets recursively
    const countItems = (node: NavTreeNode): number => {
      if (node.type === 'table' || node.type === 'widget') return 1;
      return node.children.reduce((sum, child) => sum + countItems(child), 0);
    };

    // Helper to enrich nodes with edge/pending status
    const enrichNode = (node: NavTreeNode): NavTreeNode => {
      if (node.type === 'table') {
        return {
          ...node,
          hasEdge: tablesWithEdges.has(node.numericId),
          hasPending: tablesWithPending.has(node.numericId),
        };
      }

      const enrichedChildren = node.children.map(enrichNode);
      return {
        ...node,
        children: enrichedChildren,
        tableCount: countItems(node),
      };
    };

    // Use navTree from store, enriched with edge/pending status
    const enrichedTree = storeNavTree.map(enrichNode);

    return { navTree: enrichedTree, externalTables: external };
  }, [storeNavTree, nodes, tablesWithEdges, tablesWithPending]);

  const footerStats = useMemo(() => {
    let tableCount = 0;
    let projectCount = 0;
    let widgetCount = 0;
    let hiddenCount = 0;

    const countNode = (node: NavTreeNode) => {
      if (node.type === 'table') {
        tableCount += 1;
        if ((tableVisibility[node.numericId] || 'inherit') === 'hidden') {
          hiddenCount += 1;
        }
      } else if (node.type === 'project') {
        projectCount += 1;
        if ((projectVisibility[node.numericId] || 'visible') === 'hidden') {
          hiddenCount += 1;
        }
      } else if (node.type === 'widget') {
        widgetCount += 1;
      }

      node.children.forEach(countNode);
    };

    navTree.forEach(countNode);
    externalTables.forEach(countNode);

    return { tableCount, projectCount, widgetCount, hiddenCount };
  }, [navTree, externalTables, tableVisibility, projectVisibility]);

  // Get projects list for folder creation
  const projects = useMemo(() => {
    return navTree.filter(node => node.type === 'project');
  }, [navTree]);

  return {
    navTree,
    externalTables,
    footerStats,
    projects,
  };
};
