// backend/services/content-aggregator/config.js
// Configuration constants for Content Aggregation Service

export const CRM_API_BASE = 'https://devcrm.hltrn.cc/api/v3';
export const CONTENT_TABLE_ID = 2603;

// AI/ML keyword filters (case-insensitive)
export const AI_KEYWORDS = [
  'ai', 'llm', 'gpt', 'claude', 'openai', 'anthropic',
  'machine learning', 'neural', 'transformer', 'diffusion',
  'agent', 'autonomous', 'self-hosted', 'open source',
  'deep learning', 'nlp', 'computer vision', 'rag',
  'fine-tuning', 'fine tuning', 'embedding', 'inference',
  'gemini', 'mistral', 'llama', 'stable diffusion', 'midjourney',
];

// Default RSS feeds
export const DEFAULT_RSS_FEEDS = [
  'https://openai.com/news/rss.xml',        // OpenAI blog (redirected from /blog/)
  'https://blog.google/technology/ai/rss/',  // Google AI Blog
  'https://huggingface.co/blog/feed.xml',    // Hugging Face Blog
  'https://techcrunch.com/category/artificial-intelligence/feed/', // TechCrunch AI
  'https://the-decoder.com/feed/',           // The Decoder - AI news
  'https://arxiv.org/rss/cs.AI',             // arXiv CS.AI papers
  // Note: Anthropic blog (anthropic.com/feed) removed — returns 404 as of 2026-02
  // Note: Papers with Code (/latest/rss) redirects to HF trending HTML, not usable as RSS
];

// Reddit subreddits to monitor
export const REDDIT_SUBREDDITS = [
  'LocalLLaMA',
  'MachineLearning',
  'artificial',
  'ChatGPT',
  'selfhosted',
  'opensource',
  'StableDiffusion',
];

// Hacker News API
export const HN_API = 'https://hacker-news.firebaseio.com/v0';

// Reddit score threshold
export const REDDIT_MIN_SCORE = 50;
