/**
 * Code Node Type
 * Code block with syntax highlighting for Labs
 * @see ADR-043: Laboratories Feature
 */
import { BaseNode } from './base-node.js';

export const CodeNode = {
  ...BaseNode,
  typeKey: 'code',
  name: 'Code',
  description: 'Code block with syntax highlighting',
  icon: '💻',
  category: 'dev',
  
  defaultConfig: {
    language: 'javascript',
    theme: 'dark',
    showLineNumbers: true,
    editable: true,
    executable: false
  },
  
  defaultWidth: 400,
  defaultHeight: 300,
  
  /**
   * Execute code node - returns the code content
   * @param {Object} node - The node data
   * @param {Object} context - Execution context
   * @returns {Promise<Object>} Execution result
   */
  async execute(node, context) {
    const config = node.config || {};
    const code = node.content || '';
    
    return { 
      success: true, 
      output: code,
      type: 'code',
      metadata: {
        language: config.language || 'javascript',
        theme: config.theme || 'dark',
        showLineNumbers: config.showLineNumbers !== false,
        editable: config.editable !== false,
        executable: config.executable === true,
        lineCount: code.split('\n').length
      }
    };
  },
  
  /**
   * Validate code node configuration
   * @param {Object} config - Node configuration
   * @returns {Object} Validation result
   */
  validate(config) {
    const errors = [];
    
    const supportedLanguages = [
      'javascript', 'typescript', 'python', 'java', 'cpp', 'c', 'csharp',
      'php', 'ruby', 'go', 'rust', 'sql', 'html', 'css', 'json', 'xml',
      'yaml', 'markdown', 'bash', 'shell', 'plaintext'
    ];
    
    if (config.language && !supportedLanguages.includes(config.language)) {
      errors.push(`language must be one of: ${supportedLanguages.join(', ')}`);
    }
    
    if (config.theme && !['light', 'dark', 'auto'].includes(config.theme)) {
      errors.push('theme must be one of: light, dark, auto');
    }
    
    if (config.showLineNumbers !== undefined && typeof config.showLineNumbers !== 'boolean') {
      errors.push('showLineNumbers must be a boolean');
    }
    
    if (config.editable !== undefined && typeof config.editable !== 'boolean') {
      errors.push('editable must be a boolean');
    }
    
    if (config.executable !== undefined && typeof config.executable !== 'boolean') {
      errors.push('executable must be a boolean');
    }
    
    return {
      valid: errors.length === 0,
      errors
    };
  }
};