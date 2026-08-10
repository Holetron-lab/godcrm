/**
 * Tests for Labs Node Types System
 * @see ADR-043: Laboratories Feature
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { NODE_TYPES, getNodeType, getAllNodeTypes, validateNodeConfig, executeNode } from '../node-types/index.js';

describe('Labs Node Types', () => {
  describe('Node Types Registry', () => {
    it('should have all required node types', () => {
      expect(NODE_TYPES.text).toBeDefined();
      expect(NODE_TYPES.ai_agent).toBeDefined();
      expect(NODE_TYPES.image).toBeDefined();
      expect(NODE_TYPES.file).toBeDefined();
      expect(NODE_TYPES.input).toBeDefined();
      expect(NODE_TYPES.output).toBeDefined();
      expect(NODE_TYPES.code).toBeDefined();
      expect(NODE_TYPES.note).toBeDefined();
    });

    it('should have exactly 8 node types', () => {
      expect(Object.keys(NODE_TYPES)).toHaveLength(8);
    });

    it('should have unique type keys', () => {
      const typeKeys = Object.keys(NODE_TYPES);
      const uniqueKeys = new Set(typeKeys);
      expect(uniqueKeys.size).toBe(typeKeys.length);
    });
  });

  describe('getNodeType', () => {
    it('should get node type by key', () => {
      const textNode = getNodeType('text');
      expect(textNode).toBeDefined();
      expect(textNode.typeKey).toBe('text');
      expect(textNode.name).toBe('Text');
      expect(textNode.icon).toBe('📝');
      expect(textNode.category).toBe('basic');
    });

    it('should return null for unknown type', () => {
      const unknownNode = getNodeType('unknown_type');
      expect(unknownNode).toBeNull();
    });

    it('should get AI agent node type', () => {
      const aiNode = getNodeType('ai_agent');
      expect(aiNode).toBeDefined();
      expect(aiNode.typeKey).toBe('ai_agent');
      expect(aiNode.name).toBe('AI Agent');
      expect(aiNode.icon).toBe('🤖');
      expect(aiNode.category).toBe('ai');
    });
  });

  describe('getAllNodeTypes', () => {
    it('should return all node types for API', () => {
      const types = getAllNodeTypes();
      expect(types).toHaveLength(8);
      
      // Check structure of returned types
      types.forEach(type => {
        expect(type).toHaveProperty('typeKey');
        expect(type).toHaveProperty('name');
        expect(type).toHaveProperty('description');
        expect(type).toHaveProperty('icon');
        expect(type).toHaveProperty('category');
        expect(type).toHaveProperty('defaultConfig');
        expect(type).toHaveProperty('defaultWidth');
        expect(type).toHaveProperty('defaultHeight');
      });
    });

    it('should include all expected categories', () => {
      const types = getAllNodeTypes();
      const categories = types.map(t => t.category);
      
      expect(categories).toContain('basic');
      expect(categories).toContain('ai');
      expect(categories).toContain('media');
      expect(categories).toContain('io');
      expect(categories).toContain('dev');
    });
  });

  describe('Node Type Validation', () => {
    it('should validate text node config', () => {
      const result = validateNodeConfig('text', {
        content: 'Hello world',
        fontSize: 16
      });
      
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should validate AI agent node config', () => {
      const result = validateNodeConfig('ai_agent', {
        ai_agent_id: 123,
        prompt_template: 'Test prompt',
        temperature: 0.7
      });
      
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should return error for unknown node type', () => {
      const result = validateNodeConfig('unknown_type', {});
      
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Unknown node type: unknown_type');
    });
  });

  describe('Node Execution', () => {
    it('should execute text node', async () => {
      const node = {
        type_key: 'text',
        content: 'Hello world',
        config: { content: 'Config content' }
      };
      
      const result = await executeNode(node, {});
      
      expect(result.success).toBe(true);
      expect(result.output).toBe('Hello world');
    });

    it('should execute text node with config fallback', async () => {
      const node = {
        type_key: 'text',
        content: '',
        config: { content: 'Config content' }
      };
      
      const result = await executeNode(node, {});
      
      expect(result.success).toBe(true);
      expect(result.output).toBe('Config content');
    });

    it('should execute AI agent node (returns error in test environment)', async () => {
      const node = {
        type_key: 'ai_agent',
        config: { ai_agent_id: 123 }
      };
      
      const result = await executeNode(node, {});
      
      // In test environment, either agent doesn't exist or DB query fails
      // Real execution with valid agent would return success: true
      expect(result.success).toBe(false);
      expect(result.type).toBe('ai_agent');
      // Error can be "AI agent 123 not found" or "AI agent execution failed"
      expect(result.error).toMatch(/AI agent/);
    });

    it('should fail AI agent node without agent ID and no API key', async () => {
      const node = {
        type_key: 'ai_agent',
        config: {}
      };
      
      const result = await executeNode(node, {});
      
      // Without an agent ID, it tries simple AI execution which requires an API key
      // In test environment without API keys, it should fail
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/No API key|AI execution failed/);
    });

    it('should fail execution for unknown node type', async () => {
      const node = {
        type_key: 'unknown_type'
      };
      
      const result = await executeNode(node, {});
      
      expect(result.success).toBe(false);
      expect(result.error).toBe('Unknown node type: unknown_type');
    });
  });

  describe('Node Type Properties', () => {
    it('should have proper default dimensions', () => {
      const textNode = getNodeType('text');
      expect(textNode.defaultWidth).toBeGreaterThan(0);
      expect(textNode.defaultHeight).toBeGreaterThan(0);
      
      const aiNode = getNodeType('ai_agent');
      expect(aiNode.defaultWidth).toBeGreaterThan(textNode.defaultWidth); // AI nodes should be larger
    });

    it('should have proper edge capabilities', () => {
      const textNode = getNodeType('text');
      expect(textNode.canHaveInputs).toBe(true);
      expect(textNode.canHaveOutputs).toBe(true);
      
      const inputNode = getNodeType('input');
      expect(inputNode.canHaveOutputs).toBe(true);
      
      const outputNode = getNodeType('output');
      expect(outputNode.canHaveInputs).toBe(true);
    });

    it('should have default configs', () => {
      const types = getAllNodeTypes();
      
      types.forEach(type => {
        expect(type.defaultConfig).toBeDefined();
        expect(typeof type.defaultConfig).toBe('object');
      });
    });
  });
});