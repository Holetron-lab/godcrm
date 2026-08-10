/**
 * Main AI execution functions (executeAI, executeSimpleAI).
 *
 * Extracted from ai-execution-service.js
 */

import { apiLogger } from '../../../utils/logger.js';
import { getSecret } from '../../secrets/getSecret.js';
import {
  getAgentDetails,
  getOperatorDetails,
  getApiKeyForOperator,
  executeOpenAI,
  executeAnthropic,
  executeGoogle,
} from './api-providers.js';
import { executeClaudeCode } from './cli-providers.js';

/**
 * Main AI execution function
 * @param {Object} options - Execution options
 * @param {number} options.agentId - AI Agent ID
 * @param {string} options.input - Input text/prompt
 * @param {string} [options.systemPrompt] - Override system prompt
 * @param {number} [options.temperature] - Override temperature
 * @param {number} [options.maxTokens] - Override max tokens
 * @param {string} [options.model] - Override model
 * @param {Array} [options.history] - Conversation history
 * @returns {Promise<Object>} Execution result
 */
export async function executeAI(options) {
  const { agentId, input, systemPrompt, temperature, maxTokens, model, history = [] } = options;

  const startTime = Date.now();

  try {
    // Get agent details
    const agent = await getAgentDetails(agentId);
    if (!agent) {
      return {
        success: false,
        error: `AI agent ${agentId} not found`
      };
    }

    // Get operator details
    const operator = await getOperatorDetails(agent.operatorId);

    // Get API key (not needed for local providers like claude-code)
    const providerType = operator?.provider || agent.provider || 'openai';
    let apiKey = null;

    if (providerType !== 'claude-code') {
      apiKey = await getApiKeyForOperator(agent.operatorId);
      if (!apiKey) {
        // ADR-0040: vault first, env fallback during transition.
        if (providerType === 'anthropic') {
          apiKey = await getSecret('anthropic_api_key', 'ANTHROPIC_API_KEY');
        } else if (providerType === 'google') {
          apiKey = await getSecret('gemini_api_key', ['GEMINI_API_KEY', 'GOOGLE_AI_API_KEY', 'GOOGLE_API_KEY']);
        } else {
          apiKey = await getSecret('openai_api_key', 'OPENAI_API_KEY');
        }
      }

      if (!apiKey) {
        return {
          success: false,
          error: 'No API key configured for this agent'
        };
      }
    }

    // Determine provider
    const finalModel = model || agent.model || operator?.defaultModel || 'gpt-4o-mini';
    const provider = operator?.provider || agent.provider || 'openai';
    const isClaudeCode = provider === 'claude-code';
    const isAnthropic = !isClaudeCode && (finalModel.includes('claude') || provider === 'anthropic');
    const isGoogle = finalModel.includes('gemini') || provider === 'google';

    // Build messages
    const finalSystemPrompt = systemPrompt || agent.systemPrompt || 'You are a helpful assistant.';
    const messages = [
      { role: 'system', content: finalSystemPrompt },
      ...history,
      { role: 'user', content: input }
    ];

    // Execute based on provider
    const params = {
      apiKey,
      model: finalModel,
      messages,
      systemPrompt: finalSystemPrompt,
      temperature: temperature ?? agent.temperature ?? 0.7,
      maxTokens: maxTokens ?? agent.maxTokens ?? 2000,
      apiUrl: operator?.apiUrl
    };

    let result;
    let actualProvider;
    if (isClaudeCode) {
      result = await executeClaudeCode(params);
      actualProvider = 'claude-code';
    } else if (isAnthropic) {
      result = await executeAnthropic(params);
      actualProvider = 'anthropic';
    } else if (isGoogle) {
      result = await executeGoogle(params);
      actualProvider = 'google';
    } else {
      result = await executeOpenAI(params);
      actualProvider = 'openai';
    }

    const executionTime = Date.now() - startTime;

    apiLogger.info({
      agentId,
      model: finalModel,
      provider: actualProvider,
      tokensUsed: result.usage.totalTokens,
      executionTime
    }, 'AI execution completed');

    return {
      success: true,
      content: result.content,
      usage: result.usage,
      model: result.model || finalModel,
      provider: actualProvider,
      executionTime,
      finishReason: result.finishReason,
      agentId,
      agentName: agent.name
    };

  } catch (error) {
    apiLogger.error({ error, agentId }, 'AI execution failed');
    return {
      success: false,
      error: error.message || 'AI execution failed',
      executionTime: Date.now() - startTime
    };
  }
}

/**
 * Execute AI with simple text input (no agent required)
 * Uses default operator or environment API key
 * @param {Object} options - Execution options
 * @param {string} options.input - Input text
 * @param {string} [options.systemPrompt] - System prompt
 * @param {string} [options.model] - Model to use
 * @param {number} [options.temperature] - Temperature
 * @param {number} [options.maxTokens] - Max tokens
 * @param {string} [options.provider] - Provider (openai, anthropic, google)
 * @returns {Promise<Object>} Execution result
 */
export async function executeSimpleAI(options) {
  let {
    input,
    systemPrompt = 'You are a helpful assistant.',
    model = 'gpt-4o-mini',
    temperature = 0.7,
    maxTokens = 2000,
    provider = 'openai',
    operatorId
  } = options;

  const startTime = Date.now();

  try {
    // If operatorId provided, get operator details
    if (operatorId) {
      const operator = await getOperatorDetails(operatorId);
      if (operator) {
        provider = operator.provider || provider;
        model = operator.defaultModel || model;
        apiLogger.debug({ operatorId, provider, model }, 'Got operator details');
      }
    }

    // Claude Code CLI doesn't need API key - it's local
    if (provider === 'claude-code') {
      const messages = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: input }
      ];

      const params = { model, messages, systemPrompt, maxTokens };
      const result = await executeClaudeCode(params);
      const executionTime = Date.now() - startTime;

      return {
        success: true,
        content: result.content,
        usage: result.usage,
        model: result.model || model,
        provider: 'claude-code',
        executionTime,
        finishReason: result.finishReason
      };
    }

    // ADR-0040: vault first, env fallback during transition.
    let apiKey;
    if (provider === 'anthropic') {
      apiKey = await getSecret('anthropic_api_key', 'ANTHROPIC_API_KEY');
    } else if (provider === 'google') {
      apiKey = await getSecret('gemini_api_key', ['GEMINI_API_KEY', 'GOOGLE_AI_API_KEY', 'GOOGLE_API_KEY']);
    } else {
      apiKey = await getSecret('openai_api_key', 'OPENAI_API_KEY');
    }

    if (!apiKey) {
      return {
        success: false,
        error: `No API key configured for provider: ${provider}`
      };
    }

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: input }
    ];

    const params = {
      apiKey,
      model,
      messages,
      systemPrompt,
      temperature,
      maxTokens
    };

    let result;
    if (provider === 'anthropic') {
      result = await executeAnthropic(params);
    } else if (provider === 'google') {
      result = await executeGoogle(params);
    } else {
      result = await executeOpenAI(params);
    }

    const executionTime = Date.now() - startTime;

    return {
      success: true,
      content: result.content,
      usage: result.usage,
      model: result.model || model,
      provider,
      executionTime,
      finishReason: result.finishReason
    };

  } catch (error) {
    apiLogger.error({ error, provider }, 'Simple AI execution failed');
    return {
      success: false,
      error: error.message || 'AI execution failed',
      executionTime: Date.now() - startTime
    };
  }
}
