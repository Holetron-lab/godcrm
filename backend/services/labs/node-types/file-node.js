/**
 * File Node Type
 * File attachment node for Labs
 * @see ADR-043: Laboratories Feature
 */
import { BaseNode } from './base-node.js';

export const FileNode = {
  ...BaseNode,
  typeKey: 'file',
  name: 'File',
  description: 'File attachment node',
  icon: '📁',
  category: 'media',
  
  defaultConfig: {
    filename: '',
    fileType: '',
    fileSize: 0,
    downloadUrl: '',
    previewUrl: ''
  },
  
  defaultWidth: 250,
  defaultHeight: 120,
  
  /**
   * Execute file node - returns file metadata
   * @param {Object} node - The node data
   * @param {Object} context - Execution context
   * @returns {Promise<Object>} Execution result
   */
  async execute(node, context) {
    const config = node.config || {};
    const filename = config.filename || node.content || '';
    
    if (!filename) {
      return {
        success: false,
        error: 'No file specified',
        type: 'file'
      };
    }
    
    return { 
      success: true, 
      output: filename,
      type: 'file',
      metadata: {
        filename,
        fileType: config.fileType || '',
        fileSize: config.fileSize || 0,
        downloadUrl: config.downloadUrl || '',
        previewUrl: config.previewUrl || ''
      }
    };
  },
  
  /**
   * Validate file node configuration
   * @param {Object} config - Node configuration
   * @returns {Object} Validation result
   */
  validate(config) {
    const errors = [];
    
    if (config.fileSize !== undefined) {
      if (typeof config.fileSize !== 'number' || config.fileSize < 0) {
        errors.push('fileSize must be a non-negative number');
      }
    }
    
    return {
      valid: errors.length === 0,
      errors
    };
  }
};