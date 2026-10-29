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
      description: 'Search across tables, rows, projects, and conversations by name. Returns results grouped by type; every table result includes its stored table_type marker (string or null). Two modes: (1) name search — query is required, types defaults to all; (2) marker search — pass table_type (exact, case-sensitive) to find tables by their stored marker regardless of name; then query is optional (combined with AND when given) and types must be omitted or ["tables"]. space_id narrows tables and projects to one space. A result list of exactly `limit` items may be truncated.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Name search text (substring, case-insensitive). Required unless table_type is given.' },
          table_type: { type: 'string', description: 'Exact stored table marker, e.g. "ai_agents" (max 50 chars, not a pattern). Searches tables only; query becomes optional.' },
          types: {
            type: 'array',
            items: { type: 'string', enum: ['tables', 'rows', 'projects', 'conversations'] },
            description: 'Entity types to search (default: all). With table_type must be omitted or ["tables"].'
          },
          space_id: { type: 'number', description: 'Limit tables and projects to a space' },
          limit: { type: 'number', description: 'Max results per type (default: 20)' },
          include_archived: { type: 'boolean', description: 'Include rows with status=archived (default: false — archived rows are hidden)' }
        },
        required: []
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
      description: 'Send a message to a Telegram destination: "channel" (@godcrm RU), "channel_en" (@god_crm EN), "group" (general), a topic key (news, ai_news, notifications, schedule, fitness, nutrition, tasks, business, pets, creative, together, notes, trainer), a calibrated Anti-Marketing Club topic via "club_<key>" (e.g. "club_bluesky") — sent plain-text into the club staging group — or a private chat via "tg:<chat_id>" (the person must have pressed /start on @godcrmbot first).',
      parameters: {
        type: 'object',
        properties: {
          destination: {
            type: 'string',
            description: 'Where to send: "channel" (→ @godcrm RU), "channel_en" (→ @god_crm EN), "group", a topic key like "news"/"notifications"/"ai_news"/"schedule", "club_<key>" for a calibrated club topic (e.g. "club_bluesky"), or "tg:<numeric chat_id>" for a private chat.'
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
