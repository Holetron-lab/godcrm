// backend/services/content-aggregator/index.js
// Barrel export for Content Aggregation Service

export { fetchHackerNews } from './hackernews.js';
export { fetchRSSFeeds } from './rss.js';
export { fetchReddit } from './reddit.js';
export { getContentQueue, publishToTelegram } from './crm-storage.js';
export { aggregateContent } from './aggregator.js';
export { processNewsWithAI, formatNewsForTopic, aggregateAndPublishNews } from './news-processing.js';
