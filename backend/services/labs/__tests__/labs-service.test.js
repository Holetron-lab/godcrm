/**
 * Tests for Labs Service
 * @see ADR-043: Laboratories Feature
 */
import { describe, it, expect } from 'vitest';
import { LabsService } from '../index.js';

describe('LabsService', () => {
  describe('getNodeTypes', () => {
    it('should return all node types', () => {
      const types = LabsService.getNodeTypes();
      expect(types).toHaveLength(8);
      
      const typeKeys = types.map(t => t.typeKey);
      expect(typeKeys).toContain('text');
      expect(typeKeys).toContain('ai_agent');
      expect(typeKeys).toContain('image');
      expect(typeKeys).toContain('file');
      expect(typeKeys).toContain('input');
      expect(typeKeys).toContain('output');
      expect(typeKeys).toContain('code');
      expect(typeKeys).toContain('note');
    });
  });

  describe('getNodeType', () => {
    it('should return specific node type', () => {
      const textNode = LabsService.getNodeType('text');
      expect(textNode).toBeDefined();
      expect(textNode.typeKey).toBe('text');
      expect(textNode.name).toBe('Text');
    });

    it('should return null for unknown type', () => {
      const unknownNode = LabsService.getNodeType('unknown');
      expect(unknownNode).toBeNull();
    });
  });

  describe('validateNodeConfig', () => {
    it('should validate text node config', () => {
      const result = LabsService.validateNodeConfig('text', {
        fontSize: 16,
        fontWeight: 'bold'
      });
      
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject invalid config', () => {
      const result = LabsService.validateNodeConfig('text', {
        fontSize: 100 // Too large
      });
      
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('fontSize must be a number between 8 and 72');
    });
  });

  describe('createNodeWithDefaults', () => {
    it('should create text node with defaults', () => {
      const nodeData = LabsService.createNodeWithDefaults('text', {
        title: 'My Text Node',
        content: 'Hello world'
      });
      
      expect(nodeData.type_key).toBe('text');
      expect(nodeData.title).toBe('My Text Node');
      expect(nodeData.content).toBe('Hello world');
      expect(nodeData.width).toBe(250); // Default from TextNode
      expect(nodeData.height).toBe(150); // Default from TextNode
      expect(nodeData.node_id).toBeDefined();
      expect(nodeData.config).toEqual({
        content: '',
        fontSize: 14,
        fontWeight: 'normal',
        textAlign: 'left'
      });
    });

    it('should merge custom config with defaults', () => {
      const nodeData = LabsService.createNodeWithDefaults('text', {
        title: 'Custom Node',
        config: {
          fontSize: 18,
          customField: 'value'
        }
      });
      
      expect(nodeData.config.fontSize).toBe(18); // Custom value
      expect(nodeData.config.fontWeight).toBe('normal'); // Default value
      expect(nodeData.config.customField).toBe('value'); // Custom field preserved
    });

    it('should throw error for unknown node type', () => {
      expect(() => {
        LabsService.createNodeWithDefaults('unknown_type', {});
      }).toThrow('Unknown node type: unknown_type');
    });
  });

  describe('validateNode', () => {
    it('should validate complete node data', () => {
      const nodeData = {
        type_key: 'text',
        title: 'Valid Node',
        content: 'Content',
        position_x: 100,
        position_y: 200,
        width: 300,
        height: 150,
        config: {
          fontSize: 16
        }
      };
      
      const result = LabsService.validateNode(nodeData);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject node without type_key', () => {
      const nodeData = {
        title: 'Invalid Node'
      };
      
      const result = LabsService.validateNode(nodeData);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('type_key is required');
    });

    it('should reject node with invalid dimensions', () => {
      const nodeData = {
        type_key: 'text',
        title: 'Invalid Node',
        width: -100,
        height: 0
      };
      
      const result = LabsService.validateNode(nodeData);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('width must be a positive number');
      expect(result.errors).toContain('height must be a positive number');
    });
  });

  describe('executeNode', () => {
    it('should execute text node', async () => {
      const node = {
        type_key: 'text',
        content: 'Test content',
        config: {}
      };
      
      const result = await LabsService.executeNode(node);
      expect(result.success).toBe(true);
      expect(result.output).toBe('Test content');
      expect(result.type).toBe('text');
    });

    it('should execute AI agent node (returns error in test environment)', async () => {
      const node = {
        type_key: 'ai_agent',
        config: {
          ai_agent_id: 123
        }
      };
      
      const result = await LabsService.executeNode(node);
      // In test environment, either agent doesn't exist or DB query fails
      expect(result.success).toBe(false);
      expect(result.type).toBe('ai_agent');
      // Error can be "AI agent 123 not found" or "AI agent execution failed"
      expect(result.error).toMatch(/AI agent/);
    });

    it('should handle execution errors gracefully', async () => {
      const node = {
        type_key: 'unknown_type'
      };
      
      const result = await LabsService.executeNode(node);
      expect(result.success).toBe(false);
      expect(result.error).toBe('Unknown node type: unknown_type');
    });
  });
});