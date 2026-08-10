// backend/routes/v3/content-pipeline.js
// Content Pipeline API - Aggregates AI/tech news and manages content queue
// Sources: Hacker News, RSS feeds, Reddit
// Storage: CRM table 2603

import { Router } from 'express';
import { apiLogger } from '../../utils/logger.js';
import { success, error, badRequest } from '../../utils/response.js';
import {
  aggregateContent,
  getContentQueue,
  publishToTelegram,
  aggregateAndPublishNews,
  fetchHackerNews,
  fetchRSSFeeds,
  fetchReddit,
} from '../../services/ContentAggregatorService.js';

const router = Router();
const log = apiLogger.child({ module: 'content-pipeline' });

// =============================================================================
// GET /api/v3/content-pipeline/aggregate
// Trigger content aggregation from all (or specified) sources
// Query params:
//   ?sources=hackernews,rss,reddit  (comma-separated, defaults to all)
// =============================================================================

router.get('/aggregate', async (req, res) => {
  try {
    const sourcesParam = req.query.sources;
    const validSources = ['hackernews', 'rss', 'reddit'];

    let sources = validSources; // default: all
    if (sourcesParam) {
      sources = sourcesParam.split(',').map(s => s.trim().toLowerCase()).filter(s => validSources.includes(s));
      if (sources.length === 0) {
        return badRequest(res, `Invalid sources. Valid options: ${validSources.join(', ')}`);
      }
    }

    log.info({ sources }, 'Content aggregation triggered');

    const result = await aggregateContent(sources);

    return success(res, result, 'Content aggregation complete');
  } catch (err) {
    log.error({ err }, 'Content aggregation failed');
    return error(res, 'AGGREGATION_FAILED', `Content aggregation failed: ${err.message}`, 500);
  }
});

// =============================================================================
// GET /api/v3/content-pipeline/queue
// View pending/draft content items
// =============================================================================

router.get('/queue', async (req, res) => {
  try {
    const queue = await getContentQueue();

    return success(res, {
      count: queue.length,
      items: queue,
    });
  } catch (err) {
    log.error({ err }, 'Failed to fetch content queue');
    return error(res, 'QUEUE_FETCH_FAILED', `Failed to fetch content queue: ${err.message}`, 500);
  }
});

// =============================================================================
// POST /api/v3/content-pipeline/publish/:id
// Publish a specific content item to Telegram
// =============================================================================

router.post('/publish/:id', async (req, res) => {
  try {
    const rowId = parseInt(req.params.id, 10);
    if (isNaN(rowId)) {
      return badRequest(res, 'Invalid row ID');
    }

    log.info({ rowId }, 'Publishing content item to Telegram');

    const result = await publishToTelegram(rowId);

    if (result.success) {
      return success(res, result, 'Published to Telegram');
    } else {
      return error(res, 'PUBLISH_FAILED', result.error || 'Failed to publish', 500);
    }
  } catch (err) {
    log.error({ err }, 'Publish to Telegram failed');
    return error(res, 'PUBLISH_FAILED', `Failed to publish: ${err.message}`, 500);
  }
});

// =============================================================================
// GET /api/v3/content-pipeline/preview/:source
// Preview content from a specific source without storing
// Useful for testing individual parsers
// =============================================================================

router.get('/preview/:source', async (req, res) => {
  try {
    const source = req.params.source.toLowerCase();

    let items;
    switch (source) {
      case 'hackernews':
      case 'hn':
        items = await fetchHackerNews(10);
        break;
      case 'rss':
        items = await fetchRSSFeeds();
        break;
      case 'reddit':
        items = await fetchReddit();
        break;
      default:
        return badRequest(res, `Unknown source: ${source}. Valid: hackernews, rss, reddit`);
    }

    return success(res, {
      source,
      count: items.length,
      items,
    });
  } catch (err) {
    log.error({ err }, `Preview for ${req.params.source} failed`);
    return error(res, 'PREVIEW_FAILED', `Preview failed: ${err.message}`, 500);
  }
});

// =============================================================================
// POST /api/v3/content-pipeline/news-digest
// Full AI news pipeline: aggregate → AI process → publish to group topics
// Body params:
//   sources: ['hackernews','rss','reddit'] (optional)
//   maxItems: 5 (optional, max items to process and publish)
// =============================================================================

router.post('/news-digest', async (req, res) => {
  try {
    const { sources, maxItems } = req.body || {};

    log.info({ sources, maxItems }, 'AI news digest triggered');

    const result = await aggregateAndPublishNews({ sources, maxItems });

    return success(res, result, 'News digest complete');
  } catch (err) {
    log.error({ err }, 'News digest failed');
    return error(res, 'NEWS_DIGEST_FAILED', `News digest failed: ${err.message}`, 500);
  }
});

export default router;
