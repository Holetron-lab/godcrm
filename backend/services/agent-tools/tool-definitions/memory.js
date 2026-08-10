/**
 * Memory (Hindsight / MemPalace) tool definitions.
 * Covers ADR-145 retain/recall/reflect/compress/bridge.
 */

export const MEMORY_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'memory_retain',
      description: 'Save a fact, observation, or document to long-term memory. Use after learning something important about a contact, deal, conversation, or project. The system automatically extracts entities and creates links between facts.',
      parameters: {
        type: 'object',
        properties: {
          text: {
            type: 'string',
            description: 'The text to memorize — a fact, observation, or document content'
          },
          bank_id: {
            type: 'string',
            description: 'Memory bank ID (default: godcrm-main). Each agent can have its own bank.'
          },
          context: {
            type: 'string',
            description: 'Optional context label (e.g. "meeting notes", "client call", "deal update")'
          },
          document_id: {
            type: 'string',
            description: 'Optional document ID to group related facts'
          },
          tags: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional tags for categorization'
          },
          room: {
            type: 'string',
            description: 'Topic classification (ADR-145 MemPalace). Examples: auth, pipeline, schema, tax, hr, legal, compliance, infrastructure, ui, api, deployment, monitoring, agent, general. Auto-classified if not provided.'
          },
          hall: {
            type: 'string',
            enum: ['fact', 'event', 'decision', 'preference', 'discovery', 'procedure', 'warning'],
            description: 'Knowledge type (ADR-145 MemPalace). Auto-classified if not provided.'
          },
          layer: {
            type: 'string',
            enum: ['L0', 'L1', 'L2', 'L3'],
            description: 'Memory layer (ADR-145 MemPalace). L0=Identity (always loaded), L1=Critical Facts (per-space), L2=Session Context (per-conversation, default), L3=Deep Memory (full search).'
          }
        },
        required: ['text']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'memory_recall',
      description: 'Search long-term memory for relevant facts. Uses semantic search, keyword matching, entity graph traversal, and temporal filtering. Use when you need context about a person, company, past conversation, or any stored knowledge.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'What to search for in memory'
          },
          bank_id: {
            type: 'string',
            description: 'Memory bank ID (default: godcrm-main)'
          },
          limit: {
            type: 'number',
            description: 'Maximum number of results (default: 10)'
          },
          room: {
            oneOf: [
              { type: 'string' },
              { type: 'array', items: { type: 'string' } }
            ],
            description: 'Filter by room (topic). Single string or array. Applied BEFORE semantic search for +34% accuracy.'
          },
          hall: {
            oneOf: [
              { type: 'string' },
              { type: 'array', items: { type: 'string' } }
            ],
            description: 'Filter by hall (knowledge type): fact, event, decision, preference, discovery, procedure, warning.'
          },
          max_layer: {
            type: 'string',
            enum: ['L0', 'L1', 'L2', 'L3'],
            description: 'Maximum layer to search (ADR-145 MemPalace). Searches L0→max_layer cascade. Default: L3 (search all layers). L0 results always have highest priority.'
          }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'memory_reflect',
      description: 'Deep reasoning over memory — synthesizes facts, finds patterns, answers complex questions with citations. Use for analysis and insight generation, e.g. "What do we know about this client\'s preferences?" or "What patterns emerge from recent deals?"',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Question to reason about over stored memories'
          },
          bank_id: {
            type: 'string',
            description: 'Memory bank ID (default: godcrm-main)'
          }
        },
        required: ['query']
      }
    }
  },

  // === MEMORY COMPRESS (ADR-145 Phase 3: Closets) ===
  {
    type: 'function',
    function: {
      name: 'memory_compress',
      description: 'Create compressed memory summaries (closets) from stored facts. Groups memories by room+hall and creates summaries with source pointers. Use when a topic has accumulated many facts and needs consolidation.',
      parameters: {
        type: 'object',
        properties: {
          bank_id: { type: 'string', description: 'Memory bank ID (default: godcrm-main)' },
          room: { type: 'string', description: 'Topic to compress (e.g. "auth", "pipeline"). If omitted, compresses all eligible rooms.' },
          hall: { type: 'string', description: 'Knowledge type to compress (e.g. "fact", "decision"). If omitted, compresses all eligible halls.' },
          min_sources: { type: 'number', description: 'Minimum memories needed to create a closet (default: 5)' },
          query: { type: 'string', description: 'Optional query to guide compression focus' }
        }
      }
    }
  },

  // === MEMORY BRIDGE (ADR-145 Phase 4: Tunnels) ===
  {
    type: 'function',
    function: {
      name: 'memory_bridge',
      description: 'Create a cross-bank memory bridge (tunnel) between two related memories in different banks. Use when you discover that a concept in one bank relates to a concept in another bank. Relations: same_concept, depends_on, contradicts, extends.',
      parameters: {
        type: 'object',
        properties: {
          source_bank: { type: 'string', description: 'Source bank ID (e.g. "godcrm-main")' },
          source_memory: { type: 'string', description: 'UUID of the source memory unit' },
          target_bank: { type: 'string', description: 'Target bank ID' },
          target_memory: { type: 'string', description: 'UUID of the target memory unit' },
          relation: {
            type: 'string',
            enum: ['same_concept', 'depends_on', 'contradicts', 'extends'],
            description: 'Relationship type between the memories'
          },
          confidence: { type: 'number', description: 'Confidence score 0.0-1.0 (default: 0.8)' },
        },
        required: ['source_bank', 'source_memory', 'target_bank', 'target_memory', 'relation']
      }
    }
  }
];
