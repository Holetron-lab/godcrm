/**
 * Text Node Type
 * Simple text content block for Labs
 * @see ADR-043: Laboratories Feature
 */
import { BaseNode } from './base-node.js';

export const TextNode = {
  ...BaseNode,
  typeKey: 'text',
  name: 'Text',
  description: 'Simple text content block',
  icon: '📝',
  category: 'basic',
  
  defaultConfig: {
    content: '',
    fontSize: 14,
    fontWeight: 'normal',
    textAlign: 'left'
  },
  
  defaultWidth: 250,
  defaultHeight: 150,
  
  /**
   * Execute text node - returns the text content
   * @param {Object} node - The node data
   * @param {Object} context - Execution context
   * @returns {Promise<Object>} Execution result
   */
  async execute(node, context) {
    // Priority: node.content > node.config.content > empty string
    const content = node.content || node.config?.content || '';
    
    return { 
      success: true, 
      output: content,
      type: 'text'
    };
  },
  
  /**
   * Validate text node configuration
   * @param {Object} config - Node configuration
   * @returns {Object} Validation result
   */
  validate(config) {
    const errors = [];
    
    if (config.fontSize && (typeof config.fontSize !== 'number' || config.fontSize < 8 || config.fontSize > 72)) {
      errors.push('fontSize must be a number between 8 and 72');
    }
    
    if (config.fontWeight && !['normal', 'bold', 'lighter', 'bolder'].includes(config.fontWeight)) {
      errors.push('fontWeight must be one of: normal, bold, lighter, bolder');
    }
    
    if (config.textAlign && !['left', 'center', 'right', 'justify'].includes(config.textAlign)) {
      errors.push('textAlign must be one of: left, center, right, justify');
    }
    
    return {
      valid: errors.length === 0,
      errors
    };
  }
};