/**
 * WorkflowContextBuilder - Build context string from workflow nodes for AI
 * ADR-043: Labs MindWorkflow Integration
 */

import type { FlowNode, FlowEdge } from '../../mindworkflow/state/api';

export interface WorkflowContextOptions {
  selectedNodeId?: string;
  nodes: FlowNode[];
  edges: FlowEdge[];
  maxTokens?: number;
  depth?: number;
  format?: 'simple' | 'detailed' | 'json';
}

export interface WorkflowContext {
  contextString: string;
  selectedNode: FlowNode | null;
  connectedNodes: FlowNode[];
  nodeCount: number;
}

/**
 * Build workflow context for AI from nodes and edges
 */
export function buildWorkflowContext(options: WorkflowContextOptions): WorkflowContext {
  const {
    selectedNodeId,
    nodes,
    edges,
    maxTokens = 2000,
    depth = 2,
    format = 'simple'
  } = options;

  if (nodes.length === 0) {
    return {
      contextString: '',
      selectedNode: null,
      connectedNodes: [],
      nodeCount: 0
    };
  }

  // Find selected node and connected nodes
  const selectedNode = selectedNodeId 
    ? nodes.find(n => n.node_id === selectedNodeId) || null
    : null;

  const connectedNodes = selectedNodeId
    ? findConnectedNodes(selectedNodeId, nodes, edges, depth)
    : nodes.slice(0, 10); // First 10 nodes if none selected

  // Build context string based on format
  let contextString = '';
  
  if (format === 'json') {
    contextString = buildJsonContext(selectedNode, connectedNodes);
  } else if (format === 'detailed') {
    contextString = buildDetailedContext(selectedNode, connectedNodes, edges);
  } else {
    contextString = buildSimpleContext(selectedNode, connectedNodes);
  }

  // Truncate to max tokens (rough estimate: 4 chars per token)
  const maxChars = maxTokens * 4;
  if (contextString.length > maxChars) {
    contextString = contextString.slice(0, maxChars) + '\n...(truncated)';
  }

  return {
    contextString,
    selectedNode,
    connectedNodes,
    nodeCount: nodes.length
  };
}

/**
 * Build simple markdown context
 */
function buildSimpleContext(selectedNode: FlowNode | null, connectedNodes: FlowNode[]): string {
  let context = '## Workflow Context\n\n';

  if (selectedNode) {
    context += `### Selected Node: ${selectedNode.title || 'Untitled'}\n`;
    context += `Type: ${selectedNode.type}\n`;
    if (selectedNode.content) {
      context += `Content:\n${truncate(selectedNode.content, 500)}\n`;
    }
    context += '\n';
  }

  if (connectedNodes.length > 0) {
    context += '### Related Nodes:\n';
    for (const node of connectedNodes) {
      if (selectedNode && node.node_id === selectedNode.node_id) continue;
      context += `- **${node.title || 'Untitled'}** (${node.type})`;
      if (node.content) {
        context += `: ${truncate(node.content, 100)}`;
      }
      context += '\n';
    }
  }

  return context;
}

/**
 * Build detailed context with connections
 */
function buildDetailedContext(
  selectedNode: FlowNode | null, 
  connectedNodes: FlowNode[],
  edges: FlowEdge[]
): string {
  let context = '## Workflow Context (Detailed)\n\n';

  if (selectedNode) {
    context += `### Selected Node\n`;
    context += `- **ID**: ${selectedNode.node_id}\n`;
    context += `- **Title**: ${selectedNode.title || 'Untitled'}\n`;
    context += `- **Type**: ${selectedNode.type}\n`;
    
    if (selectedNode.content) {
      context += `- **Content**:\n\`\`\`\n${truncate(selectedNode.content, 800)}\n\`\`\`\n`;
    }
    
    // Find incoming and outgoing connections
    const incoming = edges.filter(e => e.to === selectedNode.node_id);
    const outgoing = edges.filter(e => e.from === selectedNode.node_id);
    
    if (incoming.length > 0) {
      context += `- **Inputs from**: ${incoming.map(e => {
        const node = connectedNodes.find(n => n.node_id === e.from);
        return node?.title || e.from;
      }).join(', ')}\n`;
    }
    
    if (outgoing.length > 0) {
      context += `- **Outputs to**: ${outgoing.map(e => {
        const node = connectedNodes.find(n => n.node_id === e.to);
        return node?.title || e.to;
      }).join(', ')}\n`;
    }
    
    context += '\n';
  }

  if (connectedNodes.length > 0) {
    context += '### Connected Nodes\n';
    for (const node of connectedNodes) {
      if (selectedNode && node.node_id === selectedNode.node_id) continue;
      context += `\n#### ${node.title || 'Untitled'} (${node.type})\n`;
      if (node.content) {
        context += `${truncate(node.content, 200)}\n`;
      }
    }
  }

  return context;
}

/**
 * Build JSON context for structured processing
 */
function buildJsonContext(selectedNode: FlowNode | null, connectedNodes: FlowNode[]): string {
  const contextObj = {
    selectedNode: selectedNode ? {
      id: selectedNode.node_id,
      title: selectedNode.title,
      type: selectedNode.type,
      content: truncate(selectedNode.content || '', 500)
    } : null,
    relatedNodes: connectedNodes
      .filter(n => !selectedNode || n.node_id !== selectedNode.node_id)
      .map(n => ({
        id: n.node_id,
        title: n.title,
        type: n.type,
        contentPreview: truncate(n.content || '', 100)
      }))
  };

  return '## Workflow Context (JSON)\n```json\n' + JSON.stringify(contextObj, null, 2) + '\n```';
}

/**
 * Find nodes connected to a given node up to specified depth
 */
function findConnectedNodes(
  nodeId: string,
  nodes: FlowNode[],
  edges: FlowEdge[],
  depth: number
): FlowNode[] {
  const visited = new Set<string>();
  const result: FlowNode[] = [];
  
  function traverse(currentId: string, currentDepth: number) {
    if (currentDepth > depth || visited.has(currentId)) return;
    visited.add(currentId);
    
    const node = nodes.find(n => n.node_id === currentId);
    if (node) result.push(node);
    
    // Find connected edges (both directions)
    const connected = edges
      .filter(e => e.from === currentId || e.to === currentId)
      .map(e => e.from === currentId ? e.to : e.from);
    
    for (const nextId of connected) {
      traverse(nextId, currentDepth + 1);
    }
  }
  
  traverse(nodeId, 0);
  return result;
}

/**
 * Truncate string to max length with ellipsis
 */
function truncate(str: string, maxLength: number): string {
  if (!str) return '';
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength - 3) + '...';
}

/**
 * Get a summary of the workflow for display
 */
export function getWorkflowSummary(nodes: FlowNode[], edges: FlowEdge[]): string {
  if (nodes.length === 0) return 'Empty workflow';
  
  const nodeTypes = nodes.reduce((acc, n) => {
    acc[n.type] = (acc[n.type] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  
  const typeSummary = Object.entries(nodeTypes)
    .map(([type, count]) => `${count} ${type}`)
    .join(', ');
  
  return `${nodes.length} nodes (${typeSummary}), ${edges.length} connections`;
}
