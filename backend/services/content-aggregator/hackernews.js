// backend/services/content-aggregator/hackernews.js
// Hacker News parser for Content Aggregation Service

import { HN_API } from './config.js';
import { log, matchesAIKeywords, fetchJSON } from './helpers.js';

/**
 * Fetch and filter top AI/tech stories from Hacker News
 * @param {number} limit - Maximum stories to return (default 10)
 * @returns {Promise<Array<{title, url, score, author, time, source}>>}
 */
export async function fetchHackerNews(limit = 10) {
  log.info('Fetching Hacker News top stories...');

  try {
    // Get top story IDs
    const storyIds = await fetchJSON(`${HN_API}/topstories.json`);

    if (!Array.isArray(storyIds)) {
      log.warn('HN topstories response is not an array');
      return [];
    }

    // Fetch story details in batches (top 60 to get enough after filtering)
    const batchSize = 60;
    const topIds = storyIds.slice(0, batchSize);

    const stories = await Promise.allSettled(
      topIds.map(id => fetchJSON(`${HN_API}/item/${id}.json`))
    );

    const results = [];

    for (const result of stories) {
      if (result.status !== 'fulfilled' || !result.value) continue;

      const story = result.value;
      if (!story.title || story.type !== 'story') continue;

      // Check if title or URL matches AI keywords
      const titleMatch = matchesAIKeywords(story.title);
      const urlMatch = matchesAIKeywords(story.url || '');

      if (titleMatch || urlMatch) {
        results.push({
          title: story.title,
          url: story.url || `https://news.ycombinator.com/item?id=${story.id}`,
          score: story.score || 0,
          author: story.by || 'unknown',
          time: story.time ? new Date(story.time * 1000).toISOString() : new Date().toISOString(),
          source: 'hackernews',
          source_id: `hn_${story.id}`,
        });
      }

      if (results.length >= limit) break;
    }

    // Sort by score descending
    results.sort((a, b) => b.score - a.score);

    log.info({ count: results.length }, 'Hacker News: fetched AI/tech stories');
    return results.slice(0, limit);
  } catch (err) {
    log.error({ err: err.message }, 'Hacker News: fetch failed');
    return [];
  }
}
