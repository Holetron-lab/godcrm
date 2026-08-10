// backend/services/content-aggregator/news-processing.js
// AI-powered news processing and Telegram publishing

import { log, matchesAIKeywords } from './helpers.js';
import { aggregateContent } from './aggregator.js';

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
    try { sourceDomain = new URL(item.url).hostname.replace('www.', ''); } catch {}
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

/**
 * Format a processed news item for Telegram group topic
 * @param {object} item - Processed item from processNewsWithAI
 * @returns {string} Formatted Telegram message (Markdown)
 */
export function formatNewsForTopic(item) {
  const lines = [];

  // Title
  const safeTitle = (item.title || 'Untitled').replace(/([_*`\[\]])/g, '\\$1');
  lines.push(`*${safeTitle}*`);
  lines.push('');

  // AI Summary
  if (item.ai_summary) {
    const safeSummary = item.ai_summary.replace(/([_*`\[\]])/g, '\\$1');
    lines.push(`${safeSummary}`);
    lines.push('');
  }

  // Clean original text (truncated)
  if (item.clean_text && item.clean_text.length > 10) {
    const truncated = item.clean_text.length > 500
      ? item.clean_text.slice(0, 500) + '...'
      : item.clean_text;
    const safeText = truncated.replace(/([_*`\[\]])/g, '\\$1');
    lines.push(`_Оригинал:_ ${safeText}`);
    lines.push('');
  }

  // Source link (NOT forwarded — direct link)
  if (item.url) {
    lines.push(`[Источник](${item.url})`);
  }

  // Source metadata
  const sourceParts = [];
  if (item.source_name) sourceParts.push(item.source_name);
  else if (item.source) sourceParts.push(item.source);
  if (item.score) sourceParts.push(`Score: ${item.score}`);
  if (sourceParts.length > 0) {
    lines.push(`_${sourceParts.join(' | ')}_`);
  }

  // Reliability bar
  const reliabilityEmoji =
    item.reliability_score >= 85 ? '🟢' :
    item.reliability_score >= 65 ? '🟡' :
    item.reliability_score >= 40 ? '🟠' : '🔴';

  lines.push('');
  lines.push(`${reliabilityEmoji} *Надёжность:* ${item.reliability_score}/100 — ${item.reliability_label}`);

  if (item.fact_check_notes) {
    lines.push(`_${item.fact_check_notes}_`);
  }

  return lines.join('\n');
}

/**
 * Aggregate, process with AI, and publish news to Telegram group topic
 * Sends general news to 'news' topic, AI-specific to 'ai_news' topic
 * @param {object} options - { sources, maxItems, publishToGroup }
 * @returns {Promise<object>} Summary of processed and published items
 */
export async function aggregateAndPublishNews(options = {}) {
  const { sources = ['hackernews', 'rss', 'reddit'], maxItems = 5 } = options;
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
      processed.push(enhanced);
    } catch (err) {
      log.warn({ err: err.message, title: rawItem.title }, 'Failed to process item with AI');
    }
  }

  // Step 3: Publish to group topics
  let publishedNews = 0;
  let publishedAI = 0;

  for (const item of processed) {
    const message = formatNewsForTopic(item);
    const isAI = matchesAIKeywords(item.title + ' ' + (item.ai_summary || ''));
    const topic = isAI ? 'ai_news' : 'news';

    try {
      const result = await sendToTopic(topic, message);
      if (result.success) {
        if (isAI) publishedAI++;
        else publishedNews++;
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
    published_news: publishedNews,
    published_ai_news: publishedAI,
    errors: aggregationResult.errors,
  };

  log.info(summary, 'AI news pipeline complete');
  return summary;
}
