/**
 * Labs API Client
 * Connects to GOD CRM Labs backend API
 * @see ADR-043: Laboratories Feature
 */
import { apiClient } from '@/shared/utils/apiClient';
import { logger } from '@/shared/utils/logger';

// Types
export interface LabProject {
  id: number;
  lab_id: string;
  title: string;
  description?: string;
  space_id?: number;
  settings?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface LabNode {
  id: number;
  node_id: string;
  lab_id: string;
  type: string;
  title: string;
  content?: string;
  meta?: Record<string, unknown>;
  ai_config?: Record<string, unknown>;
  ui_config?: {
    position_x?: number;
    position_y?: number;
    width?: number;
    height?: number;
    color?: string;
  };
  created_at: string;
  updated_at: string;
}

export interface LabEdge {
  id: number;
  edge_id: string;
  lab_id: string;
  source_node_id: string;
  target_node_id: string;
  source_handle?: string;
  target_handle?: string;
  created_at: string;
}

export interface NodeType {
  typeKey: string;
  name: string;
  description: string;
  icon: string;
  category: string;
  defaultConfig: Record<string, unknown>;
  defaultWidth: number;
  defaultHeight: number;
  canHaveInputs: boolean;
  canHaveOutputs: boolean;
  maxInputs: number;
  maxOutputs: number;
}

export interface AIAgent {
  id: number;
  name: string;
  description?: string;
  system_prompt?: string;
  operator_id?: number;
  operator_name?: string;
}

export interface AIProvider {
  id: number;
  name: string;
  description?: string;
  integration_key?: string;
  default_model?: string;
}

export interface NodeExecutionResult {
  success: boolean;
  output?: string;
  outputs?: Record<string, string>;
  selectedRoute?: string;
  detectedType?: string;
  tokensUsed?: number;
  executionTime?: number;
  cost?: number;
  model?: string;
  provider?: string;
  error?: string;
  details?: string;
}

export interface RunResponse {
  status: string;
  nodeId: string;
  content?: string | null;
  contentType?: string | null;
  logs: string[];
  runId: string;
  cloned?: boolean;
  targetNodeId?: string;
  createdNodes?: Array<{ node_id: string; type: string; title: string }>;
  tokensUsed?: number;
  executionTime?: number;
  provider?: string | null;
  model?: string | null;
}

export interface TextSplitResult {
  createdNodes: Array<{ node_id: string; type: string; title: string }>;
  logs: string[];
}

export interface RerunOptions {
  clone?: boolean;
  includeSubnodes?: boolean;
}

export interface SplitOptions {
  separator?: string;
  subSeparator?: string;
}

// API Functions

/**
 * Initialize a lab for a widget
 */
export async function initLab(spaceId: number, widgetId?: number, title?: string): Promise<{ lab_id: string; id: number; already_exists?: boolean }> {
  try {
    const response = await apiClient.post<{ data: { lab_id: string; id: number; already_exists?: boolean } }>('/labs/init', {
      space_id: spaceId,
      widget_id: widgetId,
      title
    });
    return response.data;
  } catch (error) {
    logger.error('Failed to initialize lab', error);
    throw error;
  }
}

/**
 * Get lab with nodes and edges
 */
export async function getLab(labId: string): Promise<LabProject & { nodes: LabNode[]; edges: LabEdge[] }> {
  try {
    const response = await apiClient.get<{ data: LabProject & { nodes: LabNode[]; edges: LabEdge[] } }>(`/labs/${labId}`);
    return response.data;
  } catch (error) {
    logger.error('Failed to get lab', error);
    throw error;
  }
}

/**
 * Update lab
 */
export async function updateLab(labId: string, updates: Partial<LabProject>): Promise<LabProject> {
  try {
    const response = await apiClient.put<{ data: LabProject }>(`/labs/${labId}`, updates);
    return response.data;
  } catch (error) {
    logger.error('Failed to update lab', error);
    throw error;
  }
}

/**
 * Create node in lab
 */
export async function createNode(labId: string, nodeData: {
  type: string;
  title: string;
  content?: string;
  meta?: Record<string, unknown>;
  ai_config?: Record<string, unknown>;
  ui_config?: Record<string, unknown>;
}): Promise<LabNode> {
  try {
    const response = await apiClient.post<{ data: LabNode }>(`/labs/${labId}/nodes`, nodeData);
    return response.data;
  } catch (error) {
    logger.error('Failed to create node', error);
    throw error;
  }
}

/**
 * Update node
 */
export async function updateNode(nodeId: string, updates: Partial<LabNode>): Promise<LabNode> {
  try {
    const response = await apiClient.put<{ data: LabNode }>(`/labs/nodes/${nodeId}`, updates);
    return response.data;
  } catch (error) {
    logger.error('Failed to update node', error);
    throw error;
  }
}

/**
 * Delete node
 */
export async function deleteNode(nodeId: string): Promise<void> {
  try {
    await apiClient.delete(`/labs/nodes/${nodeId}`);
  } catch (error) {
    logger.error('Failed to delete node', error);
    throw error;
  }
}

/**
 * Create edge between nodes
 */
export async function createEdge(labId: string, edgeData: {
  source_node_id: string;
  target_node_id: string;
  source_handle?: string;
  target_handle?: string;
}): Promise<LabEdge> {
  try {
    const response = await apiClient.post<{ data: LabEdge }>(`/labs/${labId}/edges`, edgeData);
    return response.data;
  } catch (error) {
    logger.error('Failed to create edge', error);
    throw error;
  }
}

/**
 * Delete edge
 */
export async function deleteEdge(edgeId: string): Promise<void> {
  try {
    await apiClient.delete(`/labs/edges/${edgeId}`);
  } catch (error) {
    logger.error('Failed to delete edge', error);
    throw error;
  }
}

/**
 * Get available node types
 */
export async function getNodeTypes(): Promise<NodeType[]> {
  try {
    const response = await apiClient.get<{ data: NodeType[] }>('/labs/node-types');
    return response.data;
  } catch (error) {
    logger.error('Failed to get node types', error);
    throw error;
  }
}

/**
 * Get AI agents
 */
export async function getAIAgents(): Promise<AIAgent[]> {
  try {
    const response = await apiClient.get<{ data: AIAgent[] }>('/labs/ai/agents');
    return response.data;
  } catch (error) {
    logger.error('Failed to get AI agents', error);
    throw error;
  }
}

/**
 * Get AI providers
 */
export async function getAIProviders(): Promise<AIProvider[]> {
  try {
    const response = await apiClient.get<{ data: AIProvider[] }>('/labs/ai/providers');
    return response.data;
  } catch (error) {
    logger.error('Failed to get AI providers', error);
    throw error;
  }
}

/**
 * Execute a node (run AI agent, etc.)
 */
export async function executeNode(labTableId: string, nodeId: string, context?: {
  input?: string;
  routing_config?: Record<string, unknown>;
  output_format?: string;
}): Promise<NodeExecutionResult> {
  try {
    const response = await apiClient.post<{ data: NodeExecutionResult }>(
      `/labs/${labTableId}/nodes/${nodeId}/execute`,
      context || {}
    );
    return response.data;
  } catch (error) {
    logger.error('Failed to execute node', error);
    throw error;
  }
}

/**
 * Sync AI templates from MindWorkflow
 */
export async function syncAITemplates(): Promise<{ synced: number; total: number }> {
  try {
    const response = await apiClient.post<{ data: { synced: number; total: number } }>('/labs/ai/templates/sync');
    return response.data;
  } catch (error) {
    logger.error('Failed to sync AI templates', error);
    throw error;
  }
}

/**
 * Run a node (execute AI, process data, etc.)
 */
export async function runNode(
  labTableId: string, 
  nodeId: string, 
  overrideInputs?: Record<string, unknown>
): Promise<RunResponse> {
  try {
    const response = await apiClient.post<{ data: RunResponse }>(
      `/labs/${labTableId}/nodes/${nodeId}/run`,
      overrideInputs || {}
    );
    return response.data;
  } catch (error) {
    logger.error('Failed to run node', error);
    throw error;
  }
}

/**
 * Rerun a node with options
 */
export async function rerunNode(
  labTableId: string,
  nodeId: string,
  options?: RerunOptions
): Promise<RunResponse> {
  try {
    const response = await apiClient.post<{ data: RunResponse }>(
      `/labs/${labTableId}/nodes/${nodeId}/rerun`,
      options || {}
    );
    return response.data;
  } catch (error) {
    logger.error('Failed to rerun node', error);
    throw error;
  }
}

/**
 * Split a text node into multiple nodes
 */
export async function splitNode(
  labTableId: string,
  nodeId: string,
  options?: SplitOptions
): Promise<TextSplitResult> {
  try {
    const response = await apiClient.post<{ data: TextSplitResult }>(
      `/labs/${labTableId}/nodes/${nodeId}/split`,
      options || {}
    );
    return response.data;
  } catch (error) {
    logger.error('Failed to split node', error);
    throw error;
  }
}

// Export all functions as labsApi object
export const labsApi = {
  initLab,
  getLab,
  updateLab,
  createNode,
  updateNode,
  deleteNode,
  createEdge,
  deleteEdge,
  getNodeTypes,
  getAIAgents,
  getAIProviders,
  executeNode,
  syncAITemplates,
  runNode,
  rerunNode,
  splitNode
};

export default labsApi;
