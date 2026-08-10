/**
 * Code Execution API Routes
 * ADR-032: Code Execution Engine — Piston Integration
 * 
 * Provides endpoints for executing code via Piston:
 * - POST /execute      - Execute code synchronously
 * - POST /execute-loop - Execute with Agent callback
 * - POST /validate     - Validate syntax without execution
 * - GET  /languages    - List supported languages
 * 
 * Piston API: https://github.com/engineer-man/piston
 */

/**
 * @swagger
 * components:
 *   schemas:
 *     CodeExecutionRequest:
 *       type: object
 *       required: [source_code]
 *       properties:
 *         source_code:
 *           type: string
 *         language:
 *           type: string
 *           default: python
 *         stdin:
 *           type: string
 *         args:
 *           type: array
 *           items:
 *             type: string
 *         timeout:
 *           type: integer
 *           default: 3000
 *     CodeExecutionResult:
 *       type: object
 *       properties:
 *         stdout:
 *           type: string
 *         stderr:
 *           type: string
 *         exit_code:
 *           type: integer
 */

import { Router } from 'express';
import axios from 'axios';
import { apiLogger } from '../../utils/logger.js';
import { success, badRequest, error } from '../../utils/response.js';

const router = Router();

const PISTON_URL = process.env.PISTON_URL || 'http://localhost:2000';
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:5001';

/**
 * Language aliases → Piston language/version
 * Maps user-friendly names to Piston runtime specifications
 */
const LANGUAGE_ALIASES = {
  python: { language: 'python', version: '3.10.0' },
  python3: { language: 'python', version: '3.10.0' },
  py: { language: 'python', version: '3.10.0' },
  javascript: { language: 'javascript', version: '20.11.1' },
  js: { language: 'javascript', version: '20.11.1' },
  node: { language: 'javascript', version: '20.11.1' },
  nodejs: { language: 'javascript', version: '20.11.1' },
  typescript: { language: 'typescript', version: '5.0.3' },
  ts: { language: 'typescript', version: '5.0.3' },
  bash: { language: 'bash', version: '5.2.0' },
  sh: { language: 'bash', version: '5.2.0' },
  shell: { language: 'bash', version: '5.2.0' },
};

/**
 * GET /api/v3/code/languages
 * List supported programming languages from Piston
 * @swagger
 * /api/v3/code/languages:
 *   get:
 *     summary: List supported programming languages
 *     tags: [Code Execution]
 *     responses:
 *       200:
 *         description: List of available languages
 */
router.get('/languages', async (req, res) => {
  try {
    // Get runtimes from Piston
    const response = await axios.get(`${PISTON_URL}/api/v2/runtimes`);
    return res.json(response.data);
  } catch (err) {
    apiLogger.debug({ err: err.message }, 'Piston unavailable, using local language list');
    // Fallback to local aliases
    const localList = Object.entries(LANGUAGE_ALIASES)
      .filter(([alias], index, arr) => {
        // Remove duplicate aliases, keep base names
        const baseNames = ['python', 'javascript', 'typescript', 'bash'];
        return baseNames.includes(alias);
      })
      .map(([alias, config]) => ({ 
        language: config.language, 
        version: config.version,
        aliases: [alias]
      }));
    return res.json(localList);
  }
});

/**
 * POST /api/v3/code/execute
 * Execute code synchronously via Piston
 * @swagger
 * /api/v3/code/execute:
 *   post:
 *     summary: Execute code synchronously
 *     tags: [Code Execution]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CodeExecutionRequest'
 *     responses:
 *       200:
 *         description: Execution result
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/CodeExecutionResult'
 */
router.post('/execute', async (req, res) => {
  try {
    const {
      source_code,
      language = 'python',
      stdin = '',
      args = [],
      timeout = 3000,  // milliseconds (Piston max is 3000)
    } = req.body;

    // Ensure timeout doesn't exceed Piston limit
    const safeTimeout = Math.min(timeout, 3000);

    if (!source_code) {
      return badRequest(res, 'source_code is required');
    }

    // Resolve language alias to Piston runtime
    const langConfig = LANGUAGE_ALIASES[language.toLowerCase()] || { 
      language: language, 
      version: '*'  // Latest available
    };

    apiLogger.debug({ 
      language: langConfig.language, 
      version: langConfig.version, 
      codeLength: source_code.length 
    }, 'Executing code via Piston');

    // Execute via Piston
    const response = await axios.post(`${PISTON_URL}/api/v2/execute`, {
      language: langConfig.language,
      version: langConfig.version,
      files: [{ content: source_code }],
      stdin,
      args,
      run_timeout: safeTimeout,
      compile_timeout: safeTimeout,
    });

    const result = response.data;
    const run = result.run || {};

    const isSuccess = run.code === 0;

    const responseBody = {
      success: isSuccess,
      stdout: run.stdout || '',
      stderr: run.stderr || '',
      code: run.code,
      signal: run.signal,
      time: {
        cpu_ms: run.cpu_time,
        wall_ms: run.wall_time
      },
      memory_bytes: run.memory,
      language: result.language,
      version: result.version,
    };

    apiLogger.debug({ 
      success: isSuccess, 
      exitCode: run.code,
      cpu_time: run.cpu_time,
      wall_time: run.wall_time
    }, 'Code execution completed');

    return res.json(responseBody);

  } catch (err) {
    apiLogger.error({ err: err.message }, 'Code execution failed');
    return error(res, 'PISTON_ERROR', `Piston execution failed: ${err.message}`);
  }
});

/**
 * POST /api/v3/code/execute-loop
 * Execute code and trigger Agent callback with result
 * Used for Agent Loop pattern - AI Agent continues conversation based on result
 */
router.post('/execute-loop', async (req, res) => {
  try {
    const {
      source_code,
      language = 'python',
      stdin = '',
      args = [],
      timeout = 3000,  // Piston max is 3000ms
      // Agent callback configuration
      conversation_id,
      agent_id,
      next_prompt,
    } = req.body;

    // Ensure timeout doesn't exceed Piston limit
    const safeTimeout = Math.min(timeout, 3000);

    if (!source_code) {
      return badRequest(res, 'source_code is required');
    }

    // Resolve language alias
    const langConfig = LANGUAGE_ALIASES[language.toLowerCase()] || { 
      language: language, 
      version: '*' 
    };

    apiLogger.debug({ 
      language: langConfig.language, 
      conversation_id,
      agent_id
    }, 'Executing code with Agent callback');

    // Execute via Piston (synchronous - Piston is fast)
    const response = await axios.post(`${PISTON_URL}/api/v2/execute`, {
      language: langConfig.language,
      version: langConfig.version,
      files: [{ content: source_code }],
      stdin,
      args,
      run_timeout: safeTimeout,
    });

    const result = response.data;
    const run = result.run || {};
    const isSuccess = run.code === 0;

    // Build message for Agent continuation
    let message;
    if (isSuccess) {
      message = `Код выполнен успешно.

**Output:**
\`\`\`
${run.stdout || '(no output)'}
\`\`\`

**Time:** ${run.cpu_time}ms CPU | ${run.wall_time}ms wall | **Memory:** ${Math.round((run.memory || 0) / 1024)} KB

${next_prompt || 'Проанализируй результат и продолжи.'}`;
    } else {
      message = `Код завершился с ошибкой (exit code: ${run.code})

**Error:**
\`\`\`
${run.stderr || run.output || 'Unknown error'}
\`\`\`

Исправь ошибку и попробуй снова.`;
    }

    // Call Agent continue endpoint if configured
    if (conversation_id && agent_id) {
      try {
        await axios.post(`${BACKEND_URL}/api/v3/ai-agents/continue`, {
          conversation_id,
          agent_id,
          message,
          tool_result: {
            stdout: run.stdout,
            stderr: run.stderr,
            success: isSuccess,
            code: run.code,
            time: { cpu_ms: run.cpu_time, wall_ms: run.wall_time },
            memory_bytes: run.memory
          },
          source: 'code_execution'
        });
        
        apiLogger.debug({ conversation_id, agent_id }, 'Agent callback sent');
      } catch (callbackErr) {
        apiLogger.warn({ err: callbackErr.message }, 'Agent callback failed');
      }
    }

    return res.json({
      status: 'completed',
      success: isSuccess,
      stdout: run.stdout || '',
      stderr: run.stderr || '',
      code: run.code,
      time: { cpu_ms: run.cpu_time, wall_ms: run.wall_time },
      message: conversation_id ? 'Result sent to Agent' : 'No callback configured'
    });

  } catch (err) {
    apiLogger.error({ err: err.message }, 'Code execution with loop failed');
    return error(res, 'EXECUTION_ERROR', `Execution failed: ${err.message}`);
  }
});

/**
 * POST /api/v3/code/validate
 * Validate code syntax without execution
 * Currently implemented for Python via ast.parse
 */
router.post('/validate', async (req, res) => {
  try {
    const { source_code, language = 'python' } = req.body;

    if (!source_code) {
      return badRequest(res, 'source_code is required');
    }

    if (language.toLowerCase() === 'python' || language.toLowerCase() === 'py') {
      // Validate Python via ast.parse in Piston
      const validationCode = `import ast
try:
    ast.parse(${JSON.stringify(source_code)})
    print("valid")
except SyntaxError as e:
    print(f"SyntaxError: {e.msg} at line {e.lineno}")`;

      const response = await axios.post(`${PISTON_URL}/api/v2/execute`, {
        language: 'python',
        version: '3.10.0',
        files: [{ content: validationCode }],
        run_timeout: 3000,  // Piston max limit
      });

      const run = response.data.run || {};
      const stdout = run.stdout || '';
      // Check exact match - "valid" only, not "invalid" which also contains "valid"
      const isValid = run.code === 0 && stdout.trim() === 'valid';

      return res.json({
        valid: isValid,
        errors: isValid ? [] : [{
          message: stdout.trim() || run.stderr || 'Syntax error'
        }]
      });
    }

    // For other languages, return success (validation not implemented)
    return res.json({ 
      valid: true, 
      errors: [], 
      message: `Validation not implemented for ${language}` 
    });

  } catch (err) {
    apiLogger.error({ err: err.message }, 'Code validation failed');
    return error(res, 'VALIDATION_ERROR', `Validation failed: ${err.message}`);
  }
});

export default router;
