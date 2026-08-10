/**
 * Integration Tests for Labs Node Types System
 * @see ADR-043: Laboratories Feature
 */
import { describe, it, expect } from 'vitest';
import { LabsService } from '../index.js';

describe('Labs Node Types Integration', () => {
  it('should have complete node type system', () => {
    // Test that all required node types exist
    const types = LabsService.getNodeTypes();
    expect(types).toHaveLength(8);
    
    // Test each category has at least one node type
    const categories = types.map(t => t.category);
    expect(categories).toContain('basic');
    expect(categories).toContain('ai');
    expect(categories).toContain('media');
    expect(categories).toContain('io');
    expect(categories).toContain('dev');
  });

  it('should create and validate nodes for each type', () => {
    const nodeTypes = ['text', 'ai_agent', 'image', 'file', 'input', 'output', 'code', 'note'];
    
    for (const typeKey of nodeTypes) {
      // Create node with defaults
      const nodeData = LabsService.createNodeWithDefaults(typeKey, {
        title: `Test ${typeKey} Node`
      });
      
      // Validate the created node
      const validation = LabsService.validateNode(nodeData);
      expect(validation.valid).toBe(true);
      expect(validation.errors).toHaveLength(0);
      
      // Check required fields
      expect(nodeData.type_key).toBe(typeKey);
      expect(nodeData.title).toBe(`Test ${typeKey} Node`);
      expect(nodeData.node_id).toBeDefined();
      expect(nodeData.width).toBeGreaterThan(0);
      expect(nodeData.height).toBeGreaterThan(0);
    }
  });

  it('should execute all node types without errors', async () => {
    // Note: AI agent node requires a real agent in DB, so we test it separately
    const testNodes = [
      { type_key: 'text', content: 'Test text', config: {} },
      { type_key: 'image', config: { src: 'test.jpg' } },
      { type_key: 'file', config: { filename: 'test.txt' } },
      { type_key: 'input', config: { inputType: 'text' } },
      { type_key: 'output', content: 'Test output', config: {} },
      { type_key: 'code', content: 'console.log("test");', config: {} },
      { type_key: 'note', content: 'Test note', config: {} }
    ];
    
    for (const node of testNodes) {
      const result = await LabsService.executeNode(node);
      expect(result.success).toBe(true);
      expect(result.output).toBeDefined();
      expect(result.type).toBe(node.type_key);
    }
  });

  it('should handle AI agent node execution (error in test env)', async () => {
    const aiNode = { type_key: 'ai_agent', config: { ai_agent_id: 123 } };
    const result = await LabsService.executeNode(aiNode);
    
    // In test environment, either agent doesn't exist or DB query fails
    expect(result.success).toBe(false);
    expect(result.type).toBe('ai_agent');
    // Error can be "AI agent 123 not found" or "AI agent execution failed"
    expect(result.error).toMatch(/AI agent/);
  });

  it('should handle edge cases gracefully', async () => {
    // Test AI agent without agent ID
    const aiNodeWithoutAgent = {
      type_key: 'ai_agent',
      config: {}
    };
    
    const result = await LabsService.executeNode(aiNodeWithoutAgent);
    expect(result.success).toBe(false);
    // Error can be either "No AI agent selected" or "No API key configured for provider: openai"
    expect(result.error).toMatch(/No AI agent selected|No API key configured/);
    
    // Test image without source
    const imageNodeWithoutSrc = {
      type_key: 'image',
      config: {}
    };
    
    const imageResult = await LabsService.executeNode(imageNodeWithoutSrc);
    expect(imageResult.success).toBe(false);
    expect(imageResult.error).toBe('No image source provided');
    
    // Test file without filename
    const fileNodeWithoutName = {
      type_key: 'file',
      config: {}
    };
    
    const fileResult = await LabsService.executeNode(fileNodeWithoutName);
    expect(fileResult.success).toBe(false);
    expect(fileResult.error).toBe('No file specified');
  });

  it('should validate configurations correctly', () => {
    // Test valid configurations
    const validConfigs = [
      { type: 'text', config: { fontSize: 16, fontWeight: 'bold' } },
      { type: 'ai_agent', config: { temperature: 0.7, max_tokens: 1000 } },
      { type: 'code', config: { language: 'javascript', theme: 'dark' } },
      { type: 'note', config: { color: 'yellow', priority: 'high' } }
    ];
    
    for (const { type, config } of validConfigs) {
      const result = LabsService.validateNodeConfig(type, config);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    }
    
    // Test invalid configurations
    const invalidConfigs = [
      { type: 'text', config: { fontSize: 100 }, expectedError: 'fontSize must be a number between 8 and 72' },
      { type: 'ai_agent', config: { temperature: 5 }, expectedError: 'temperature must be a number between 0 and 2' },
      { type: 'code', config: { language: 'unknown' }, expectedError: 'language must be one of:' },
      { type: 'note', config: { color: 'purple' }, expectedError: 'color must be one of: yellow, blue, green, pink, orange' }
    ];
    
    for (const { type, config, expectedError } of invalidConfigs) {
      const result = LabsService.validateNodeConfig(type, config);
      expect(result.valid).toBe(false);
      expect(result.errors.some(error => error.includes(expectedError))).toBe(true);
    }
  });
});