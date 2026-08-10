/**
 * Bluesky (AT Protocol) tool definitions — kosher social-listening.
 *
 * Public posts only. Dual-use frame: research / integrity / due-diligence.
 * See bluesky-tools.js for the handler + the "Austin recon" stack rationale.
 */

export const BLUESKY_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'bluesky_search',
      description:
        'Search PUBLIC Bluesky (AT Protocol) posts for social-listening: discover a pain/topic and map WHO amplifies it. Returns post text plus engagement metrics (likes/reposts/replies/quotes) and the author handle (amplifier graph node). Public posts only — no private data, no person-deanon. Use sort="top" to rank by engagement (who amplifies), "latest" for recency.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Search query (keywords or phrase). Bluesky full-text search over public posts.',
          },
          limit: {
            type: 'number',
            description: 'Number of posts to return (default: 25, max: 100).',
          },
          sort: {
            type: 'string',
            enum: ['top', 'latest'],
            description: 'Ranking: "top" = by engagement (best for finding amplifiers), "latest" = newest first. Default: top.',
          },
          since: {
            type: 'string',
            description: 'Optional ISO8601 lower bound on indexedAt (e.g. 2026-06-01T00:00:00Z).',
          },
          until: {
            type: 'string',
            description: 'Optional ISO8601 upper bound on indexedAt.',
          },
        },
        required: ['query'],
      },
    },
  },
];

export default BLUESKY_TOOLS;
