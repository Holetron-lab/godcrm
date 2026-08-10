// backend/services/content-aggregator/aggregator.js
// Main content aggregation orchestrator

import { log, getCRMAuthToken } from './helpers.js';
import { fetchHackerNews } from './hackernews.js';
import { fetchRSSFeeds } from './rss.js';
import { fetchReddit } from './reddit.js';
import { getExistingTitles, storeInCRM } from './crm-storage.js';

/**
 * Main content aggregation function
 * Fetches from all specified sources, deduplicates, stores in CRM
 *
 * @param {string[]} sources - Sources to fetch from: 'hackernews', 'rss', 'reddit'
 * @returns {Promise<{
 *   total_fetched: number,
 *   total_new: number,
 *   total_stored: number,
 *   total_duplicates: number,
 *   by_source: object,
 *   errors: string[],
 *   items: Array
 * }>}
 */
export async function aggregateContent(sources = ['hackernews', 'rss', 'reddit']) {
  log.info({ sources }, 'Starting content aggregation...');

  const startTime = Date.now();
  const errors = [];
  const allItems = [];

  // Fetch from all sources in parallel
  const fetchPromises = [];

  if (sources.includes('hackernews')) {
    fetchPromises.push(
      fetchHackerNews(10).then(items => {
        allItems.push(...items);
        return { source: 'hackernews', count: items.length };
      }).catch(err => {
        errors.push(`hackernews: ${err.message}`);
        return { source: 'hackernews', count: 0 };
      })
    );
  }

  if (sources.includes('rss')) {
    fetchPromises.push(
      fetchRSSFeeds().then(items => {
        allItems.push(...items);
        return { source: 'rss', count: items.length };
      }).catch(err => {
        errors.push(`rss: ${err.message}`);
        return { source: 'rss', count: 0 };
      })
    );
  }

  if (sources.includes('reddit')) {
    fetchPromises.push(
      fetchReddit().then(items => {
        allItems.push(...items);
        return { source: 'reddit', count: items.length };
      }).catch(err => {
        errors.push(`reddit: ${err.message}`);
        return { source: 'reddit', count: 0 };
      })
    );
  }

  const sourceCounts = await Promise.all(fetchPromises);
  const bySource = {};
  for (const sc of sourceCounts) {
    bySource[sc.source] = { fetched: sc.count, stored: 0 };
  }

  log.info({ totalFetched: allItems.length }, 'All sources fetched, starting dedup...');

  // Get auth token for CRM
  const token = await getCRMAuthToken();

  // Get existing titles for deduplication
  const existingTitles = await getExistingTitles(token);

  // Also deduplicate within the batch itself
  const seenTitles = new Set();
  const newItems = [];

  for (const item of allItems) {
    const titleKey = (item.title || '').toLowerCase().trim();

    if (!titleKey) continue;
    if (existingTitles.has(titleKey)) continue;
    if (seenTitles.has(titleKey)) continue;

    seenTitles.add(titleKey);
    newItems.push(item);
  }

  const totalDuplicates = allItems.length - newItems.length;
  log.info({ newItems: newItems.length, duplicates: totalDuplicates }, 'Dedup complete');

  // Store new items in CRM (sequentially to avoid overwhelming the API)
  let totalStored = 0;

  for (const item of newItems) {
    const result = await storeInCRM(item, token);
    if (result.success) {
      totalStored++;
      item.crm_id = result.id;
      if (bySource[item.source]) {
        bySource[item.source].stored++;
      }
    } else {
      errors.push(`store(${item.source}/${item.title?.slice(0, 40)}): ${result.error}`);
    }
  }

  const elapsed = Date.now() - startTime;

  const summary = {
    total_fetched: allItems.length,
    total_new: newItems.length,
    total_stored: totalStored,
    total_duplicates: totalDuplicates,
    elapsed_ms: elapsed,
    by_source: bySource,
    errors: errors.length > 0 ? errors : undefined,
    items: newItems.map(item => ({
      title: item.title,
      source: item.source,
      url: item.url,
      score: item.score || null,
      crm_id: item.crm_id || null,
    })),
  };

  log.info({
    totalFetched: allItems.length,
    totalNew: newItems.length,
    totalStored,
    totalDuplicates,
    elapsed,
  }, 'Content aggregation complete');

  return summary;
}
