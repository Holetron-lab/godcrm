import type { NavTreeNode } from '../types/schema-editor.types';

// Types for API tree responses
export interface TreeNodeData {
  name?: string;
  display_name?: string;
  count?: number;
  color?: string;
  theme_primary?: string;
  widget_type?: string;
  main_table_id?: number;
}

export interface TreeApiNode {
  id: string;
  type: string;
  name: string;
  icon?: string;
  data?: TreeNodeData;
  children?: TreeApiNode[];
}

export interface TableRowResponse {
  id: number;
  data?: Record<string, unknown> | string;
}

export const isSystemDataProject = (node: NavTreeNode): boolean => {
  if (node.type !== 'project') return false;
  const name = (node.name || node.displayName || '').toLowerCase();
  return name === 'system data';
};

export const moveSystemDataToBottom = (nodes: NavTreeNode[]): NavTreeNode[] => {
  if (nodes.length === 0) return nodes;
  const systemNodes: NavTreeNode[] = [];
  const otherNodes: NavTreeNode[] = [];
  nodes.forEach((node) => {
    if (isSystemDataProject(node)) {
      systemNodes.push(node);
    } else {
      otherNodes.push(node);
    }
  });
  return systemNodes.length > 0 ? [...otherNodes, ...systemNodes] : nodes;
};

export const isFormsFolder = (node: NavTreeNode): boolean => {
  const label = (node.displayName || node.name || '').toLowerCase();
  return node.id.includes('virtual:forms') || label === 'forms';
};

export const transformApiNodeToNavNode = (
  node: TreeApiNode,
  parentId: string | null
): NavTreeNode => {
  const isTable = node.type === 'table';
  const nodeName = isTable ? node.data?.name || node.name : node.name;
  const nodeDisplayName = isTable ? node.data?.display_name || node.name : node.name;
  return {
    id: node.id,
    type: node.type as NavTreeNode['type'],
    numericId: parseInt(node.id.split(':')[1]) || 0,
    name: nodeName,
    displayName: nodeDisplayName,
    icon: node.icon || '📋',
    children: (node.children || []).map((child) => transformApiNodeToNavNode(child, node.id)),
    parentId,
    tableCount: node.data?.count || (node.children?.length || 0),
    color: node.data?.color || node.data?.theme_primary,
    widgetType: node.data?.widget_type,
    mainTableId: node.data?.main_table_id,
  };
};
