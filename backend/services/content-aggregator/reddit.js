// backend/services/content-aggregator/reddit.js
// Reddit parser for Content Aggregation Service

import RssParser from 'rss-parser';
import { REDDIT_SUBREDDITS, REDDIT_MIN_SCORE } from './config.js';
import { log, truncate, fetchJSON } from './helpers.js';

/**
 * Fetch hot posts from AI/tech subreddits
 * Strategy: Try JSON API first, fall back to RSS feed if blocked (403)
 * @param {string[]} subreddits - List of subreddit names
 * @param {number} minScore - Minimum score threshold (default 50)
 * @returns {Promise<Array<{title, url, selftext, score, author, subreddit, created_utc, source, source_id}>>}
 */
export async function fetchReddit(subreddits = REDDIT_SUBREDDITS, minScore = REDDIT_MIN_SCORE) {
  log.info({ subreddits: subreddits.length }, 'Fetching Reddit posts...');

  const allPosts = [];

  const subResults = await Promise.allSettled(
    subreddits.map(async (sub) => {
      // Strategy 1: Try JSON API (note: Reddit often returns 403 from server IPs)
      try {
        const data = await fetchJSON(
          `https://www.reddit.com/r/${sub}/hot.json?limit=25&raw_json=1`,
          {
            headers: {
              'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
              'Accept': 'application/json',
            },
          },
          15000
        );

        if (data?.data?.children) {
          return data.data.children
            .filter(child => child.kind === 't3' && child.data)
            .map(child => {
              const post = child.data;
              return {
                title: post.title || 'Untitled',
                url: post.url || `https://reddit.com${post.permalink}`,
                selftext: truncate(post.selftext || '', 500),
                score: post.score || 0,
                author: post.author || 'unknown',
                subreddit: post.subreddit || sub,
                created_utc: post.created_utc
                  ? new Date(post.created_utc * 1000).toISOString()
                  : new Date().toISOString(),
                source: 'reddit',
                source_id: `reddit_${post.id || post.name}`,
                permalink: post.permalink ? `https://reddit.com${post.permalink}` : null,
              };
            })
            .filter(post => post.score >= minScore);
        }
      } catch (jsonErr) {
        log.debug({ subreddit: sub, err: jsonErr.message }, 'Reddit JSON API failed, trying RSS fallback');
      }

      // Strategy 2: Fall back to RSS feed (bypasses most blocking)
      try {
        const parser = new RssParser({
          timeout: 15000,
          headers: {
            'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          },
        });

        const feed = await parser.parseURL(`https://www.reddit.com/r/${sub}/hot.rss?limit=25`);

        return (feed.items || []).map(item => ({
          title: item.title || 'Untitled',
          url: item.link || '',
          selftext: truncate(item.contentSnippet || item.content || '', 500),
          score: 0, // RSS doesn't include scores
          author: item.creator || item.author || 'unknown',
          subreddit: sub,
          created_utc: item.isoDate || item.pubDate || new Date().toISOString(),
          source: 'reddit',
          source_id: `reddit_${Buffer.from(item.link || item.title || '').toString('base64').slice(0, 30)}`,
          permalink: item.link || null,
        }));
      } catch (rssErr) {
        log.warn({ subreddit: sub, err: rssErr.message }, 'Reddit: both JSON and RSS failed');
        return [];
      }
    })
  );

  for (const result of subResults) {
    if (result.status === 'fulfilled') {
      allPosts.push(...result.value);
    }
  }

  // Sort by score descending (RSS items with score=0 will be at the end)
  allPosts.sort((a, b) => b.score - a.score);

  log.info({ count: allPosts.length }, 'Reddit: fetched posts');
  return allPosts;
}
