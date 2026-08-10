/**
 * Base Node Type Definition
 * All node types extend this base structure
 * @see ADR-043: Laboratories Feature
 */

/**
 * Base Node Type - Foundation for all node types
 */
export const BaseNode = {
  // Node type key (must be unique)
  typeKey: 'base',
  
  // Display information
  name: 'Base Node',
  description: 'Base node type',
  icon: '📦',
  category: 'basic', // basic, ai, media, io, dev
  
  // Default configuration for new nodes
  defaultConfig: {},
  
  // Default size
  defaultWidth: 200,
  defaultHeight: 100,
  
  // Validation schema (Zod-like structure)
  configSchema: {
    // Define expected config fields
  },
  
  // Can this node have edges?
  canHaveInputs: true,
  canHaveOutputs: true,
  maxInputs: -1,  // -1 = unlimited
  maxOutputs: -1,
  
  /**
   * Execution handler (for AI nodes, etc.)
   * @param {Object} node - The node data
   * @param {Object} context - Execution context
   * @returns {Promise<Object>} Execution result
   */
  async execute(node, context) {
    // Override in specific node types
    return { success: true, output: node.content || '' };
  },
  
  /**
   * Validation
   * @param {Object} config - Node configuration to validate
   * @returns {Object} Validation result
   */
  validate(config) {
    return { valid: true, errors: [] };
  }
};