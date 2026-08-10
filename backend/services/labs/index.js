/**
 * Labs Service - Main service for Labs v4
 * @see ADR-043: Laboratories Feature
 */
import { getAllNodeTypes, getNodeType, validateNodeConfig, executeNode } from './node-types/index.js';
import { apiLogger } from '../../utils/logger.js';
import crypto from 'crypto';

/**
 * Labs Service Class
 */
export class LabsService {
  /**
   * Get all available node types
   * @returns {Array} Array of node type definitions
   */
  static getNodeTypes() {
    return getAllNodeTypes();
  }
  
  /**
   * Get specific node type by key
   * @param {string} typeKey - Node type key
   * @returns {Object|null} Node type definition or null
   */
  static getNodeType(typeKey) {
    return getNodeType(typeKey);
  }
  
  /**
   * Validate node configuration
   * @param {string} typeKey - Node type key
   * @param {Object} config - Configuration to validate
   * @returns {Object} Validation result
   */
  static validateNodeConfig(typeKey, config) {
    return validateNodeConfig(typeKey, config);
  }
  
  /**
   * Execute a node
   * @param {Object} node - Node to execute
   * @param {Object} context - Execution context
   * @returns {Promise<Object>} Execution result
   */
  static async executeNode(node, context = {}) {
    try {
      return await executeNode(node, context);
    } catch (error) {
      apiLogger.error({ error, node }, 'Node execution failed');
      return {
        success: false,
        error: 'Node execution failed',
        details: error.message
      };
    }
  }
  
  /**
   * Create node data with defaults from node type
   * @param {string} typeKey - Node type key
   * @param {Object} nodeData - Partial node data
   * @returns {Object} Complete node data with defaults applied
   */
  static createNodeWithDefaults(typeKey, nodeData = {}) {
    const nodeType = getNodeType(typeKey);
    if (!nodeType) {
      throw new Error(`Unknown node type: ${typeKey}`);
    }
    
    // Handle position from both formats: {position: {x, y}} and {position_x, position_y}
    const posX = nodeData.position?.x ?? nodeData.position_x ?? 0;
    const posY = nodeData.position?.y ?? nodeData.position_y ?? 0;
    
    return {
      node_id: nodeData.node_id || crypto.randomUUID(),
      type_key: typeKey,
      title: nodeData.title || nodeType.name,
      content: nodeData.content || '',
      position_x: posX,
      position_y: posY,
      position: { x: posX, y: posY }, // Also include nested format for compatibility
      width: nodeData.width || nodeType.defaultWidth,
      height: nodeData.height || nodeType.defaultHeight,
      edges: nodeData.edges || [],
      ai_agent_id: nodeData.ai_agent_id || null,
      config: { ...nodeType.defaultConfig, ...(nodeData.config || {}) },
      order_index: nodeData.order_index || 0
    };
  }
  
  /**
   * Validate complete node data
   * @param {Object} nodeData - Node data to validate
   * @returns {Object} Validation result
   */
  static validateNode(nodeData) {
    const errors = [];
    
    if (!nodeData.type_key) {
      errors.push('type_key is required');
    } else {
      const nodeType = getNodeType(nodeData.type_key);
      if (!nodeType) {
        errors.push(`Unknown node type: ${nodeData.type_key}`);
      } else {
        // Validate config
        const configValidation = validateNodeConfig(nodeData.type_key, nodeData.config || {});
        if (!configValidation.valid) {
          errors.push(...configValidation.errors);
        }
      }
    }
    
    if (!nodeData.title || typeof nodeData.title !== 'string') {
      errors.push('title is required and must be a string');
    }
    
    if (nodeData.position_x !== undefined && typeof nodeData.position_x !== 'number') {
      errors.push('position_x must be a number');
    }
    
    if (nodeData.position_y !== undefined && typeof nodeData.position_y !== 'number') {
      errors.push('position_y must be a number');
    }
    
    if (nodeData.width !== undefined && (typeof nodeData.width !== 'number' || nodeData.width <= 0)) {
      errors.push('width must be a positive number');
    }
    
    if (nodeData.height !== undefined && (typeof nodeData.height !== 'number' || nodeData.height <= 0)) {
      errors.push('height must be a positive number');
    }
    
    return {
      valid: errors.length === 0,
      errors
    };
  }
}

// Export convenience functions
export { getAllNodeTypes, getNodeType, validateNodeConfig, executeNode };