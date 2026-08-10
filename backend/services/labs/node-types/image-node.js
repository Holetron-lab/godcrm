/**
 * Image Node Type
 * Image display node for Labs
 * @see ADR-043: Laboratories Feature
 */
import { BaseNode } from './base-node.js';

export const ImageNode = {
  ...BaseNode,
  typeKey: 'image',
  name: 'Image',
  description: 'Image display node',
  icon: '🖼️',
  category: 'media',
  
  defaultConfig: {
    src: '',
    alt: '',
    width: 'auto',
    height: 'auto',
    fit: 'contain' // contain, cover, fill, scale-down
  },
  
  defaultWidth: 300,
  defaultHeight: 200,
  
  /**
   * Execute image node - returns image metadata
   * @param {Object} node - The node data
   * @param {Object} context - Execution context
   * @returns {Promise<Object>} Execution result
   */
  async execute(node, context) {
    const config = node.config || {};
    const src = config.src || node.content || '';
    
    if (!src) {
      return {
        success: false,
        error: 'No image source provided',
        type: 'image'
      };
    }
    
    return { 
      success: true, 
      output: src,
      type: 'image',
      metadata: {
        src,
        alt: config.alt || '',
        dimensions: {
          width: config.width || 'auto',
          height: config.height || 'auto'
        },
        fit: config.fit || 'contain'
      }
    };
  },
  
  /**
   * Validate image node configuration
   * @param {Object} config - Node configuration
   * @returns {Object} Validation result
   */
  validate(config) {
    const errors = [];
    
    if (config.fit && !['contain', 'cover', 'fill', 'scale-down'].includes(config.fit)) {
      errors.push('fit must be one of: contain, cover, fill, scale-down');
    }
    
    return {
      valid: errors.length === 0,
      errors
    };
  }
};