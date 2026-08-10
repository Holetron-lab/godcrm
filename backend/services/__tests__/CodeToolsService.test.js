/**
 * AI Agent Code Tools Tests
 * ADR-032: Code Execution Engine — Judge0 + Agent Loop
 * 
 * BEHAVIOR: AI Agent can execute code using tools
 * 
 * Tests for:
 * - run_code tool
 * - validate_code tool  
 * - run_code_loop tool
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock fetch globally
global.fetch = vi.fn();

// Import after mocking
import { 
  runCodeTool, 
  runCodeLoopTool, 
  validateCodeTool,
  CODE_TOOLS 
} from '../CodeToolsService.js';

describe('AI Agent Code Tools - ADR-032', () => {
  
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.BACKEND_URL = 'http://localhost:5001';
  });
  
  describe('Tool Definitions', () => {
    
    it('should export CODE_TOOLS array with all code tools', () => {
      expect(Array.isArray(CODE_TOOLS)).toBe(true);
      expect(CODE_TOOLS.length).toBeGreaterThanOrEqual(3);
      
      const toolNames = CODE_TOOLS.map(t => t.function.name);
      expect(toolNames).toContain('run_code');
      expect(toolNames).toContain('validate_code');
      expect(toolNames).toContain('run_code_loop');
    });
    
    it('run_code tool should have correct parameters', () => {
      const tool = CODE_TOOLS.find(t => t.function.name === 'run_code');
      expect(tool.type).toBe('function');
      expect(tool.function.parameters.properties).toHaveProperty('source_code');
      expect(tool.function.parameters.properties).toHaveProperty('language');
      expect(tool.function.parameters.required).toContain('source_code');
    });
    
    it('validate_code tool should have correct parameters', () => {
      const tool = CODE_TOOLS.find(t => t.function.name === 'validate_code');
      expect(tool.type).toBe('function');
      expect(tool.function.parameters.properties).toHaveProperty('source_code');
      expect(tool.function.parameters.properties).toHaveProperty('language');
      expect(tool.function.parameters.required).toContain('source_code');
    });
    
    it('run_code_loop tool should have callback parameters', () => {
      const tool = CODE_TOOLS.find(t => t.function.name === 'run_code_loop');
      expect(tool.type).toBe('function');
      expect(tool.function.parameters.properties).toHaveProperty('source_code');
      expect(tool.function.parameters.properties).toHaveProperty('next_prompt');
    });
  });
  
  describe('runCodeTool.execute()', () => {
    
    it('should execute Python code and return result', async () => {
      // Arrange
      global.fetch.mockResolvedValueOnce({
        json: () => Promise.resolve({
          success: true,
          stdout: 'Hello, World!\n',
          stderr: '',
          status: 'Accepted',
          time: '0.01',
          memory: 3200
        })
      });
      
      // Act
      const result = await runCodeTool.execute({
        source_code: 'print("Hello, World!")',
        language: 'python'
      });
      
      // Assert
      expect(result.success).toBe(true);
      expect(result.stdout).toBe('Hello, World!\n');
      expect(fetch).toHaveBeenCalledWith(
        'http://localhost:5001/api/v3/code/execute',
        expect.objectContaining({
          method: 'POST'
        })
      );
      // Verify body contains the code
      const callArgs = fetch.mock.calls[0][1];
      const body = JSON.parse(callArgs.body);
      expect(body.source_code).toBe('print("Hello, World!")');
      expect(body.language).toBe('python');
    });
    
    it('should pass stdin to code execution', async () => {
      // Arrange
      global.fetch.mockResolvedValueOnce({
        json: () => Promise.resolve({
          success: true,
          stdout: 'Alice\n',
          stderr: '',
          status: 'Accepted'
        })
      });
      
      // Act
      await runCodeTool.execute({
        source_code: 'print(input())',
        language: 'python',
        stdin: 'Alice'
      });
      
      // Assert
      expect(fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('"stdin":"Alice"')
        })
      );
    });
    
    it('should return error for failed execution', async () => {
      // Arrange
      global.fetch.mockResolvedValueOnce({
        json: () => Promise.resolve({
          success: false,
          stdout: '',
          stderr: 'ZeroDivisionError: division by zero',
          status: 'Runtime Error'
        })
      });
      
      // Act
      const result = await runCodeTool.execute({
        source_code: 'print(1/0)',
        language: 'python'
      });
      
      // Assert
      expect(result.success).toBe(false);
      expect(result.stderr).toContain('ZeroDivisionError');
    });
    
    it('should support multiple languages', async () => {
      const languages = ['javascript', 'go', 'rust', 'ruby'];
      
      for (const language of languages) {
        global.fetch.mockResolvedValueOnce({
          json: () => Promise.resolve({ success: true, stdout: 'ok' })
        });
        
        await runCodeTool.execute({
          source_code: 'console.log("test")',
          language
        });
        
        expect(fetch).toHaveBeenLastCalledWith(
          expect.any(String),
          expect.objectContaining({
            body: expect.stringContaining(`"language":"${language}"`)
          })
        );
      }
    });
  });
  
  describe('validateCodeTool.execute()', () => {
    
    it('should validate correct Python syntax', async () => {
      // Arrange
      global.fetch.mockResolvedValueOnce({
        json: () => Promise.resolve({
          valid: true,
          errors: []
        })
      });
      
      // Act
      const result = await validateCodeTool.execute({
        source_code: 'def hello(): return "world"',
        language: 'python'
      });
      
      // Assert
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });
    
    it('should detect invalid syntax', async () => {
      // Arrange
      global.fetch.mockResolvedValueOnce({
        json: () => Promise.resolve({
          valid: false,
          errors: [{ message: 'SyntaxError: invalid syntax' }]
        })
      });
      
      // Act
      const result = await validateCodeTool.execute({
        source_code: 'def hello( return',
        language: 'python'
      });
      
      // Assert
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });
  
  describe('runCodeLoopTool.execute()', () => {
    
    it('should submit code for async execution with context', async () => {
      // Arrange
      global.fetch.mockResolvedValueOnce({
        json: () => Promise.resolve({
          status: 'executing',
          token: 'loop-token-123',
          message: 'Code is executing'
        })
      });
      
      const context = {
        conversationId: 'conv-abc',
        agentId: 1
      };
      
      // Act
      const result = await runCodeLoopTool.execute({
        source_code: 'print(sum(range(100)))',
        language: 'python',
        next_prompt: 'Analyze the result'
      }, context);
      
      // Assert
      expect(result.status).toBe('executing');
      expect(fetch).toHaveBeenCalledWith(
        'http://localhost:5001/api/v3/code/execute-loop',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('conv-abc')
        })
      );
    });
    
    it('should include next_prompt in request', async () => {
      // Arrange
      global.fetch.mockResolvedValueOnce({
        json: () => Promise.resolve({ status: 'executing', token: 'test' })
      });
      
      // Act
      await runCodeLoopTool.execute({
        source_code: 'print(1)',
        language: 'python',
        next_prompt: 'Continue analysis'
      }, { conversationId: 'c1', agentId: 1 });
      
      // Assert
      expect(fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('Continue analysis')
        })
      );
    });
  });
});
