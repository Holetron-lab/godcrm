// backend/services/content-aggregator/news-processing.js
// AI-powered news processing and Telegram publishing

import { log, matchesAIKeywords } from './helpers.js';
import { aggregateContent } from './aggregator.js';
import { getSecret } from '../secrets/getSecret.js';

// Digest topic — everything lands in one place now ("IT News", thread 877).
// Overridable per-automation via action_config.topic so retuning the feed is a
// DB edit, not a deploy.
const DEFAULT_DIGEST_TOPIC = 'ai_news';

// Cheap summariser/translator. Not the agent loop: one stateless completion per
// item, no tools, no file access.
const SUMMARY_MODEL = process.env.NEWS_DIGEST_MODEL || 'gpt-4o-mini';

const SUMMARY_SYSTEM_PROMPT =
  'You are the editor of a private IT/AI news feed for a Russian-speaking founder. ' +
  'For the item you are given, write a factual summary: what happened and why it matters. ' +
  '2-3 sentences, no hype, no marketing, no filler like "this article discusses". ' +
  'Then translate that summary into Russian — same meaning, natural Russian, keep product ' +
  'and company names in Latin script. ' +
  'Reply with JSON only: {"summary_en": "...", "summary_ru": "..."}';

/**
 * Process a news item with AI: generate summary, clean text, reliability score
 * Uses Claude API if available, otherwise falls back to simple extraction
 * @param {object} item - Raw content item {title, url, description, source, score}
 * @returns {Promise<object>} Enhanced item with ai_summary, clean_text, reliability
 */
export async function processNewsWithAI(item) {
  const enhanced = {
    ...item,
    ai_summary: '',
    clean_text: '',
    reliability_score: 0,
    reliability_label: '',
    fact_check_notes: '',
  };

  // Clean the raw text (remove HTML, ads, tracking params)
  const rawText = item.description || item.selftext || item.body || '';
  enhanced.clean_text = rawText
    .replace(/<[^>]*>/g, '')        // strip HTML tags
    .replace(/\[.*?\]\(.*?\)/g, '') // strip markdown links but keep text
    .replace(/https?:\/\/\S+/g, '') // strip URLs from body
    .replace(/\s+/g, ' ')          // normalize whitespace
    .trim();

  // Generate summary (first 2-3 sentences or 200 chars)
  const sentences = enhanced.clean_text.split(/[.!?]+/).filter(s => s.trim().length > 10);
  enhanced.ai_summary = sentences.slice(0, 3).join('. ').trim();
  if (enhanced.ai_summary && !enhanced.ai_summary.endsWith('.')) {
    enhanced.ai_summary += '.';
  }
  if (!enhanced.ai_summary) {
    enhanced.ai_summary = enhanced.clean_text.slice(0, 200);
  }

  // Reliability scoring based on source reputation + metadata
  const sourceScores = {
    'openai.com': 90, 'blog.google': 90, 'anthropic.com': 90,
    'huggingface.co': 85, 'techcrunch.com': 80, 'the-decoder.com': 75,
    'arxiv.org': 95, 'nature.com': 95, 'science.org': 95,
    'reuters.com': 90, 'apnews.com': 90, 'bbc.com': 85,
    'hackernews': 70, 'reddit': 50,
  };

  // Determine source domain or platform
  let sourceDomain = item.source || '';
  if (item.url) {
    try { sourceDomain = new URL(item.url).hostname.replace('www.', ''); } catch { /* Keep the supplied source when the URL cannot be parsed. */ }
  }

  let score = sourceScores[sourceDomain] || sourceScores[item.source] || 50;

  // Boost if high engagement
  if (item.score > 500) score = Math.min(score + 10, 100);
  if (item.score > 1000) score = Math.min(score + 5, 100);

  // Penalize if no description/body
  if (!rawText || rawText.length < 50) score = Math.max(score - 15, 10);

  enhanced.reliability_score = score;
  enhanced.reliability_label =
    score >= 85 ? 'Высокая надёжность' :
    score >= 65 ? 'Средняя надёжность' :
    score >= 40 ? 'Проверьте источник' :
    'Низкая надёжность';

  // Fact-check notes (basic heuristics)
  const notes = [];
  if (score >= 85) notes.push('Авторитетный источник');
  if (item.source === 'arxiv.org') notes.push('Научная публикация (peer review)');
  if (item.score > 200) notes.push(`Высокая вовлечённость (${item.score} points)`);
  if (!rawText) notes.push('Нет описания — только заголовок');
  if (item.source === 'reddit' && item.score < 100) notes.push('Мало голосов на Reddit');
  enhanced.fact_check_notes = notes.join(' | ');

  return enhanced;
}

/** Escape the three characters Telegram's HTML parse mode cares about. */
function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Strip ```json fences an LLM may wrap the payload in. */
function stripCodeFence(text) {
  return String(text || '').replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
}

/**
 * Write a real summary of the item and its Russian translation.
 * One stateless OpenAI completion; on any failure the caller falls back to the
 * heuristic `ai_summary` and simply publishes without the spoiler block.
 * @param {object} item - Processed item from processNewsWithAI
 * @returns {Promise<{summary_en: string, summary_ru: string}|null>}
 */
export async function summariseAndTranslate(item) {
  const apiKey = await getSecret('openai_api_key', 'OPENAI_API_KEY');
  if (!apiKey) {
    log.warn('news digest: no OpenAI key — publishing without summary/translation');
    return null;
  }

  const body = [
    `TITLE: ${item.title || ''}`,
    `SOURCE: ${item.source_name || item.source || ''}`,
    `URL: ${item.url || ''}`,
    `TEXT: ${(item.clean_text || '').slice(0, 1500)}`,
  ].join('\n');

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: SUMMARY_MODEL,
        max_tokens: 600,
        temperature: 0.2,
        messages: [
          { role: 'system', content: SUMMARY_SYSTEM_PROMPT },
          { role: 'user', content: body },
        ],
      }),
    });

    if (!response.ok) {
      log.warn({ status: response.status }, 'news digest: summariser HTTP error');
      return null;
    }

    const data = await response.json();
    const raw = stripCodeFence(data?.choices?.[0]?.message?.content);
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    const en = String(parsed.summary_en || '').trim();
    const ru = String(parsed.summary_ru || '').trim();
    if (!en && !ru) return null;

    return { summary_en: en, summary_ru: ru };
  } catch (err) {
    log.warn({ err: err.message, title: item.title }, 'news digest: summarise/translate failed');
    return null;
  }
}

/**
 * Format a processed news item for the Telegram digest topic.
 * Layout: title → summary → Russian translation hidden under a spoiler →
 * one metadata line. Telegram HTML parse mode (`<tg-spoiler>` has no Markdown
 * equivalent, which is why this is not Markdown).
 * @param {object} item - Processed item, optionally carrying summary_en/summary_ru
 * @returns {string} Formatted Telegram message (HTML)
 */
export function formatNewsForTopic(item) {
  const lines = [];
  const marker = item.is_ai ? '🤖' : '🖥';

  lines.push(`${marker} <b>${escapeHtml(item.title || 'Untitled')}</b>`);
  lines.push('');

  const summary = item.summary_en || item.ai_summary;
  if (summary) {
    lines.push(escapeHtml(summary));
    lines.push('');
  }

  // Russian translation — collapsed, so the topic stays scannable in one language.
  if (item.summary_ru) {
    lines.push(`<tg-spoiler>🇷🇺 ${escapeHtml(item.summary_ru)}</tg-spoiler>`);
    lines.push('');
  }

  const reliabilityEmoji =
    item.reliability_score >= 85 ? '🟢' :
    item.reliability_score >= 65 ? '🟡' :
    item.reliability_score >= 40 ? '🟠' : '🔴';

  const meta = [`${reliabilityEmoji} ${item.reliability_score}/100`];
  if (item.source_name || item.source) meta.push(escapeHtml(item.source_name || item.source));
  if (item.score) meta.push(`${item.score} pts`);
  if (item.url) meta.push(`<a href="${escapeHtml(item.url)}">источник</a>`);
  lines.push(meta.join(' · '));

  return lines.join('\n');
}

/**
 * Aggregate, summarise, translate and publish news to a single Telegram topic.
 * Both feeds were merged into "IT News" (2026-09-07) — the old split between the
 * `news` and `ai_news` topics is gone; `news` is now free for a separate,
 * non-IT feed.
 * @param {object} options - { sources, maxItems, topic }
 * @returns {Promise<object>} Summary of processed and published items
 */
export async function aggregateAndPublishNews(options = {}) {
  const { sources = ['hackernews', 'rss', 'reddit'], maxItems = 5, topic = DEFAULT_DIGEST_TOPIC } = options;
  const { sendToTopic } = await import('../TelegramService.js');

  log.info({ sources, maxItems }, 'Starting AI news aggregation pipeline...');

  // Step 1: Aggregate raw content
  const aggregationResult = await aggregateContent(sources);

  if (!aggregationResult.items || aggregationResult.items.length === 0) {
    log.info('No new items to process');
    return { processed: 0, published: 0, message: 'No new items' };
  }

  // Step 2: Process top items with AI
  const topItems = aggregationResult.items.slice(0, maxItems);
  const processed = [];

  for (const rawItem of topItems) {
    try {
      const enhanced = await processNewsWithAI(rawItem);
      enhanced.is_ai = matchesAIKeywords(`${enhanced.title} ${enhanced.ai_summary || ''}`);

      const written = await summariseAndTranslate(enhanced);
      if (written) {
        enhanced.summary_en = written.summary_en;
        enhanced.summary_ru = written.summary_ru;
      }

      processed.push(enhanced);
    } catch (err) {
      log.warn({ err: err.message, title: rawItem.title }, 'Failed to process item with AI');
    }
  }

  // Step 3: Publish — one topic for the whole digest
  let published = 0;
  let translated = 0;

  for (const item of processed) {
    const message = formatNewsForTopic(item);

    try {
      const result = await sendToTopic(topic, message, {
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      });
      if (result.success) {
        published++;
        if (item.summary_ru) translated++;
      } else {
        log.warn({ err: result.error, title: item.title }, 'Failed to publish to topic');
      }
      // Small delay between messages to avoid Telegram rate limits
      await new Promise(r => setTimeout(r, 1500));
    } catch (err) {
      log.warn({ err: err.message, title: item.title }, 'Failed to publish to topic');
    }
  }

  const summary = {
    total_aggregated: aggregationResult.total_fetched,
    total_new: aggregationResult.total_new,
    processed: processed.length,
    topic,
    published,
    translated,
    errors: aggregationResult.errors,
  };

  log.info(summary, 'AI news pipeline complete');
  return summary;
}
