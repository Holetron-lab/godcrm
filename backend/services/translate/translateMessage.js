// backend/services/translate/translateMessage.js
// ADR-185 — per-message translation via the conversation's configured agent.
//
// "Resolve the translator agent selected in chat-panel settings, call it with
// content + target_lang" (ADR-185 §Decision.3). We reuse the space's configured
// «Агент по умолчанию» (getTranslationAgentForConversation, which honors
// spaces.settings.default_agent_id and falls back to the first active agent)
// rather than building a new setting — Ponytail: no new plumbing for a mapping
// that already exists.
// The completion primitive is callAgentAI (the same one auto-respond uses),
// which resolves the agent's provider/model and handles the keyless local
// claude-code path as well as API providers.

import { LANGUAGE_NAMES } from '../../routes/v3/documents/_helpers.js';
import { getTranslationAgentForConversation } from '../../routes/v3/chat/chatAgentAutoRespondDefaults.js';
import { callAgentAI } from '../../routes/v3/chat/chatAgentDelegation.js';
import { apiLogger } from '../../utils/logger.js';

/** True if `code` is a valid translation target (one of the 15 LANGUAGE_NAMES). */
export function isSupportedTargetLang(code) {
  return typeof code === 'string' && Object.prototype.hasOwnProperty.call(LANGUAGE_NAMES, code);
}

/**
 * callAgentAI has a polymorphic return: a plain string, `{ text, thinking }`
 * (anthropic + thinking), `{ success: true, content }` (claude-code), or an
 * error object `{ success: false, error, message }`, or null. Collapse all of
 * them into one shape so the caller never has to branch on it.
 * @returns {{ ok: true, text: string } | { ok: false, error: string, message: string }}
 */
export function normalizeAiReturn(raw) {
  if (raw == null) return { ok: false, error: 'empty_translation', message: 'empty AI response' };

  if (typeof raw === 'string') {
    const t = raw.trim();
    return t ? { ok: true, text: t } : { ok: false, error: 'empty_translation', message: 'empty AI response' };
  }

  if (typeof raw === 'object') {
    if (raw.success === false) {
      return { ok: false, error: raw.error || 'ai_error', message: raw.message || 'AI call failed' };
    }
    const candidate = raw.content ?? raw.text;
    if (typeof candidate === 'string' && candidate.trim()) {
      return { ok: true, text: candidate.trim() };
    }
    return { ok: false, error: 'empty_translation', message: 'empty AI response' };
  }

  return { ok: false, error: 'bad_shape', message: 'unexpected AI response shape' };
}

function buildTranslatePrompt(targetLang) {
  const langName = LANGUAGE_NAMES[targetLang] || targetLang;
  return (
    `You are a translation engine. Translate the user's message into ${langName} (${targetLang}). ` +
    `Preserve markdown, fenced code blocks, links, line breaks and emoji exactly. ` +
    `Do NOT translate content inside code fences. ` +
    `Output ONLY the translation — no preamble, no explanation, no surrounding quotes.`
  );
}

/**
 * Translate a message's text into targetLang using the conversation's agent.
 * @param {{ conversationId: number|string, sourceText: string, targetLang: string }} args
 * @returns {Promise<{ success: true, text: string, agent: { name: string|null, row_id: number|null } }
 *                   | { success: false, error: string, message: string }>}
 */
export async function translateMessageText({ conversationId, sourceText, targetLang }) {
  const source = (sourceText || '').trim();
  if (!source) return { success: false, error: 'empty_source', message: 'nothing to translate' };
  if (!isSupportedTargetLang(targetLang)) {
    return { success: false, error: 'bad_target_lang', message: `unsupported target_lang "${targetLang}"` };
  }

  const agent = await getTranslationAgentForConversation(conversationId);
  if (!agent) {
    return {
      success: false,
      error: 'no_agent',
      message: 'no active agent is configured for this conversation to perform the translation',
    };
  }

  const systemPrompt = buildTranslatePrompt(targetLang);
  const agentConfig = agent._agentConfig || {};

  let raw;
  try {
    raw = await callAgentAI(agent, source, [], systemPrompt, agentConfig, {});
  } catch (err) {
    apiLogger.error({ err: err?.message, conversationId, targetLang }, '[ADR-185] translate agent call threw');
    return { success: false, error: 'exception', message: `translation failed: ${err?.message || 'unknown error'}` };
  }

  const norm = normalizeAiReturn(raw);
  if (!norm.ok) {
    apiLogger.warn({ conversationId, targetLang, error: norm.error }, '[ADR-185] translate produced no text');
    return { success: false, error: norm.error, message: norm.message };
  }

  return {
    success: true,
    text: norm.text,
    agent: { name: agent.name || null, row_id: agent.managed_by_agent_row_id || null },
  };
}
