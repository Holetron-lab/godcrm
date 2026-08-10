/**
 * Labs Node Types Registry
 * Central registry for all node types in Labs v4
 * @see ADR-043: Laboratories Feature
 */
import { TextNode } from './text-node.js';
import { AIAgentNode } from './ai-agent-node.js';
import { ImageNode } from './image-node.js';
import { FileNode } from './file-node.js';
import { InputNode } from './input-node.js';
import { OutputNode } from './output-node.js';
import { CodeNode } from './code-node.js';
import { NoteNode } from './note-node.js';

/**
 * All node types as a map
 * Key: type_key, Value: node type definition
 */
export const NODE_TYPES = {
  text: TextNode,
  ai_agent: AIAgentNode,
  image: ImageNode,
  file: FileNode,
  input: InputNode,
  output: OutputNode,
  code: CodeNode,
  note: NoteNode
};

/**
 * Get node type by key
 * @param {string} typeKey - The node type key
 * @returns {Object|null} Node type definition or null if not found
 */
export function getNodeType(typeKey) {
  return NODE_TYPES[typeKey] || null;
}

/**
 * Get all node types as array (for API response)
 * @returns {Array} Array of node type definitions for API
 */
export function getAllNodeTypes() {
  return Object.values(NODE_TYPES).map(type => ({
    typeKey: type.typeKey,
    name: type.name,
    description: type.description,
    icon: type.icon,
    category: type.category,
    defaultConfig: type.defaultConfig,
    defaultWidth: type.defaultWidth,
    defaultHeight: type.defaultHeight,
    canHaveInputs: type.canHaveInputs,
    canHaveOutputs: type.canHaveOutputs,
    maxInputs: type.maxInputs,
    maxOutputs: type.maxOutputs
  }));
}

/**
 * Validate node config
 * @param {string} typeKey - The node type key
 * @param {Object} config - Configuration to validate
 * @returns {Object} Validation result with valid boolean and errors array
 */
export function validateNodeConfig(typeKey, config) {
  const nodeType = getNodeType(typeKey);
  if (!nodeType) {
    return { valid: false, errors: [`Unknown node type: ${typeKey}`] };
  }
  return nodeType.validate(config);
}

/**
 * Execute node
 * @param {Object} node - The node to execute
 * @param {Object} context - Execution context
 * @returns {Promise<Object>} Execution result
 */
export async function executeNode(node, context) {
  const nodeType = getNodeType(node.type_key);
  if (!nodeType) {
    return { success: false, error: `Unknown node type: ${node.type_key}` };
  }
  return nodeType.execute(node, context);
}

/**
 * Get node types by category
 * @param {string} category - Category to filter by
 * @returns {Array} Array of node types in the category
 */
export function getNodeTypesByCategory(category) {
  return getAllNodeTypes().filter(type => type.category === category);
}

/**
 * Get all available categories
 * @returns {Array} Array of unique categories
 */
export function getCategories() {
  const categories = getAllNodeTypes().map(type => type.category);
  return [...new Set(categories)].sort();
}

// Export individual node types for direct import
export { 
  TextNode, 
  AIAgentNode, 
  ImageNode, 
  FileNode, 
  InputNode, 
  OutputNode, 
  CodeNode, 
  NoteNode 
};