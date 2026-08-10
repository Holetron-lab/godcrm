/**
 * Input Node Type
 * Data input point for Labs
 * @see ADR-043: Laboratories Feature
 */
import { BaseNode } from './base-node.js';

export const InputNode = {
  ...BaseNode,
  typeKey: 'input',
  name: 'Input',
  description: 'Data input point',
  icon: '📥',
  category: 'io',
  
  defaultConfig: {
    inputType: 'text', // text, number, file, json
    placeholder: '',
    required: false,
    defaultValue: ''
  },
  
  defaultWidth: 200,
  defaultHeight: 100,
  
  // Input nodes typically don't have inputs, only outputs
  canHaveInputs: false,
  canHaveOutputs: true,
  maxInputs: 0,
  maxOutputs: -1,
  
  /**
   * Execute input node - returns the input value
   * @param {Object} node - The node data
   * @param {Object} context - Execution context
   * @returns {Promise<Object>} Execution result
   */
  async execute(node, context) {
    const config = node.config || {};
    const value = node.content || config.defaultValue || '';
    
    return { 
      success: true, 
      output: value,
      type: 'input',
      inputType: config.inputType || 'text',
      metadata: {
        placeholder: config.placeholder || '',
        required: config.required || false,
        inputType: config.inputType || 'text'
      }
    };
  },
  
  /**
   * Validate input node configuration
   * @param {Object} config - Node configuration
   * @returns {Object} Validation result
   */
  validate(config) {
    const errors = [];
    
    if (config.inputType && !['text', 'number', 'file', 'json'].includes(config.inputType)) {
      errors.push('inputType must be one of: text, number, file, json');
    }
    
    if (config.required !== undefined && typeof config.required !== 'boolean') {
      errors.push('required must be a boolean');
    }
    
    return {
      valid: errors.length === 0,
      errors
    };
  }
};