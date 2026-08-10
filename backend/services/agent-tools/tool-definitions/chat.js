/**
 * Chat / conversation tool definitions.
 */

export const CHAT_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'send_chat_message',
      description: 'Send a message to an existing conversation. Optionally embed a widget (list/kanban/table) by passing content_type="widget_embed" plus a widgetEmbed attachment.',
      parameters: {
        type: 'object',
        properties: {
          conversation_id: { type: 'number', description: 'ID of the conversation' },
          content: { type: 'string', description: 'Message text content' },
          role: { type: 'string', enum: ['user', 'assistant', 'system'], description: 'Message role (default: user)' },
          content_type: {
            type: 'string',
            enum: ['text', 'widget_embed'],
            description: 'Content type. "text" (default) for plain prose. "widget_embed" when sending a live widget attachment.'
          },
          attachments: {
            type: 'array',
            description: 'Optional attachments. For widget_embed messages, pass a single { type: "widget_embed", widgetEmbed: { table_id, view, filter?, columns?, limit? } } entry.',
            items: {
              type: 'object',
              properties: {
                type: { type: 'string', enum: ['widget_embed', 'row_reference'] },
                widgetEmbed: {
                  type: 'object',
                  properties: {
                    table_id: { type: 'number', description: 'Table ID to display' },
                    view: { type: 'string', enum: ['list', 'kanban', 'table'], description: 'Render mode' },
                    filter: { type: 'object', description: 'Optional column→value filter map' },
                    columns: { type: 'array', items: { type: 'string' }, description: 'Optional column whitelist' },
                    limit: { type: 'number', description: 'Max rows to render (default: client-decided)' }
                  },
                  required: ['table_id', 'view']
                },
                rowReference: {
                  type: 'object',
                  properties: {
                    table_id: { type: 'number' },
                    row_id: { type: 'number' },
                    table_name: { type: 'string' },
                    row_title: { type: 'string' }
                  },
                  required: ['table_id', 'row_id']
                }
              },
              required: ['type']
            }
          }
        },
        required: ['conversation_id', 'content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'send_widget_message',
      description: 'Post a single CRM row as a chip/card into a chat conversation. Thin façade over send_chat_message — resolves the row\'s table name/icon/title server-side and emits a row_reference attachment that the chat renders via the active preset (DocumentRowAtom, TicketRowAtom, RowPresetCard, etc.). Common use: after create_document, pass `table_id = registry_table_id` and `row_id = document_id` to drop a doc chip into the chat.',
      parameters: {
        type: 'object',
        properties: {
          conversation_id: { type: 'number', description: 'ID of the conversation to post into' },
          table_id: { type: 'number', description: 'Table that holds the row (e.g. registry_table_id from create_document)' },
          row_id: { type: 'number', description: 'ID of the row to embed' },
          style: {
            type: 'string',
            enum: ['chip', 'card'],
            description: 'Display hint: "chip" (default, collapsed inline reference) or "card" (expanded preset card). The active preset on the receiving side may override.'
          },
          note: { type: 'string', description: 'Optional message text to accompany the chip (default: empty — message carries only the attachment)' }
        },
        required: ['conversation_id', 'table_id', 'row_id']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_conversations',
      description: 'List conversations with optional filters by space, type, or search.',
      parameters: {
        type: 'object',
        properties: {
          space_id: { type: 'number', description: 'Filter by space ID' },
          type: { type: 'string', description: 'Filter by type: direct, group, ai, channel' },
          search: { type: 'string', description: 'Search in conversation titles' },
          limit: { type: 'number', description: 'Max results (default: 50)' }
        },
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_conversation_messages',
      description: 'Get messages from a conversation with cursor pagination.',
      parameters: {
        type: 'object',
        properties: {
          conversation_id: { type: 'number', description: 'ID of the conversation' },
          limit: { type: 'number', description: 'Max messages to return (default: 50)' },
          before_id: { type: 'number', description: 'Return messages before this message ID (for pagination)' }
        },
        required: ['conversation_id']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'move_chat_messages',
      description: 'ADR-0031 P5 — Move a batch of messages from a source conversation into a target conversation, leaving "moved" stubs in the source that the ChatLinkCard renders. Atomic: all source updates + target inserts in one transaction. Auth: caller must be the chat owner of the source conversation, OR the system admin override (MCP runs as user 1; if user 1 is not the owner, the user must have role=admin).',
      parameters: {
        type: 'object',
        properties: {
          source_conversation_id: { type: 'number', description: 'Conversation to move messages OUT of. Caller must be chat owner.' },
          target_conversation_id: { type: 'number', description: 'Conversation to move messages INTO. Must differ from source.' },
          message_ids: {
            type: 'array',
            items: { type: 'number' },
            description: 'IDs of messages in source to move. Must all belong to source, not deleted, not already moved.'
          }
        },
        required: ['source_conversation_id', 'target_conversation_id', 'message_ids']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'spawn_ticket_from_chat',
      description: 'ADR-0031 P6 — Create a new ticket from an existing conversation: inserts a row in the tickets table, ensures the row-chat for that ticket, and moves the selected messages out of the source into the new ticket\'s chat (leaving stubs). Returns ticket_id + ticket_conversation_id. Auth: same gate as move_chat_messages (chat owner of source, or admin override).',
      parameters: {
        type: 'object',
        properties: {
          source_conversation_id: { type: 'number', description: 'Conversation to move messages out of (e.g. a BDD-criterion chat).' },
          ticket_data: {
            type: 'object',
            description: 'Ticket payload. Required: what (string), assigned_to (agent label or user id). Optional: why, priority, type, state, etc.',
            properties: {
              what: { type: 'string', description: 'Ticket title / summary.' },
              why: { type: 'string', description: 'Reason / context.' },
              assigned_to: { description: 'Agent label (e.g. "developer-ralph") or user id.' },
              priority: { type: 'string' },
              type: { type: 'string' },
              state: { type: 'number' }
            },
            required: ['what', 'assigned_to']
          },
          message_ids: {
            type: 'array',
            items: { type: 'number' },
            description: 'Optional explicit subset of source messages to move. Default: all non-stub messages in the source conversation.'
          }
        },
        required: ['source_conversation_id', 'ticket_data']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'create_conversation',
      description: 'Create a new conversation (direct, group, ai, or channel).',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Conversation title' },
          type: { type: 'string', enum: ['direct', 'group', 'ai', 'channel'], description: 'Conversation type (default: direct)' },
          space_id: { type: 'number', description: 'Space ID' },
          participant_ids: {
            type: 'array',
            items: { type: 'number' },
            description: 'User IDs to add as participants'
          }
        },
        required: ['title']
      }
    }
  }
];
