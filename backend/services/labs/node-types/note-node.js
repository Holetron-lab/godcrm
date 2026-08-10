/**
 * Note Node Type
 * Sticky note for comments in Labs
 * @see ADR-043: Laboratories Feature
 */
import { BaseNode } from './base-node.js';

export const NoteNode = {
  ...BaseNode,
  typeKey: 'note',
  name: 'Note',
  description: 'Sticky note for comments',
  icon: '📌',
  category: 'basic',
  
  defaultConfig: {
    color: 'yellow', // yellow, blue, green, pink, orange
    fontSize: 12,
    sticky: true,
    priority: 'normal' // low, normal, high
  },
  
  defaultWidth: 200,
  defaultHeight: 150,
  
  // Notes typically don't connect to other nodes
  canHaveInputs: false,
  canHaveOutputs: false,
  maxInputs: 0,
  maxOutputs: 0,
  
  /**
   * Execute note node - returns the note content
   * @param {Object} node - The node data
   * @param {Object} context - Execution context
   * @returns {Promise<Object>} Execution result
   */
  async execute(node, context) {
    const config = node.config || {};
    const content = node.content || '';
    
    return { 
      success: true, 
      output: content,
      type: 'note',
      metadata: {
        color: config.color || 'yellow',
        fontSize: config.fontSize || 12,
        sticky: config.sticky !== false,
        priority: config.priority || 'normal',
        wordCount: content.split(/\s+/).filter(word => word.length > 0).length
      }
    };
  },
  
  /**
   * Validate note node configuration
   * @param {Object} config - Node configuration
   * @returns {Object} Validation result
   */
  validate(config) {
    const errors = [];
    
    if (config.color && !['yellow', 'blue', 'green', 'pink', 'orange'].includes(config.color)) {
      errors.push('color must be one of: yellow, blue, green, pink, orange');
    }
    
    if (config.fontSize !== undefined) {
      if (typeof config.fontSize !== 'number' || config.fontSize < 8 || config.fontSize > 24) {
        errors.push('fontSize must be a number between 8 and 24');
      }
    }
    
    if (config.priority && !['low', 'normal', 'high'].includes(config.priority)) {
      errors.push('priority must be one of: low, normal, high');
    }
    
    if (config.sticky !== undefined && typeof config.sticky !== 'boolean') {
      errors.push('sticky must be a boolean');
    }
    
    return {
      valid: errors.length === 0,
      errors
    };
  }
};