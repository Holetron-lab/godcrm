/**
 * Ticket / orchestration / supervisor / planning / summary tool definitions.
 * Covers ADR-098, ADR-101, ADR-113 and the conversation summary tool.
 */

export const TICKET_TOOLS = [
  // === TICKET / ORCHESTRATION TOOLS (ADR-098) ===
  {
    type: 'function',
    function: {
      name: 'dispatch_task',
      description: 'Dispatch a subtask to a specialist agent by creating a ticket in the CRM. The ticket is created in backlog state and assigned to the specified agent.',
      parameters: {
        type: 'object',
        properties: {
          what: {
            type: 'string',
            description: 'Task title/description'
          },
          why: {
            type: 'string',
            description: 'Reason/context for the task'
          },
          assigned_to: {
            type: 'string',
            description: 'Agent name (e.g. "developer-ralph", "frontend") or user ID'
          },
          acceptance_criteria: {
            type: 'string',
            description: 'What constitutes done (markdown checklist)'
          },
          priority: {
            type: 'number',
            description: 'Priority option ID (default: 24274 = high)'
          },
          chain_id: {
            type: 'string',
            description: 'Chain ID for linking related tasks (auto-generated if omitted)'
          },
          parent_ticket_id: {
            type: 'number',
            description: 'Parent ticket ID in the chain'
          },
          execute_immediately: {
            type: 'boolean',
            description: 'If true, the AgentWorker picks up the ticket immediately instead of waiting for the next poll cycle (default: false)'
          }
        },
        required: ['what', 'assigned_to']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'update_ticket_status',
      description: 'Change a ticket\'s status with state machine validation. Validates that the transition is allowed (e.g. backlog→done is forbidden). Control gate: only humans can transition from "control" state.',
      parameters: {
        type: 'object',
        properties: {
          ticket_id: {
            type: 'number',
            description: 'Ticket row ID'
          },
          new_state: {
            type: 'string',
            description: 'Target state: backlog, assigned, in_progress, review, control, done, rejected'
          },
          notes: {
            type: 'string',
            description: 'Optional reason for the status change'
          }
        },
        required: ['ticket_id', 'new_state']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'send_ticket_message',
      description: 'Send a message in a ticket\'s bound conversation (ticket chat). Creates the conversation if it doesn\'t exist.',
      parameters: {
        type: 'object',
        properties: {
          ticket_id: {
            type: 'number',
            description: 'Ticket row ID'
          },
          content: {
            type: 'string',
            description: 'Message content (supports markdown)'
          }
        },
        required: ['ticket_id', 'content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_chain_status',
      description: 'Get the status and progress of a task chain. Returns completion percentage, task list with states, and current/next step.',
      parameters: {
        type: 'object',
        properties: {
          chain_id: {
            type: 'string',
            description: 'Chain identifier'
          }
        },
        required: ['chain_id']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_my_tasks',
      description: 'Get all pending tasks assigned to the calling agent (backlog, assigned, in_progress, rejected states).',
      parameters: {
        type: 'object',
        properties: {},
        required: []
      }
    }
  },

  // === INFLIGHT PAUSE REGISTRY (ADR-0063-A §P3) ===
  {
    type: 'function',
    function: {
      name: 'query_inflight_paused',
      description: 'List currently-paused agent runs from the _inflight_runs registry. Used by the watchdog to decide who to wake up after a rate-limit / awaiting-* pause clears. Read-only. Always scoped to the caller\'s space; an agent in space 1 (System) may opt-in to a cross-space admin view via admin:true. agent_slug and conversation_id filters AND-combine. Sorted by started_at DESC.',
      parameters: {
        type: 'object',
        properties: {
          agent_slug: {
            type: 'string',
            description: 'Optional agent slug to filter by (e.g. "developer-ralph", "architect"). Combine with conversation_id (AND) for a self-check call like { agent_slug: "<self>" }.'
          },
          conversation_id: {
            type: 'number',
            description: 'Optional conversation_id to filter by. Combine with agent_slug (AND) to scope a self-check to a single chat.'
          },
          admin: {
            type: 'boolean',
            description: 'If true AND caller is in space 1 (System), returns runs from every space. Silently dropped from any other space. Default false.'
          },
          limit: {
            type: 'number',
            description: 'Max rows to return (default 50, capped at 200).'
          }
        },
        required: []
      }
    }
  },

  // === CHAIN SUPERVISOR (ADR-101) ===
  {
    type: 'function',
    function: {
      name: 'supervisor_decide',
      description: 'Make a supervisor decision about the current chain cycle. Only available in supervisor mode (when ticket has _chain_memory). Goal-First: solve the CORE goal first, then optionally CONSULT owner about additional ideas.',
      parameters: {
        type: 'object',
        properties: {
          decision: {
            type: 'string',
            enum: ['CONTINUE', 'COMPLETE', 'CONSULT', 'ESCALATE'],
            description: 'CONTINUE: core goal NOT done, start new cycle. COMPLETE: core goal + approved options done. CONSULT: core goal done, optional ideas worth discussing with owner. ESCALATE: blocker needs human.'
          },
          reason: {
            type: 'string',
            description: 'Explanation of why this decision was made (1-2 sentences)'
          },
          next_cycle_plan: {
            type: 'string',
            description: 'Plan for the next cycle (REQUIRED if CONTINUE). Describe what tasks to create and for which agents.'
          },
          tasks: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                what: { type: 'string', description: 'Task description' },
                assigned_to: { type: 'string', description: 'Agent name: developer-ralph, frontend, test-runner, architect, etc.' },
              },
              required: ['what', 'assigned_to'],
            },
            description: 'Task list for next cycle (REQUIRED if CONTINUE). Max 8 tasks.'
          },
          final_report: {
            type: 'string',
            description: 'Final report for the project owner (REQUIRED if COMPLETE or ESCALATE)'
          },
          optional_ideas: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                idea: { type: 'string', description: 'Short description of the optional improvement' },
                benefit: { type: 'string', description: 'Why this could be valuable' },
              },
              required: ['idea', 'benefit'],
            },
            description: 'Optional ideas that emerged during work (REQUIRED if CONSULT). These are proposed to the owner for approval.'
          }
        },
        required: ['decision', 'reason']
      }
    }
  },

  // === PLANNING TOOL (ADR-113) ===
  {
    type: 'function',
    function: {
      name: 'manage_plan',
      description: 'Create or update a structured task plan for the current work. '
        + 'Use this at the start of complex tasks to decompose them into steps. '
        + 'Update task status as you work through them. '
        + 'Only one task should be in_progress at a time.',
      parameters: {
        type: 'object',
        properties: {
          tasks: {
            type: 'array',
            description: 'Full task list with current statuses',
            items: {
              type: 'object',
              properties: {
                id: {
                  type: 'number',
                  description: 'Task number (1-based, sequential)'
                },
                title: {
                  type: 'string',
                  description: 'Short task description (imperative: "Write tests", "Create migration")'
                },
                status: {
                  type: 'string',
                  enum: ['pending', 'in_progress', 'completed', 'blocked'],
                  description: 'Current task status'
                },
                note: {
                  type: 'string',
                  description: 'Optional: brief note about result or blocker'
                }
              },
              required: ['id', 'title', 'status']
            }
          }
        },
        required: ['tasks']
      }
    }
  },

  // === SUMMARY TOOL ===
  {
    type: 'function',
    function: {
      name: 'save_conversation_summary',
      description: 'Save a summary of the current conversation. The summary is stored in the conversation record and overwrites any previous summary. '
        + 'Use this after reviewing all messages to produce a concise TODO/checklist-style summary. '
        + 'Format: use markdown with ## Summary heading, **Key decisions:** with checkboxes, **What was done:** with bullets, **Status:** one-liner.',
      parameters: {
        type: 'object',
        properties: {
          conversation_id: {
            type: 'number',
            description: 'ID of the conversation to save summary for'
          },
          summary_text: {
            type: 'string',
            description: 'The summary text in Markdown format'
          }
        },
        required: ['conversation_id', 'summary_text']
      }
    }
  }
];
