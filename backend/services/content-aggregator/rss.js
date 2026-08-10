// backend/services/content-aggregator/rss.js
// RSS Feed parser for Content Aggregation Service

import RssParser from 'rss-parser';
import { DEFAULT_RSS_FEEDS } from './config.js';
import { log, truncate } from './helpers.js';

/**
 * Parse RSS feeds from a configurable list of URLs
 * @param {string[]} feedUrls - List of RSS feed URLs (defaults to DEFAULT_RSS_FEEDS)
 * @param {number} limit - Max items to return (default 30)
 * @returns {Promise<Array<{title, url, description, pubDate, source, source_id}>>}
 */
export async function fetchRSSFeeds(feedUrls = DEFAULT_RSS_FEEDS, limit = 30) {
  log.info({ feedCount: feedUrls.length }, 'Fetching RSS feeds...');

  const parser = new RssParser({
    timeout: 15000,
    headers: {
      'User-Agent': 'GOD-CRM-ContentAggregator/1.0 (+https://devcrm.hltrn.cc)',
    },
  });

  const allItems = [];

  const feedResults = await Promise.allSettled(
    feedUrls.map(async (url) => {
      try {
        const feed = await parser.parseURL(url);
        const sourceName = feed.title || new URL(url).hostname;

        return (feed.items || []).map(item => ({
          title: item.title || 'Untitled',
          url: item.link || item.guid || url,
          description: truncate(item.contentSnippet || item.content || item.summary || '', 500),
          pubDate: item.isoDate || item.pubDate || new Date().toISOString(),
          source: 'rss',
          source_name: sourceName,
          source_id: `rss_${Buffer.from(item.link || item.guid || item.title || '').toString('base64').slice(0, 40)}`,
        }));
      } catch (err) {
        log.warn({ url, err: err.message }, 'RSS: failed to parse feed');
        return [];
      }
    })
  );

  for (const result of feedResults) {
    if (result.status === 'fulfilled') {
      allItems.push(...result.value);
    }
  }

  // Sort by pubDate descending
  allItems.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));

  // Limit results to avoid overwhelming CRM with hundreds of items per run
  const limited = allItems.slice(0, limit);

  log.info({ total: allItems.length, returned: limited.length }, 'RSS: fetched items');
  return limited;
}
