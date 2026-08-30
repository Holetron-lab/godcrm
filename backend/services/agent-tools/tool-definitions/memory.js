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
            description: 'Topic classification (ADR-145 MemPalace; aliasing per ADR-193). The room is a machine key that recall filters and compression group on. Canonical rooms: auth, pipeline, schema, tax, hr, legal, compliance, infrastructure, ui, api, deployment, monitoring, agent, general — plus the rooms the fleet actually uses: shared, marketing, orchestrator, gateway, chat. You do not have to hit one exactly: a synonym is canonicalised for you (deploy → deployment, infra → infrastructure, frontend → ui), including a Russian one (деплой, выкатка → deployment), and what you typed is preserved as the tag room-alias:<typed>. Case and spacing are normalised, so "Деплой" and "деплой" are one room, never twins. If nothing matches, your string BECOMES a new room — the write still succeeds, but it is tagged room-new: and logged, so call memory_rooms first and reuse an existing room instead of inventing a synonym for one that already exists. Omit this entirely and the engine classifies the room from the text.'
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
          },
          author: {
            type: 'string',
            description: 'Who is writing this memory (agent slug, e.g. "sysadmin"). You normally do NOT pass this — inside the CRM the server fills it from your resolved agent identity and that value always wins, so attribution cannot be forged. Supply it only when calling from outside the agent loop (MCP/CLI), where no server-side identity exists. Stored as the tag author:<slug>, which is what memory_recall filters on.'
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
            description: 'Filter by room (topic). Single string or array, same vocabulary and same canonicalisation as memory_retain — asking for "деплой" or "deploy" searches deployment. Applied BEFORE semantic search for +34% accuracy. The room a fact was filed under lives on two carriers (the column, which consolidation drops, and the room: tag, which it keeps), so this filter searches BOTH and merges — you do not lose observations. The resolved rooms come back in the response as `rooms`.'
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
          },
          mine: {
            type: 'boolean',
            description: 'Recall only memories YOU wrote — your personal room. Resolves to your own agent identity, so you never have to name yourself. Combines with room/hall: mine + room:"deployment" = your own deployment memories.'
          },
          author: {
            oneOf: [
              { type: 'string' },
              { type: 'array', items: { type: 'string' } }
            ],
            description: 'Recall only memories written by these agents (slug or array of slugs), e.g. "marketer". Independent of room, which is topic — use both together to ask for one agent\'s memories on one topic.'
          },
          include_unattributed: {
            type: 'boolean',
            description: 'When filtering by mine/author, also return memories with no recorded author (default false). Everything written before author attribution shipped is unattributed, so set this true when you want your own memories PLUS the historical corpus.'
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

  // === MEMORY ROOMS (ADR-193 Phase 3: the floor plan) ===
  {
    type: 'function',
    function: {
      name: 'memory_rooms',
      description: 'List the rooms a memory bank has, with how many facts each holds. Call this BEFORE memory_retain when you are unsure which room a fact belongs in — the room axis was the one axis nobody could enumerate, which is exactly why agents kept inventing new names for rooms that already existed. Each entry is {room, facts, known}: `known: true` means writing there reuses an existing room; `known: false` means somebody minted that room by typing it. `facts` counts only memories carrying a room: tag, so it reads 0 for rooms whose facts predate that tagging — a 0 means "nothing tagged yet", not "unused".',
      parameters: {
        type: 'object',
        properties: {
          bank_id: { type: 'string', description: 'Memory bank ID (default: godcrm-main)' },
          limit: { type: 'number', description: 'Maximum rooms to read from the tag census (default: 100)' }
        }
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
          room: { type: 'string', description: 'Topic to compress (e.g. "auth", "pipeline"). A SINGLE room name — not a list, unlike memory_recall. Canonicalised the same way memory_retain canonicalises it (ADR-193): a synonym resolves to the canonical room (deploy → deployment, инфра → infrastructure, деплой → deployment), case and spacing are normalised, and the room actually compressed comes back in the response as `room` — so typing a synonym compresses the room it filed under, not nothing. If omitted, compresses all eligible rooms; a room that is passed but unusable (empty, whitespace-only, not a string) is an error rather than an omission, so it cannot silently widen the run to the whole bank.' },
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
