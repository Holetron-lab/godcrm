/**
 * Output Node Type
 * Data output point for Labs
 * @see ADR-043: Laboratories Feature
 */
import { BaseNode } from './base-node.js';

export const OutputNode = {
  ...BaseNode,
  typeKey: 'output',
  name: 'Output',
  description: 'Data output point',
  icon: '📤',
  category: 'io',
  
  defaultConfig: {
    outputType: 'text', // text, json, file, image
    format: 'raw', // raw, formatted, pretty
    exportable: true
  },
  
  defaultWidth: 200,
  defaultHeight: 100,
  
  // Output nodes typically have inputs but no outputs
  canHaveInputs: true,
  canHaveOutputs: false,
  maxInputs: -1,
  maxOutputs: 0,
  
  /**
   * Execute output node - processes and formats the output
   * @param {Object} node - The node data
   * @param {Object} context - Execution context
   * @returns {Promise<Object>} Execution result
   */
  async execute(node, context) {
    const config = node.config || {};
    const content = node.content || '';
    
    let formattedOutput = content;
    
    // Apply formatting based on config
    if (config.format === 'pretty' && config.outputType === 'json') {
      try {
        const parsed = JSON.parse(content);
        formattedOutput = JSON.stringify(parsed, null, 2);
      } catch (e) {
        // If not valid JSON, keep original
        formattedOutput = content;
      }
    }
    
    return { 
      success: true, 
      output: formattedOutput,
      type: 'output',
      outputType: config.outputType || 'text',
      metadata: {
        format: config.format || 'raw',
        exportable: config.exportable !== false,
        outputType: config.outputType || 'text'
      }
    };
  },
  
  /**
   * Validate output node configuration
   * @param {Object} config - Node configuration
   * @returns {Object} Validation result
   */
  validate(config) {
    const errors = [];
    
    if (config.outputType && !['text', 'json', 'file', 'image'].includes(config.outputType)) {
      errors.push('outputType must be one of: text, json, file, image');
    }
    
    if (config.format && !['raw', 'formatted', 'pretty'].includes(config.format)) {
      errors.push('format must be one of: raw, formatted, pretty');
    }
    
    if (config.exportable !== undefined && typeof config.exportable !== 'boolean') {
      errors.push('exportable must be a boolean');
    }
    
    return {
      valid: errors.length === 0,
      errors
    };
  }
};