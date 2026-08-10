/**
 * Code Execution API Tests
 * ADR-032: Code Execution Engine — Piston Integration
 * 
 * BEHAVIOR: AI Agent can execute code in multiple languages via Piston
 * 
 * Acceptance Criteria:
 * - POST /api/v3/code/execute - executes code and returns result
 * - GET /api/v3/code/languages - returns list of supported languages
 * - POST /api/v3/code/validate - validates code syntax
 * - POST /api/v3/code/execute-loop - executes with Agent callback
 */

import { describe, it, expect, beforeAll, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// Mock axios before importing the router
vi.mock('axios');

let codeRouter;
let app;

beforeAll(async () => {
  // Set up test environment
  process.env.PISTON_URL = 'http://localhost:2000';
  process.env.BACKEND_URL = 'http://localhost:5001';
  
  // Import the router
  const module = await import('../code.js');
  codeRouter = module.default;
  
  // Create Express app for testing
  app = express();
  app.use(express.json());
  app.use('/api/v3/code', codeRouter);
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('Code Execution API - ADR-032 (Piston)', () => {
  
  // ============================================
  // GET /api/v3/code/languages
  // ============================================
  
  describe('GET /api/v3/code/languages', () => {
    
    it('Given Piston is available, When requested, Then returns list of runtimes', async () => {
      // Arrange
      const axios = (await import('axios')).default;
      axios.get = vi.fn().mockResolvedValue({
        data: [
          { language: 'python', version: '3.10.0', aliases: ['py', 'py3'] },
          { language: 'javascript', version: '20.11.1', aliases: ['js', 'node'] },
          { language: 'typescript', version: '5.0.3', aliases: ['ts'] }
        ]
      });
      
      // Act
      const response = await request(app)
        .get('/api/v3/code/languages');
      
      // Assert
      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBe(3);
      expect(response.body[0]).toHaveProperty('language');
      expect(response.body[0]).toHaveProperty('version');
    });
    
    it('Given Piston is unavailable, When requested, Then returns fallback aliases', async () => {
      // Arrange
      const axios = (await import('axios')).default;
      axios.get = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
      
      // Act
      const response = await request(app)
        .get('/api/v3/code/languages');
      
      // Assert
      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.some(lang => lang.language === 'python')).toBe(true);
    });
  });
  
  // ============================================
  // POST /api/v3/code/execute
  // ============================================
  
  describe('POST /api/v3/code/execute', () => {
    
    it('Given valid Python code, When executed, Then returns successful result', async () => {
      // Arrange
      const axios = (await import('axios')).default;
      axios.post = vi.fn().mockResolvedValue({
        data: {
          run: {
            stdout: 'Hello, World!\n',
            stderr: '',
            code: 0,
            signal: null,
            cpu_time: 15,
            wall_time: 42,
            memory: 3500000
          },
          language: 'python',
          version: '3.10.0'
        }
      });
      
      // Act
      const response = await request(app)
        .post('/api/v3/code/execute')
        .send({
          source_code: 'print("Hello, World!")',
          language: 'python'
        });
      
      // Assert
      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.stdout).toBe('Hello, World!\n');
      expect(response.body.stderr).toBe('');
      expect(response.body.code).toBe(0);
      expect(response.body.time).toEqual({ cpu_ms: 15, wall_ms: 42 });
      expect(response.body.memory_bytes).toBe(3500000);
      expect(response.body.language).toBe('python');
    });
    
    it('Given code with syntax error, When executed, Then returns error with stderr', async () => {
      // Arrange
      const axios = (await import('axios')).default;
      axios.post = vi.fn().mockResolvedValue({
        data: {
          run: {
            stdout: '',
            stderr: 'SyntaxError: invalid syntax\n',
            code: 1,
            signal: null,
            cpu_time: 10,
            wall_time: 20,
            memory: 2000000
          },
          language: 'python',
          version: '3.10.0'
        }
      });
      
      // Act
      const response = await request(app)
        .post('/api/v3/code/execute')
        .send({
          source_code: 'print("Hello',
          language: 'python'
        });
      
      // Assert
      expect(response.status).toBe(200);
      expect(response.body.success).toBe(false);
      expect(response.body.code).toBe(1);
      expect(response.body.stderr).toContain('SyntaxError');
    });
    
    it('Given runtime error, When executed, Then returns error details', async () => {
      // Arrange
      const axios = (await import('axios')).default;
      axios.post = vi.fn().mockResolvedValue({
        data: {
          run: {
            stdout: '',
            stderr: 'ZeroDivisionError: division by zero\n',
            code: 1,
            signal: null,
            cpu_time: 12,
            wall_time: 25,
            memory: 3000000
          },
          language: 'python',
          version: '3.10.0'
        }
      });
      
      // Act
      const response = await request(app)
        .post('/api/v3/code/execute')
        .send({
          source_code: 'print(1/0)',
          language: 'python'
        });
      
      // Assert
      expect(response.status).toBe(200);
      expect(response.body.success).toBe(false);
      expect(response.body.stderr).toContain('ZeroDivisionError');
    });
    
    it('Given JavaScript code with "js" alias, When executed, Then uses javascript runtime', async () => {
      // Arrange
      const axios = (await import('axios')).default;
      axios.post = vi.fn().mockResolvedValue({
        data: {
          run: {
            stdout: '42\n',
            stderr: '',
            code: 0,
            cpu_time: 30,
            wall_time: 50,
            memory: 7000000
          },
          language: 'javascript',
          version: '20.11.1'
        }
      });
      
      // Act
      const response = await request(app)
        .post('/api/v3/code/execute')
        .send({
          source_code: 'console.log(42)',
          language: 'js'
        });
      
      // Assert
      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.stdout).toBe('42\n');
      
      // Verify Piston was called with correct language
      expect(axios.post).toHaveBeenCalledWith(
        expect.stringContaining('/api/v2/execute'),
        expect.objectContaining({
          language: 'javascript',
          version: '20.11.1'
        })
      );
    });
    
    it('Given no source_code, When executed, Then returns 400 bad request', async () => {
      // Act
      const response = await request(app)
        .post('/api/v3/code/execute')
        .send({
          language: 'python'
        });
      
      // Assert
      expect(response.status).toBe(400);
    });
    
    it('Given Piston unavailable, When executed, Then returns 500 error', async () => {
      // Arrange
      const axios = (await import('axios')).default;
      axios.post = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
      
      // Act
      const response = await request(app)
        .post('/api/v3/code/execute')
        .send({
          source_code: 'print(1)',
          language: 'python'
        });
      
      // Assert
      expect(response.status).toBe(500);
      expect(response.body.error.message).toContain('ECONNREFUSED');
    });
    
    it('Given code with stdin, When executed, Then passes stdin to Piston', async () => {
      // Arrange
      const axios = (await import('axios')).default;
      axios.post = vi.fn().mockResolvedValue({
        data: {
          run: {
            stdout: 'Hello\n',
            stderr: '',
            code: 0,
            cpu_time: 10,
            wall_time: 20,
            memory: 3000000
          },
          language: 'python',
          version: '3.10.0'
        }
      });
      
      // Act
      const response = await request(app)
        .post('/api/v3/code/execute')
        .send({
          source_code: 'print(input())',
          language: 'python',
          stdin: 'Hello'
        });
      
      // Assert
      expect(response.status).toBe(200);
      expect(axios.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          stdin: 'Hello'
        })
      );
    });
  });
  
  // ============================================
  // POST /api/v3/code/validate
  // ============================================
  
  describe('POST /api/v3/code/validate', () => {
    
    it('Given valid Python syntax, When validated, Then returns valid: true', async () => {
      // Arrange
      const axios = (await import('axios')).default;
      axios.post = vi.fn().mockResolvedValue({
        data: {
          run: {
            stdout: 'valid\n',
            stderr: '',
            code: 0
          }
        }
      });
      
      // Act
      const response = await request(app)
        .post('/api/v3/code/validate')
        .send({
          source_code: 'def hello(): pass',
          language: 'python'
        });
      
      // Assert
      expect(response.status).toBe(200);
      expect(response.body.valid).toBe(true);
      expect(response.body.errors).toEqual([]);
    });
    
    it('Given invalid Python syntax, When validated, Then returns valid: false', async () => {
      // Arrange
      const axios = (await import('axios')).default;
      axios.post = vi.fn().mockResolvedValue({
        data: {
          run: {
            stdout: 'SyntaxError: unexpected EOF at line 1\n',
            stderr: '',
            code: 0  // ast.parse catches error, prints it, exits 0
          }
        }
      });
      
      // Act
      const response = await request(app)
        .post('/api/v3/code/validate')
        .send({
          source_code: 'def hello(',
          language: 'python'
        });
      
      // Assert
      expect(response.status).toBe(200);
      expect(response.body.valid).toBe(false);
      expect(response.body.errors.length).toBeGreaterThan(0);
      expect(response.body.errors[0].message).toContain('SyntaxError');
    });
    
    it('Given non-Python language, When validated, Then returns valid: true (not implemented)', async () => {
      // Act
      const response = await request(app)
        .post('/api/v3/code/validate')
        .send({
          source_code: 'console.log("hi")',
          language: 'javascript'
        });
      
      // Assert
      expect(response.status).toBe(200);
      expect(response.body.valid).toBe(true);
      expect(response.body.message).toContain('not implemented');
    });
    
    it('Given no source_code, When validated, Then returns 400', async () => {
      // Act
      const response = await request(app)
        .post('/api/v3/code/validate')
        .send({
          language: 'python'
        });
      
      // Assert
      expect(response.status).toBe(400);
    });
  });
  
  // ============================================
  // POST /api/v3/code/execute-loop
  // ============================================
  
  describe('POST /api/v3/code/execute-loop', () => {
    
    it('Given code execution succeeds, When executed with callback, Then returns success', async () => {
      // Arrange
      const axios = (await import('axios')).default;
      axios.post = vi.fn()
        // First call: Piston execute
        .mockResolvedValueOnce({
          data: {
            run: {
              stdout: '4\n',
              stderr: '',
              code: 0,
              cpu_time: 15,
              wall_time: 30,
              memory: 3000000
            },
            language: 'python',
            version: '3.10.0'
          }
        })
        // Second call: Agent callback (might fail, that's ok)
        .mockRejectedValueOnce(new Error('Agent not running'));
      
      // Act
      const response = await request(app)
        .post('/api/v3/code/execute-loop')
        .send({
          source_code: 'print(2+2)',
          language: 'python',
          conversation_id: 'conv-123',
          agent_id: 'agent-456',
          next_prompt: 'Continue processing'
        });
      
      // Assert
      expect(response.status).toBe(200);
      expect(response.body.status).toBe('completed');
      expect(response.body.success).toBe(true);
      expect(response.body.stdout).toBe('4\n');
    });
    
    it('Given no callback configured, When executed, Then still returns result', async () => {
      // Arrange
      const axios = (await import('axios')).default;
      axios.post = vi.fn().mockResolvedValue({
        data: {
          run: {
            stdout: '100\n',
            stderr: '',
            code: 0,
            cpu_time: 10,
            wall_time: 20,
            memory: 3000000
          },
          language: 'python',
          version: '3.10.0'
        }
      });
      
      // Act
      const response = await request(app)
        .post('/api/v3/code/execute-loop')
        .send({
          source_code: 'print(10*10)',
          language: 'python'
          // No conversation_id, agent_id
        });
      
      // Assert
      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.message).toContain('No callback');
      // Only one axios call (no callback attempt)
      expect(axios.post).toHaveBeenCalledTimes(1);
    });
    
    it('Given code execution fails, When executed with callback, Then returns error info', async () => {
      // Arrange
      const axios = (await import('axios')).default;
      axios.post = vi.fn()
        .mockResolvedValueOnce({
          data: {
            run: {
              stdout: '',
              stderr: 'NameError: name "x" is not defined\n',
              code: 1,
              cpu_time: 8,
              wall_time: 15,
              memory: 2500000
            },
            language: 'python',
            version: '3.10.0'
          }
        })
        .mockRejectedValueOnce(new Error('Agent not running'));
      
      // Act
      const response = await request(app)
        .post('/api/v3/code/execute-loop')
        .send({
          source_code: 'print(x)',
          language: 'python',
          conversation_id: 'conv-123',
          agent_id: 'agent-456'
        });
      
      // Assert
      expect(response.status).toBe(200);
      expect(response.body.status).toBe('completed');
      expect(response.body.success).toBe(false);
      expect(response.body.stderr).toContain('NameError');
    });
  });
});
