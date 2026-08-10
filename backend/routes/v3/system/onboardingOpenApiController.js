// system/onboardingOpenApiController.js — Quick start, onboarding, OpenAPI spec

import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dbGet, dbRun } from '../../../database/connection.js';
import { apiLogger } from '../../../utils/logger.js';
import { AGENT_TOOLS } from '../../../services/AgentToolsService.js';
import swaggerJsdoc from 'swagger-jsdoc';
import { swaggerOptions } from '../../../swagger.config.js';
import { success, unauthorized, serverError } from '../../../utils/response.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

// ============================================================
// Quick Start Guide (Public endpoint - no owner check)
// ============================================================

/**
 * GET /api/v3/system/quick-start
 * Get Quick Start Guide content for onboarding
 * Available to all authenticated users
 */
router.get('/quick-start', async (req, res) => {
  try {
    const lang = req.query.lang || 'ru';

    // Path to quick start markdown file
    const quickStartPath = path.resolve(__dirname, '../../../../docs/help/QUICK-START-USER.md');

    let content = '';

    if (fs.existsSync(quickStartPath)) {
      content = fs.readFileSync(quickStartPath, 'utf-8');
    } else {
      // Fallback minimal content
      content = `# 🚀 GOD CRM — Быстрый старт

## Добро пожаловать!

1. **Создайте пространство** — нажмите "+ Создать пространство"
2. **Создайте проект** — внутри пространства нажмите "+ Проект"
3. **Создайте таблицу** — добавьте колонки и данные

Нужна помощь? Обратитесь в поддержку: support@hltrn.cc`;
    }

    return success(res, {
      title: 'Быстрый старт',
      content,
      format: 'markdown',
      language: lang,
      version: '1.0.0'
    });
  } catch (error) {
    apiLogger.error('Error fetching quick start:', error);
    return serverError(res, error.message);
  }
});

/**
 * GET /api/v3/system/onboarding-status
 * Get user's onboarding completion status
 */
router.get('/onboarding-status', async (req, res) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return unauthorized(res, 'User not authenticated');
    }

    // Check user_settings for onboarding completion
    const setting = await dbGet(
      "SELECT value FROM user_settings WHERE user_id = ? AND key = 'onboarding_completed'",
      [userId]
    );

    const completed = setting?.value === 'true' || setting?.value === '1';

    // Also check if user has created any spaces
    const spacesCount = await dbGet(
      'SELECT COUNT(*) as count FROM spaces WHERE owner_id = ?',
      [userId]
    );

    return success(res, {
      onboarding_completed: completed,
      has_spaces: (spacesCount?.count || 0) > 0,
      show_quick_start: !completed && (spacesCount?.count || 0) === 0
    });
  } catch (error) {
    apiLogger.error('Error fetching onboarding status:', error);
    return serverError(res, error.message);
  }
});

/**
 * POST /api/v3/system/onboarding-complete
 * Mark onboarding as completed for current user
 */
router.post('/onboarding-complete', async (req, res) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return unauthorized(res, 'User not authenticated');
    }

    // Ensure user_settings table exists
    await dbRun(`
      CREATE TABLE IF NOT EXISTS user_settings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        key TEXT NOT NULL,
        value TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, key)
      )
    `);

    // Upsert onboarding_completed
    await dbRun(
      `INSERT INTO user_settings (user_id, key, value, updated_at)
       VALUES (?, 'onboarding_completed', 'true', CURRENT_TIMESTAMP)
       ON CONFLICT(user_id, key) DO UPDATE SET value = 'true', updated_at = CURRENT_TIMESTAMP`,
      [userId]
    );

    apiLogger.info({ userId }, 'Onboarding completed');

    return success(res, { message: 'Onboarding marked as completed' });
  } catch (error) {
    apiLogger.error('Error completing onboarding:', error);
    return serverError(res, error.message);
  }
});

// ============================================================================
// ADR-036: OpenAPI for AI Agents (authenticated, extended info)
// ============================================================================

/**
 * @swagger
 * /system/openapi:
 *   get:
 *     tags: [System]
 *     summary: Get OpenAPI spec for AI agents
 *     description: |
 *       Extended OpenAPI specification with additional metadata for AI agents:
 *       - Full OpenAPI 3.0.3 spec
 *       - Available agent tools (for function calling)
 *       - Endpoint statistics
 *       - Usage instructions for AI
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Extended OpenAPI spec for AI consumption
 */
router.get('/openapi', async (req, res) => {
  try {
    // Generate fresh OpenAPI spec
    const swaggerSpec = swaggerJsdoc(swaggerOptions);

    // Get available agent tools (filter out internal details)
    const agentToolsSummary = AGENT_TOOLS.map(tool => {
      if (tool.type === 'function' && tool.function) {
        return {
          name: tool.function.name,
          description: tool.function.description,
          parameters: tool.function.parameters
        };
      }
      return tool;
    });

    // Build extended response for AI agents
    const response = {
      success: true,
      data: {
        // Full OpenAPI spec
        openapi_spec: swaggerSpec,

        // Agent tools for function calling
        agent_tools: agentToolsSummary,

        // Metadata for AI understanding
        metadata: {
          api_version: swaggerSpec.info?.version || '0.003.001',
          openapi_version: swaggerSpec.openapi,
          endpoint_count: Object.keys(swaggerSpec.paths || {}).length,
          tag_count: (swaggerSpec.tags || []).length,
          available_tags: (swaggerSpec.tags || []).map(t => t.name),
          base_url: '/api/v3',
          auth_type: 'Bearer JWT',
          tool_count: agentToolsSummary.length
        },

        // Instructions for AI usage
        ai_instructions: {
          how_to_use: 'Use openapi_spec.paths to understand available endpoints. Use agent_tools for function calling capabilities.',
          authentication: 'All /api/v3/* endpoints require Bearer token in Authorization header',
          common_patterns: {
            list: 'GET /resource - returns array in data field',
            get: 'GET /resource/:id - returns object in data field',
            create: 'POST /resource - send JSON body, returns created object',
            update: 'PUT /resource/:id - send JSON body with changes',
            delete: 'DELETE /resource/:id - returns success message'
          },
          response_format: {
            success: '{ success: true, data: ... }',
            error: '{ success: false, error: { code, message } }'
          }
        }
      },
      timestamp: new Date().toISOString()
    };

    apiLogger.debug({ userId: req.user?.id }, 'OpenAPI spec requested by agent');

    return res.json(response);
  } catch (error) {
    apiLogger.error('Error generating OpenAPI for agent:', error);
    return serverError(res, error.message);
  }
});

/**
 * @swagger
 * /system/openapi/tools:
 *   get:
 *     tags: [System]
 *     summary: Get available agent tools
 *     description: Returns only the agent tools definitions for AI function calling
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of agent tools
 */
router.get('/openapi/tools', async (req, res) => {
  try {
    const tools = AGENT_TOOLS.map(tool => {
      if (tool.type === 'function' && tool.function) {
        return {
          name: tool.function.name,
          description: tool.function.description,
          parameters: tool.function.parameters
        };
      }
      return tool;
    });

    return success(res, {
      tools,
      count: tools.length,
      usage: 'Pass these tools to OpenAI/Anthropic API for function calling'
    });
  } catch (error) {
    apiLogger.error('Error fetching agent tools:', error);
    return serverError(res, error.message);
  }
});

export default router;
