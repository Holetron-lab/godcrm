/**
 * Code Tools Service
 * ADR-032: Code Execution Engine — Judge0 + Agent Loop
 * 
 * Provides AI Agent tools for code execution:
 * - run_code: Execute code synchronously
 * - validate_code: Validate syntax without execution
 * - run_code_loop: Execute with Agent callback
 */

import { aiLogger } from '../utils/logger.js';

const CODE_API_URL = process.env.BACKEND_URL || 'http://localhost:5001';

/**
 * Supported programming languages
 */
const SUPPORTED_LANGUAGES = [
  'python', 'javascript', 'typescript', 'cpp', 'java', 
  'go', 'rust', 'ruby', 'php', 'csharp', 'bash', 'sql',
  'kotlin', 'swift', 'r', 'perl', 'lua'
];

/**
 * run_code Tool Definition
 * Executes code synchronously and returns result
 */
export const runCodeTool = {
  name: 'run_code',
  type: 'function',
  function: {
    name: 'run_code',
    description: `Execute code in various programming languages.
Supported languages: ${SUPPORTED_LANGUAGES.join(', ')}.
Returns stdout, stderr, execution time and memory usage.
Use for quick calculations, data processing, or testing code snippets.`,
    parameters: {
      type: 'object',
      properties: {
        source_code: { 
          type: 'string', 
          description: 'Source code to execute' 
        },
        language: { 
          type: 'string', 
          enum: SUPPORTED_LANGUAGES,
          description: 'Programming language (default: python)' 
        },
        stdin: { 
          type: 'string', 
          description: 'Input data for the program (optional)' 
        },
        timeout: { 
          type: 'number', 
          description: 'Timeout in seconds (default: 5, max: 30)' 
        }
      },
      required: ['source_code']
    }
  },
  
  async execute({ source_code, language = 'python', stdin = '', timeout = 5 }) {
    try {
      aiLogger.debug({ language, codeLength: source_code?.length }, 'Executing code via run_code tool');
      
      const response = await fetch(`${CODE_API_URL}/api/v3/code/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source_code, language, stdin, timeout })
      });
      
      const result = await response.json();
      
      aiLogger.debug({ 
        success: result.success, 
        time: result.time 
      }, 'Code execution completed');
      
      return result;
    } catch (err) {
      aiLogger.error({ err: err.message }, 'run_code tool failed');
      return {
        success: false,
        error: err.message,
        stdout: '',
        stderr: `Tool execution error: ${err.message}`
      };
    }
  }
};

/**
 * validate_code Tool Definition
 * Validates code syntax without execution
 */
export const validateCodeTool = {
  name: 'validate_code',
  type: 'function',
  function: {
    name: 'validate_code',
    description: `Validate code syntax without executing it.
Fast check for syntax errors before running.
Works best with Python (uses AST parser).`,
    parameters: {
      type: 'object',
      properties: {
        source_code: { 
          type: 'string', 
          description: 'Source code to validate' 
        },
        language: { 
          type: 'string', 
          description: 'Programming language (default: python)' 
        }
      },
      required: ['source_code']
    }
  },
  
  async execute({ source_code, language = 'python' }) {
    try {
      aiLogger.debug({ language }, 'Validating code syntax');
      
      const response = await fetch(`${CODE_API_URL}/api/v3/code/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source_code, language })
      });
      
      return response.json();
    } catch (err) {
      aiLogger.error({ err: err.message }, 'validate_code tool failed');
      return {
        valid: false,
        errors: [{ message: `Validation error: ${err.message}` }]
      };
    }
  }
};

/**
 * run_code_loop Tool Definition
 * Executes code with automatic Agent callback for iterative workflows
 */
export const runCodeLoopTool = {
  name: 'run_code_loop',
  type: 'function',
  function: {
    name: 'run_code_loop',
    description: `Execute code and automatically continue the conversation with the result.
Use for iterative tasks: debugging, experiments, step-by-step calculations.
The result will be analyzed automatically and the conversation will continue.`,
    parameters: {
      type: 'object',
      properties: {
        source_code: { 
          type: 'string', 
          description: 'Source code to execute' 
        },
        language: { 
          type: 'string', 
          description: 'Programming language (default: python)' 
        },
        stdin: { 
          type: 'string', 
          description: 'Input data for the program' 
        },
        next_prompt: { 
          type: 'string', 
          description: 'What to do after execution (e.g., "Analyze the result and optimize")' 
        }
      },
      required: ['source_code']
    }
  },
  
  async execute({ source_code, language = 'python', stdin = '', next_prompt = '' }, context = {}) {
    try {
      const { conversationId, agentId } = context;
      
      aiLogger.debug({ 
        language, 
        conversationId,
        hasNextPrompt: !!next_prompt 
      }, 'Submitting code for loop execution');
      
      const response = await fetch(`${CODE_API_URL}/api/v3/code/execute-loop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source_code,
          language,
          stdin,
          conversation_id: conversationId,
          agent_id: agentId,
          next_prompt
        })
      });
      
      const result = await response.json();
      
      return {
        status: result.status || 'executing',
        token: result.token,
        message: result.message || 'Code is executing, result will be processed automatically'
      };
    } catch (err) {
      aiLogger.error({ err: err.message }, 'run_code_loop tool failed');
      return {
        status: 'error',
        error: err.message,
        message: `Failed to submit code: ${err.message}`
      };
    }
  }
};

/**
 * All Code Tools for AI Agent
 * Export as array for easy integration with AGENT_TOOLS
 */
export const CODE_TOOLS = [
  {
    type: 'function',
    function: runCodeTool.function
  },
  {
    type: 'function',
    function: validateCodeTool.function
  },
  {
    type: 'function',
    function: runCodeLoopTool.function
  }
];

/**
 * Execute a code tool by name
 * @param {string} toolName - Tool name (run_code, validate_code, run_code_loop)
 * @param {object} params - Tool parameters
 * @param {object} context - Agent context (conversationId, agentId)
 */
export async function executeCodeTool(toolName, params, context = {}) {
  const tools = {
    run_code: runCodeTool,
    validate_code: validateCodeTool,
    run_code_loop: runCodeLoopTool
  };
  
  const tool = tools[toolName];
  if (!tool) {
    return { 
      success: false, 
      error: `Unknown tool: ${toolName}` 
    };
  }
  
  return tool.execute(params, context);
}

export default { 
  CODE_TOOLS, 
  runCodeTool, 
  validateCodeTool, 
  runCodeLoopTool,
  executeCodeTool 
};
