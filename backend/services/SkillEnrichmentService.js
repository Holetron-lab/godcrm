// SkillEnrichmentService.js
// Ticket #43305: AI auto-enrichment for AI Tools table
// Calls Claude Sonnet to analyze skills and return structured metadata

import { dbGet } from '../database/connection.js';
import { apiLogger } from '../utils/logger.js';

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_MODEL = 'claude-sonnet-4-20250514';
const ANTHROPIC_VERSION = '2023-06-01';
const MAX_TOKENS = 1024;

/**
 * Tool definition for structured output from Claude
 * Uses Anthropic tool_use to get clean JSON back
 */
const ENRICHMENT_TOOL = {
  name: 'enrich_skill',
  description: 'Provide structured metadata for an AI skill/tool',
  input_schema: {
    type: 'object',
    properties: {
      tags: {
        type: 'array',
        items: { type: 'string' },
        description: '3-8 relevant keyword tags for searching (lowercase, hyphenated)'
      },
      risk_level: {
        type: 'string',
        enum: ['low', 'medium', 'high'],
        description: 'Risk level: low (read-only, informational), medium (modifies files/config), high (system access, network, destructive)'
      },
      rating: {
        type: 'number',
        minimum: 1,
        maximum: 5,
        description: 'Quality score 1-5 based on description clarity and usefulness'
      },
      category: {
        type: 'string',
        enum: [
          'data', 'tables', 'workspace', 'widgets', 'analysis',
          'system', 'architecture', 'security', 'testing', 'devops',
          'game-development', 'frontend', 'backend', 'mobile', 'ai-ml'
        ],
        description: 'Best fit category for this skill'
      },
      platform: {
        type: 'array',
        items: {
          type: 'string',
          enum: ['claude-code', 'cursor', 'windsurf', 'copilot', 'god-crm']
        },
        description: 'Which platforms support this skill'
      }
    },
    required: ['tags', 'risk_level', 'rating', 'category', 'platform']
  }
};

/**
 * Get the active Anthropic API key from the database
 * API keys are stored in AI Operators table (table_id=226) as JSONB in table_rows
 * @returns {Promise<string|null>} API key or null if not found
 */
async function getAnthropicApiKey() {
  try {
    // AI Operators are stored in table_rows with table_id for the 'AI Operators' table
    // The Anthropic operator has provider='anthropic' and api_key in the data JSONB
    const row = await dbGet(`
      SELECT data FROM table_rows
      WHERE table_id = (SELECT id FROM universal_tables WHERE name = 'AI Operators' LIMIT 1)
      AND (
        (data->>'provider' = 'anthropic') OR
        (data::text ILIKE '%anthropic%' AND data::text ILIKE '%api_key%')
      )
      LIMIT 1
    `);

    if (!row) return null;

    const data = typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
    return data?.api_key || null;
  } catch (err) {
    apiLogger.error({ err }, '[SkillEnrichment] Failed to fetch Anthropic API key');
    return null;
  }
}

/**
 * Build the prompt for Claude to analyze a skill
 * @param {Object} rowData - Row data with skill fields
 * @returns {string} Formatted prompt
 */
function buildPrompt(rowData) {
  const name = rowData.name || rowData.skill_name || 'Unknown';
  const displayName = rowData.display_name || rowData.displayName || name;
  const description = rowData.description || 'No description provided';
  const category = rowData.category || 'uncategorized';
  const source = rowData.source || 'unknown';

  return `You are an AI skills/tools classifier. Analyze this skill and provide structured metadata.

Skill name: ${name}
Display name: ${displayName}
Description: ${description}
Current category: ${category}
Source: ${source}

Provide:
1. tags: 3-8 relevant keyword tags for searching (lowercase, hyphenated)
2. risk_level: "low" (read-only, informational), "medium" (modifies files/config), "high" (system access, network, destructive)
3. rating: 1-5 quality score based on description clarity and usefulness
4. category: best fit from [data, tables, workspace, widgets, analysis, system, architecture, security, testing, devops, game-development, frontend, backend, mobile, ai-ml]
5. platform: which platforms support this skill from [claude-code, cursor, windsurf, copilot, god-crm]`;
}

/**
 * Call Claude Sonnet via Anthropic API with tool_use for structured output
 * @param {string} apiKey - Anthropic API key
 * @param {string} prompt - The analysis prompt
 * @returns {Promise<Object|null>} Enriched fields or null on failure
 */
async function callClaude(apiKey, prompt) {
  const requestBody = {
    model: ANTHROPIC_MODEL,
    max_tokens: MAX_TOKENS,
    tools: [ENRICHMENT_TOOL],
    tool_choice: { type: 'tool', name: 'enrich_skill' },
    messages: [
      {
        role: 'user',
        content: prompt
      }
    ]
  };

  const response = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
      'content-type': 'application/json'
    },
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Anthropic API error ${response.status}: ${errorText}`);
  }

  const result = await response.json();

  // Extract tool_use result from response content
  const toolUseBlock = result.content?.find(block => block.type === 'tool_use');
  if (!toolUseBlock || !toolUseBlock.input) {
    throw new Error('No tool_use block found in Claude response');
  }

  return toolUseBlock.input;
}

/**
 * Validate and normalize the enrichment result
 * @param {Object} enrichment - Raw enrichment from Claude
 * @returns {Object} Validated enrichment
 */
function validateEnrichment(enrichment) {
  const validCategories = [
    'data', 'tables', 'workspace', 'widgets', 'analysis',
    'system', 'architecture', 'security', 'testing', 'devops',
    'game-development', 'frontend', 'backend', 'mobile', 'ai-ml'
  ];

  const validRiskLevels = ['low', 'medium', 'high'];

  const validPlatforms = ['claude-code', 'cursor', 'windsurf', 'copilot', 'god-crm'];

  // Validate tags
  let tags = Array.isArray(enrichment.tags) ? enrichment.tags : [];
  tags = tags
    .filter(t => typeof t === 'string')
    .map(t => t.toLowerCase().trim())
    .slice(0, 8);

  // Validate risk_level
  const risk_level = validRiskLevels.includes(enrichment.risk_level)
    ? enrichment.risk_level
    : 'unknown';

  // Validate rating (1-5)
  let rating = parseInt(enrichment.rating, 10);
  if (isNaN(rating) || rating < 1) rating = 1;
  if (rating > 5) rating = 5;

  // Validate category
  const category = validCategories.includes(enrichment.category)
    ? enrichment.category
    : 'system';

  // Validate platform
  let platform = Array.isArray(enrichment.platform) ? enrichment.platform : [];
  platform = platform.filter(p => validPlatforms.includes(p));
  if (platform.length === 0) platform = ['claude-code'];

  return { tags, risk_level, rating, category, platform };
}

/**
 * Enrich a skill row with AI-generated metadata
 * @param {Object} rowData - The row data object (name, description, category, tags, risk_level, rating, platform, source)
 * @returns {Promise<{success: boolean, enrichment?: Object, error?: string}>}
 */
export async function enrichSkill(rowData) {
  const startTime = Date.now();

  try {
    // Get API key from database
    const apiKey = await getAnthropicApiKey();
    if (!apiKey) {
      return { success: false, error: 'No active Anthropic API key found in ai_api_keys table' };
    }

    // Build prompt
    const prompt = buildPrompt(rowData);

    // Call Claude
    const rawEnrichment = await callClaude(apiKey, prompt);

    // Validate and normalize
    const enrichment = validateEnrichment(rawEnrichment);

    const durationMs = Date.now() - startTime;
    apiLogger.info(
      { skill: rowData.name || rowData.skill_name, durationMs, enrichment },
      '[SkillEnrichment] Successfully enriched skill'
    );

    return { success: true, enrichment, durationMs };
  } catch (err) {
    const durationMs = Date.now() - startTime;
    apiLogger.error(
      { err, skill: rowData.name || rowData.skill_name, durationMs },
      '[SkillEnrichment] Failed to enrich skill'
    );
    return { success: false, error: err.message, durationMs };
  }
}

export default { enrichSkill };
