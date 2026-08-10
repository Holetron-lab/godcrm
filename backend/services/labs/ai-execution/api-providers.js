/**
 * API-based AI provider execution functions and data helpers.
 *
 * Includes:
 * - getApiKeyForOperator, getOperatorDetails, getAgentDetails
 * - executeOpenAI, executeAnthropic, executeGoogle
 *
 * Extracted from ai-execution-service.js
 */

import { dbGet } from '../../../database/connection.js';
import { apiLogger } from '../../../utils/logger.js';

/**
 * Safe JSON parse helper
 */
function safeParseJSON(str, defaultValue = {}) {
  if (typeof str === 'object') return str;
  try {
    return JSON.parse(str);
  } catch {
    return defaultValue;
  }
}

/**
 * Get API key for an operator
 * @param {number} operatorId - Operator ID
 * @returns {Promise<string|null>} API key or null
 */
export async function getApiKeyForOperator(operatorId) {
  if (!operatorId) return null;

  try {
    // Try to find API key in AI API Keys table
    const keyRow = await dbGet(`
      SELECT tr.data
      FROM table_rows tr
      JOIN universal_tables ut ON tr.table_id = ut.id
      WHERE ut.name LIKE '%API Keys%'
        AND json_extract(tr.data, '$.operator_id') = ?
        AND json_extract(tr.data, '$.status') = 'active'
      ORDER BY tr.created_at DESC
      LIMIT 1
    `, [String(operatorId)]);

    if (keyRow) {
      const keyData = safeParseJSON(keyRow.data, {});
      return keyData.api_key;
    }
  } catch (err) {
    apiLogger.warn({ err, operatorId }, 'Failed to get API key from table');
  }

  return null;
}

/**
 * Get operator details
 * @param {number} operatorId - Operator ID (row ID in table_rows)
 * @returns {Promise<Object|null>} Operator data or null
 */
export async function getOperatorDetails(operatorId) {
  if (!operatorId) return null;

  try {
    // Primary: Get from table_rows (universal_tables system)
    const operatorRow = await dbGet(`
      SELECT tr.id, tr.data
      FROM table_rows tr
      JOIN universal_tables ut ON tr.table_id = ut.id
      WHERE tr.id = ? AND (ut.name LIKE '%Operators%' OR ut.name LIKE '%Providers%')
    `, [operatorId]);

    if (operatorRow) {
      const data = safeParseJSON(operatorRow.data, {});
      return {
        id: operatorId,
        name: data.name,
        provider: data.provider || data.api_identifier || 'openai',
        apiUrl: data.api_url,
        defaultModel: data.default_model,
        supportedModels: data.supported_models || []
      };
    }

    // Fallback: Try direct ai_operators table (for backwards compatibility)
    const operator = await dbGet(`
      SELECT id, name, description, integration_key, default_model,
             supported_models, api_url, provider
      FROM ai_operators
      WHERE id = ?
    `, [operatorId]).catch(() => null);

    if (operator) {
      return {
        id: operator.id,
        name: operator.name,
        provider: operator.provider || operator.integration_key || 'openai',
        apiUrl: operator.api_url,
        defaultModel: operator.default_model,
        supportedModels: safeParseJSON(operator.supported_models, [])
      };
    }
  } catch (err) {
    apiLogger.warn({ err, operatorId }, 'Failed to get operator details');
  }

  return null;
}

/**
 * Get AI agent details
 * @param {number} agentId - Agent ID
 * @returns {Promise<Object|null>} Agent data or null
 */
export async function getAgentDetails(agentId) {
  if (!agentId) return null;

  try {
    // First try ai_agents table
    const agent = await dbGet(`
      SELECT a.*, o.name as operator_name, o.integration_key, o.default_model, o.provider
      FROM ai_agents a
      LEFT JOIN ai_operators o ON a.operator_id = o.id
      WHERE a.id = ?
    `, [agentId]);

    if (agent) {
      return {
        id: agent.id,
        name: agent.name,
        systemPrompt: agent.system_prompt,
        operatorId: agent.operator_id,
        operatorName: agent.operator_name,
        provider: agent.provider || agent.integration_key || 'openai',
        model: agent.model || agent.default_model || 'gpt-4o-mini',
        temperature: agent.temperature || 0.7,
        maxTokens: agent.max_tokens || 2000,
        // ADR-091: global response_mode (not available from legacy ai_agents table, default to mention_only)
        responseMode: agent.response_mode || 'mention_only'
      };
    }

    // Fallback to table_rows
    const agentRow = await dbGet(`
      SELECT tr.data
      FROM table_rows tr
      JOIN universal_tables ut ON tr.table_id = ut.id
      WHERE tr.id = ? AND ut.name LIKE '%Agents%'
    `, [agentId]);

    if (agentRow) {
      const data = safeParseJSON(agentRow.data, {});
      return {
        id: agentId,
        name: data.name,
        systemPrompt: data.system_prompt,
        operatorId: data.operator_id,
        model: data.model || 'gpt-4o-mini',
        temperature: data.temperature || 0.7,
        maxTokens: data.max_tokens || 2000,
        // ADR-091: global response_mode from AI Agents table (default: mention_only)
        responseMode: data.response_mode || 'mention_only'
      };
    }
  } catch (err) {
    apiLogger.warn({ err, agentId }, 'Failed to get agent details');
  }

  return null;
}

/**
 * Execute AI request using OpenAI API
 * @param {Object} params - Execution parameters
 * @returns {Promise<Object>} Execution result
 */
export async function executeOpenAI(params) {
  const { apiKey, model, messages, temperature, maxTokens, apiUrl } = params;

  const baseUrl = apiUrl || 'https://api.openai.com/v1';

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      messages,
      temperature,
      max_tokens: maxTokens
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI API error: ${errorText}`);
  }

  const data = await response.json();

  return {
    content: data.choices?.[0]?.message?.content || '',
    usage: {
      promptTokens: data.usage?.prompt_tokens || 0,
      completionTokens: data.usage?.completion_tokens || 0,
      totalTokens: data.usage?.total_tokens || 0
    },
    model: data.model,
    finishReason: data.choices?.[0]?.finish_reason
  };
}

/**
 * Execute AI request using Anthropic API
 * @param {Object} params - Execution parameters
 * @returns {Promise<Object>} Execution result
 */
export async function executeAnthropic(params) {
  const { apiKey, model, messages, systemPrompt, maxTokens } = params;

  // Convert messages to Anthropic format (no system role in messages)
  const anthropicMessages = messages
    .filter(m => m.role !== 'system')
    .map(m => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.content
    }));

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system: systemPrompt || 'You are a helpful assistant.',
      messages: anthropicMessages
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Anthropic API error: ${errorText}`);
  }

  const data = await response.json();

  return {
    content: data.content?.[0]?.text || '',
    usage: {
      promptTokens: data.usage?.input_tokens || 0,
      completionTokens: data.usage?.output_tokens || 0,
      totalTokens: (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0)
    },
    model: data.model,
    finishReason: data.stop_reason
  };
}

/**
 * Execute AI request using Google Gemini API
 * @param {Object} params - Execution parameters
 * @returns {Promise<Object>} Execution result
 */
export async function executeGoogle(params) {
  const { apiKey, model, messages, systemPrompt, maxTokens, temperature } = params;

  // Convert messages to Gemini format
  const contents = messages
    .filter(m => m.role !== 'system')
    .map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }]
    }));

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        contents,
        systemInstruction: systemPrompt ? { parts: [{ text: systemPrompt }] } : undefined,
        generationConfig: {
          temperature,
          maxOutputTokens: maxTokens
        }
      })
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Google API error: ${errorText}`);
  }

  const data = await response.json();

  return {
    content: data.candidates?.[0]?.content?.parts?.[0]?.text || '',
    usage: {
      promptTokens: data.usageMetadata?.promptTokenCount || 0,
      completionTokens: data.usageMetadata?.candidatesTokenCount || 0,
      totalTokens: data.usageMetadata?.totalTokenCount || 0
    },
    model,
    finishReason: data.candidates?.[0]?.finishReason
  };
}
