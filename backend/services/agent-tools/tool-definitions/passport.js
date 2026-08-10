/**
 * Passport / Identity Tool Definitions — ADR-164 Phase 2.
 *
 * OpenAI function-calling schema for the agent-passport lifecycle tools.
 * Handlers live in ../passport-tools.js and delegate to the canonical
 * agent-users service (issuePassport / revokePassport).
 */

export const PASSPORT_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'issue_passport',
      description:
        'ADR-164: Naturalize an agent — grant it a global <<@handle>> passport so it can be invoked from any space (not just as a sub-agent in its own space). Idempotent: re-issuing an existing passport never creates a duplicate. Provide a handle plus one of row_id / user_id to locate the agent residence.',
      parameters: {
        type: 'object',
        properties: {
          handle: {
            type: 'string',
            description:
              'Global unique handle (slug) to assign, e.g. "cryptoralph". Case-insensitive; must be globally unique. If omitted, the agent row\'s slug/name is used.',
          },
          row_id: {
            type: 'number',
            description: 'Residence: the AI Agents table row id of the agent to naturalize.',
          },
          user_id: {
            type: 'number',
            description: 'Alternatively, the existing agent-user (passport) id to (re)issue a handle for.',
          },
          table_id: {
            type: 'number',
            description: 'Optional residence table id (informational; residence is keyed by row_id).',
          },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'revoke_passport',
      description:
        'ADR-164: Revoke an agent passport (soft). Clears the global handle so the agent is no longer invocable globally and is downgraded to a sub-agent within its own space. Does NOT delete the account; reversible via issue_passport. Provide handle or user_id.',
      parameters: {
        type: 'object',
        properties: {
          handle: {
            type: 'string',
            description: 'The current global handle of the agent to revoke.',
          },
          user_id: {
            type: 'number',
            description: 'Alternatively, the agent-user (passport) id to revoke.',
          },
        },
        required: [],
      },
    },
  },
];
