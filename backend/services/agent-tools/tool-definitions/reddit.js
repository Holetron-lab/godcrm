/**
 * Reddit search tool definition — read-only pain-mining over public posts.
 *
 * Backed by a managed Reddit data provider (redditapis.com), same risk-shape as
 * the TwitterAPI.io / Tweet Radar stack (ADR-152): grey-market resale of a
 * social network's public data, key in the `_secrets` vault (ADR-0040). This
 * bypasses Reddit's Responsible Builder Policy app-review gate entirely — we
 * never register our own OAuth app.
 *
 * READ-ONLY BY DESIGN. No posting, no DMs, no writes through this tool — the
 * business Reddit account is kept separate for human-driven DMs. See
 * reddit-tools.js for the handler + endpoint rationale.
 */

export const REDDIT_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'reddit_search',
      description:
        'Search PUBLIC Reddit posts for pain-mining / social-listening: discover a recurring pain, quote the source, and see engagement (upvotes/comments). Returns post title + body plus subreddit, author handle, upvotes, comments, upvote_ratio, timestamp, and a permalink. Public posts only — read-only, no posting/DMs. Filter to a single subreddit with `subreddit`; use sort="top" + t="week"/"month" to surface the hottest recent pain, sort="new" for freshest.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Search query (keywords or phrase). Full-text over public Reddit posts.',
          },
          subreddit: {
            type: 'string',
            description: 'Optional single subreddit slug to restrict the search (without "r/"), e.g. "automation".',
          },
          limit: {
            type: 'number',
            description: 'Number of posts to return (default: 25, max: 100).',
          },
          sort: {
            type: 'string',
            enum: ['relevance', 'hot', 'top', 'new', 'comments'],
            description: 'Ranking. "top" = highest engagement (pair with `t`), "new" = freshest, "relevance" = default match quality, "comments" = most-discussed.',
          },
          t: {
            type: 'string',
            enum: ['hour', 'day', 'week', 'month', 'year', 'all'],
            description: 'Time window for the ranking (most useful with sort="top"), e.g. "week" = last 7 days. Default: all.',
          },
          after: {
            type: 'string',
            description: 'Pagination cursor from a previous response\'s `after` field (fullname like "t3_abc123") to fetch the next page.',
          },
        },
        required: ['query'],
      },
    },
  },
];

export default REDDIT_TOOLS;
