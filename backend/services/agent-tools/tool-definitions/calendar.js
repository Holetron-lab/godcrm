/**
 * Calendar, global search, spaces, telegram, BDD tool definitions.
 * Grouped together as they are each small (≤6 tools).
 */

export const CALENDAR_TOOLS = [
  // === P3 — Calendar ===
  {
    type: 'function',
    function: {
      name: 'list_events',
      description: 'List calendar events with optional date range and space filter.',
      parameters: {
        type: 'object',
        properties: {
          start_date: { type: 'string', description: 'Start date (ISO 8601)' },
          end_date: { type: 'string', description: 'End date (ISO 8601)' },
          space_id: { type: 'number', description: 'Filter by space' },
          limit: { type: 'number', description: 'Max results (default: 100)' }
        },
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'create_event',
      description: 'Create a new calendar event.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Event title' },
          start: { type: 'string', description: 'Start time (ISO 8601)' },
          end: { type: 'string', description: 'End time (ISO 8601)' },
          description: { type: 'string', description: 'Event description' },
          space_id: { type: 'number', description: 'Space ID' },
          all_day: { type: 'boolean', description: 'Is all-day event' }
        },
        required: ['title', 'start']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'update_event',
      description: 'Update a calendar event.',
      parameters: {
        type: 'object',
        properties: {
          event_id: { type: 'number', description: 'Event ID' },
          title: { type: 'string', description: 'New title' },
          start: { type: 'string', description: 'New start time' },
          end: { type: 'string', description: 'New end time' },
          description: { type: 'string', description: 'New description' },
          all_day: { type: 'boolean', description: 'All-day flag' }
        },
        required: ['event_id']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'delete_event',
      description: 'Delete a calendar event.',
      parameters: {
        type: 'object',
        properties: {
          event_id: { type: 'number', description: 'Event ID to delete' }
        },
        required: ['event_id']
      }
    }
  },

  // === Global search & spaces ===
  {
    type: 'function',
    function: {
      name: 'global_search',
      description: 'Search across tables, rows, projects, and conversations. Returns results grouped by type.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
          types: {
            type: 'array',
            items: { type: 'string', enum: ['tables', 'rows', 'projects', 'conversations'] },
            description: 'Entity types to search (default: all)'
          },
          space_id: { type: 'number', description: 'Limit search to a space' },
          limit: { type: 'number', description: 'Max results per type (default: 20)' },
          include_archived: { type: 'boolean', description: 'Include rows with status=archived (default: false — archived rows are hidden)' }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_spaces',
      description: 'List all spaces in the CRM.',
      parameters: {
        type: 'object',
        properties: {},
        required: []
      }
    }
  },

  // === TELEGRAM TOOLS ===
  {
    type: 'function',
    function: {
      name: 'send_telegram_message',
      description: 'Send a message to a Telegram destination: "channel" (@godcrm RU), "channel_en" (@god_crm EN), "group" (general), a topic key (news, ai_news, notifications, schedule, fitness, nutrition, tasks, business, pets, creative, together, notes, trainer), or a calibrated Anti-Marketing Club topic via "club_<key>" (e.g. "club_bluesky") — sent plain-text into the club staging group.',
      parameters: {
        type: 'object',
        properties: {
          destination: {
            type: 'string',
            description: 'Where to send: "channel" (→ @godcrm RU), "channel_en" (→ @god_crm EN), "group", a topic key like "news"/"notifications"/"ai_news"/"schedule", or "club_<key>" for a calibrated club topic (e.g. "club_bluesky").'
          },
          text: {
            type: 'string',
            description: 'Message text. Supports Telegram Markdown (bold: *text*, italic: _text_, code: `code`, link: [text](url)).'
          },
          parse_mode: {
            type: 'string',
            enum: ['Markdown', 'HTML', 'MarkdownV2'],
            description: 'Telegram parse mode. Default: Markdown. Use HTML for complex formatting.'
          }
        },
        required: ['destination', 'text']
      }
    }
  },

  // === ADR-0003 §C-1 — BDD acceptance criteria ===
  {
    type: 'function',
    function: {
      name: 'list_bdd_specs',
      description: 'List BDD specs (with their criteria) attached to a document. Reads the same bdd_specs/bdd_criteria substrate as GET /api/v3/bdd/specs. Returns { specs: [{ id, code, owner_user_id, criteria: [{ id, code, given, when, then, priority, status, owner_user_id }] }] }.',
      parameters: {
        type: 'object',
        properties: {
          source_doc_id: { type: 'number', description: 'Registry document id the specs are attached to (bdd_specs.data.source_doc_id).' }
        },
        required: ['source_doc_id']
      }
    }
  }
];
