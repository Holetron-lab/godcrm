/**
 * Web research tool definitions.
 * web_search is SearXNG-backed (self-hosted metasearch); Firecrawl is an optional
 * fallback only. deep_scrape prefers Firecrawl, else a native fetch+strip.
 * @see agent-tools/web-tools.js for the resolution order.
 */

export const WEB_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'web_search',
      description: 'Search the web (SearXNG self-hosted metasearch; Firecrawl is an optional fallback). Returns search results with titles, URLs, and descriptions. Optionally scrape full content.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Search query. Supports Google operators like site:, intitle:, etc.'
          },
          limit: {
            type: 'number',
            description: 'Number of results to return (default: 5, max: 10)'
          },
          scrape_content: {
            type: 'boolean',
            description: 'If true, scrape full markdown content from top results'
          },
          time_filter: {
            type: 'string',
            enum: ['qdr:h', 'qdr:d', 'qdr:w', 'qdr:m', 'qdr:y'],
            description: 'Time filter: h=hour, d=day, w=week, m=month, y=year'
          }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'deep_scrape',
      description: 'Scrape a single URL and extract content as markdown. Use for reading full articles, documentation, or any web page.',
      parameters: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'URL to scrape'
          },
          include_links: {
            type: 'boolean',
            description: 'If true, also extract and return links from the page'
          }
        },
        required: ['url']
      }
    }
  }
];
