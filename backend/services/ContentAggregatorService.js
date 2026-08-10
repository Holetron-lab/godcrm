// backend/services/ContentAggregatorService.js
// Re-exports from split modules in content-aggregator/
export {
  fetchHackerNews,
  fetchRSSFeeds,
  fetchReddit,
  getContentQueue,
  publishToTelegram,
  aggregateContent,
  processNewsWithAI,
  formatNewsForTopic,
  aggregateAndPublishNews,
} from './content-aggregator/index.js';
