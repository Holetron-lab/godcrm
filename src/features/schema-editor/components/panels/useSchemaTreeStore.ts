/**
 * useSchemaTreeStore - feeds SchemaTree from the schema-editor store (the editor's live path).
 * All knowledge of how the store keys expansion and visibility per node type lives here.
 */

import { useMemo } from 'react';
import { useSchemaEditorStore } from '../../store/schemaEditorStore';
import type { TableNode as TableFlowNode } from '../../types/schema-editor.types';
import type { SchemaTreeModel } from './navTreeTypes';

export const useSchemaTreeStore = (): SchemaTreeModel => {
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
    loadTableRows,
  } = useSchemaEditorStore();

  return useMemo<SchemaTreeModel>(() => ({
    // Projects expand by numeric id; folders, tables ("table:<id>") and the external section by node.id.
    isExpanded: (node) =>
      node.type === 'project' ? expandedProjects.has(node.numericId)
      : node.type === 'folder' || node.type === 'external-section' || node.type === 'table' ? expandedFolders.has(node.id)
      : false,
    getVisibility: (node) =>
      node.type === 'table' ? (tableVisibility[node.numericId] || 'inherit')
      : node.type === 'project' ? (projectVisibility[node.numericId] || 'visible')
      : node.type === 'folder' ? (folderVisibility[node.id] || 'visible')
      : 'inherit',
    // Columns and the rows preview come from the canvas node, so the tree makes no extra request.
    getTableColumns: (tableId) =>
      nodes.find((n): n is TableFlowNode => n.type === 'tableNode' && n.data.tableId === tableId)?.data,
    onToggleExpand: (node) => {
      if (node.type === 'project') toggleProjectExpanded(node.numericId);
      else if (node.type === 'folder' || node.type === 'external-section' || node.type === 'table') toggleFolderExpanded(node.id);
    },
    onVisibilityChange: (node, state) => {
      if (node.type === 'table') setTableVisibility(node.numericId, state);
      else if (node.type === 'project') setProjectVisibility(node.numericId, state);
      else if (node.type === 'folder') setFolderVisibility(node.id, state);
    },
    onLoadTableRows: (tableId) => { void loadTableRows(tableId); },
  }), [
    nodes, tableVisibility, projectVisibility, folderVisibility, expandedProjects, expandedFolders,
    setTableVisibility, setProjectVisibility, setFolderVisibility, toggleProjectExpanded, toggleFolderExpanded, loadTableRows,
  ]);
};
