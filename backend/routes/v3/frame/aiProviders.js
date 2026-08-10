/**
 * frame/aiProviders.js — AI provider resolution and API calls for Frame
 */

import { dbGet, isPostgres, safeJsonParse } from '../../../database/connection.js';
import { apiLogger } from '../../../utils/logger.js';
import { getSecret } from '../../../services/secrets/getSecret.js';
import {
  resolveAgentProvider as sharedResolveAgentProvider,
  detectProvider as sharedDetectProvider,
} from '../../../services/chat/agent-execution-shared.js';

/**
 * Build messages and call the AI provider (Anthropic Claude with Vision or OpenAI).
 */
export async function callFrameAI({ userText, imageBuffer, chatHistory = [], location, time }) {
  // Build the system prompt for Frame assistant
  const systemParts = [
    'You are Noa, a helpful AI assistant integrated into Brilliant Frame smart glasses.',
    'You see what the user sees through their glasses camera and hear what they say.',
    'Keep your responses concise and natural — they will be displayed on a small heads-up display and read aloud.',
    'Respond in the same language the user speaks to you.',
  ];

  if (location) {
    systemParts.push(`\n[CONTEXT] User location: ${location}`);
  }
  if (time) {
    systemParts.push(`[CONTEXT] Current time: ${time}`);
  }

  const systemPrompt = systemParts.join('\n');

  // ── Resolve AI provider ──────────────────────────────────────

  let apiKey = null;
  let model = 'claude-sonnet-4-20250514';
  let provider = 'anthropic';
  let apiUrl = 'https://api.anthropic.com/v1';

  // Priority 1: Look for a Frame/Noa-specific agent in the DB
  const frameAgentRow = await dbGet(
    isPostgres()
      ? `SELECT tr.data FROM table_rows tr
         JOIN universal_tables ut ON tr.table_id = ut.id
         WHERE ut.name LIKE '%Agents%'
           AND (tr.data::jsonb->>'name' ILIKE '%noa%' OR tr.data::jsonb->>'name' ILIKE '%frame%')
           AND tr.data::jsonb->>'status' = 'active'
         LIMIT 1`
      : `SELECT tr.data FROM table_rows tr
         JOIN universal_tables ut ON tr.table_id = ut.id
         WHERE ut.name LIKE '%Agents%'
           AND (LOWER(json_extract(tr.data, '$.name')) LIKE '%noa%' OR LOWER(json_extract(tr.data, '$.name')) LIKE '%frame%')
           AND json_extract(tr.data, '$.status') = 'active'
         LIMIT 1`
  );

  if (frameAgentRow) {
    const agentConfig = safeJsonParse(frameAgentRow.data, {});
    const resolved = await sharedResolveAgentProvider(agentConfig);
    if (resolved.apiKey) {
      apiKey = resolved.apiKey;
      model = resolved.model;
      provider = resolved.provider;
      const { isAnthropic } = sharedDetectProvider(provider, model);
      if (!isAnthropic) {
        apiUrl = 'https://api.openai.com/v1';
      }
    }
  }

  // Priority 2: Use vault keys (ADR-0040 — was process.env.{ANTHROPIC,OPENAI}_API_KEY)
  if (!apiKey) {
    apiKey = await getSecret('anthropic_api_key', 'ANTHROPIC_API_KEY');
  }
  if (!apiKey) {
    const openaiKey = await getSecret('openai_api_key', 'OPENAI_API_KEY');
    if (openaiKey) {
      apiKey = openaiKey;
      provider = 'openai';
      model = 'gpt-4o';
      apiUrl = 'https://api.openai.com/v1';
    }
  }

  // Priority 3: Find any active Anthropic or OpenAI operator in the DB
  if (!apiKey) {
    const operatorRow = await dbGet(
      isPostgres()
        ? `SELECT tr.data FROM table_rows tr
           JOIN universal_tables ut ON tr.table_id = ut.id
           WHERE ut.name LIKE '%Operators%'
             AND tr.data::jsonb->>'status' = 'active'
             AND (tr.data::jsonb->>'provider' IN ('anthropic', 'openai'))
           ORDER BY
             CASE WHEN tr.data::jsonb->>'provider' = 'anthropic' THEN 0 ELSE 1 END,
             tr.created_at ASC
           LIMIT 1`
        : `SELECT tr.data FROM table_rows tr
           JOIN universal_tables ut ON tr.table_id = ut.id
           WHERE ut.name LIKE '%Operators%'
             AND json_extract(tr.data, '$.status') = 'active'
             AND json_extract(tr.data, '$.provider') IN ('anthropic', 'openai')
           ORDER BY
             CASE WHEN json_extract(tr.data, '$.provider') = 'anthropic' THEN 0 ELSE 1 END,
             tr.created_at ASC
           LIMIT 1`
    );

    if (operatorRow) {
      const opData = safeJsonParse(operatorRow.data, {});
      apiKey = opData.api_key || null;
      provider = opData.provider || 'openai';
      model = opData.model || (provider === 'anthropic' ? 'claude-sonnet-4-20250514' : 'gpt-4o');
      apiUrl = opData.api_url || (provider === 'anthropic' ? 'https://api.anthropic.com/v1' : 'https://api.openai.com/v1');
    }
  }

  if (!apiKey) {
    throw new Error('No AI API key configured. Set ANTHROPIC_API_KEY or OPENAI_API_KEY, or add an operator in AI settings.');
  }

  const { isAnthropic } = sharedDetectProvider(provider, model);

  if (isAnthropic) {
    return callAnthropicVision({ systemPrompt, userText, imageBuffer, chatHistory, apiKey, model, apiUrl });
  } else {
    return callOpenAIVision({ systemPrompt, userText, imageBuffer, chatHistory, apiKey, model, apiUrl });
  }
}

/**
 * Call Anthropic Claude API with optional Vision content.
 */
async function callAnthropicVision({ systemPrompt, userText, imageBuffer, chatHistory, apiKey, model, apiUrl }) {
  const userContent = [];

  if (imageBuffer) {
    userContent.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: 'image/jpeg',
        data: imageBuffer.toString('base64')
      }
    });
  }

  userContent.push({
    type: 'text',
    text: userText || '(no speech detected — describe what you see in the image)'
  });

  const historyMessages = (chatHistory || [])
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .map(m => ({
      role: m.role,
      content: m.content
    }));

  const messages = [
    ...historyMessages,
    { role: 'user', content: userContent }
  ];

  const sanitized = sanitizeAnthropicMessages(messages);

  const requestBody = {
    model,
    max_tokens: 1024,
    system: systemPrompt,
    messages: sanitized
  };

  const messagesUrl = `${apiUrl.replace(/\/$/, '')}/messages`;

  const response = await fetch(messagesUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    const errText = await response.text();
    apiLogger.error({ status: response.status, error: errText, context: 'Frame Claude' }, 'Anthropic API error');
    throw new Error(`Claude API error (${response.status}): ${errText.substring(0, 300)}`);
  }

  const data = await response.json();

  const textBlocks = Array.isArray(data.content)
    ? data.content.filter(b => b?.type === 'text').map(b => b.text)
    : [];
  const responseText = textBlocks.join('\n') || '';

  return {
    message: responseText,
    topicChanged: false
  };
}

/**
 * Call OpenAI API with optional Vision content (GPT-4o style).
 */
async function callOpenAIVision({ systemPrompt, userText, imageBuffer, chatHistory, apiKey, model, apiUrl }) {
  const userContent = [];

  if (imageBuffer) {
    userContent.push({
      type: 'image_url',
      image_url: {
        url: `data:image/jpeg;base64,${imageBuffer.toString('base64')}`,
        detail: 'low'
      }
    });
  }

  userContent.push({
    type: 'text',
    text: userText || '(no speech detected — describe what you see in the image)'
  });

  const messages = [
    { role: 'system', content: systemPrompt },
    ...(chatHistory || []).filter(m => m.role === 'user' || m.role === 'assistant').map(m => ({
      role: m.role,
      content: m.content
    })),
    { role: 'user', content: userContent }
  ];

  const completionsUrl = `${apiUrl.replace(/\/$/, '')}/chat/completions`;

  const response = await fetch(completionsUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      messages,
      max_tokens: 1024
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    apiLogger.error({ status: response.status, error: errText, context: 'Frame OpenAI' }, 'OpenAI API error');
    throw new Error(`OpenAI API error (${response.status}): ${errText.substring(0, 300)}`);
  }

  const data = await response.json();
  const responseText = data.choices?.[0]?.message?.content || '';

  return {
    message: responseText,
    topicChanged: false
  };
}

/**
 * Sanitize messages for Anthropic API: ensure strict user/assistant alternation.
 */
function sanitizeAnthropicMessages(messages) {
  if (!messages.length) return [];

  const result = [];
  for (const msg of messages) {
    if (result.length === 0) {
      if (msg.role !== 'user') continue;
      result.push({ ...msg });
    } else {
      const prev = result[result.length - 1];
      if (prev.role === msg.role) {
        if (typeof prev.content === 'string' && typeof msg.content === 'string') {
          prev.content = prev.content + '\n' + msg.content;
        }
      } else {
        result.push({ ...msg });
      }
    }
  }

  if (result.length && result[result.length - 1].role !== 'user') {
    result.push({ role: 'user', content: '(continue)' });
  }

  return result;
}
