/**
 * File-system tool definitions (read / write / list / search / edit / upload).
 */

export const FILE_TOOLS = [
  // === CONVERSATION INTROSPECTION TOOLS ===
  {
    type: 'function',
    function: {
      name: 'view_conversation_steps',
      description: 'View a summary of all past agent steps (thinking, tool calls, tool results) in the current conversation. Returns a compact list with message IDs that can be used with view_step_detail to see full content.',
      parameters: {
        type: 'object',
        properties: {
          conversation_id: {
            type: 'number',
            description: 'The conversation ID to inspect'
          }
        },
        required: ['conversation_id']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'view_step_detail',
      description: 'View the full content of a specific step message by its ID. Use after view_conversation_steps to drill into a specific tool result or thinking block.',
      parameters: {
        type: 'object',
        properties: {
          message_id: {
            type: 'number',
            description: 'The message ID to retrieve full content for'
          }
        },
        required: ['message_id']
      }
    }
  },

  // === FILE SYSTEM TOOLS ===
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read the content of a file in the project. Path is relative to the project root. Max 100KB.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Relative file path, e.g. "src/App.tsx" or "backend/server.js"'
          },
          line_start: {
            type: 'number',
            description: 'Optional start line (1-based) to read a range'
          },
          line_end: {
            type: 'number',
            description: 'Optional end line (1-based) to read a range'
          }
        },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Write or create a file. Auto-backs up existing files. Path is relative to project root.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Relative file path to write'
          },
          content: {
            type: 'string',
            description: 'Full file content to write'
          }
        },
        required: ['path', 'content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_directory',
      description: 'List files and directories. Path is relative to project root. Max 2 levels deep.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Relative directory path (default: ".")'
          },
          depth: {
            type: 'number',
            description: 'How many levels deep to recurse (default: 1, max: 2)'
          },
          pattern: {
            type: 'string',
            description: 'Optional glob-like filter, e.g. "*.tsx" or "*.js"'
          }
        },
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'search_files',
      description: 'Search for text/regex across project files. Like grep. Returns matching lines with file paths.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Search text or regex pattern'
          },
          path: {
            type: 'string',
            description: 'Directory to search in (relative to project root, default: ".")'
          },
          file_pattern: {
            type: 'string',
            description: 'File extension filter, e.g. "*.ts" or "*.js"'
          },
          case_sensitive: {
            type: 'boolean',
            description: 'Case-sensitive search (default: false)'
          }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'edit_file',
      description: 'Find and replace text in a file. Auto-backs up before editing. Path is relative to project root.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Relative file path to edit'
          },
          old_text: {
            type: 'string',
            description: 'Exact text to find (must be unique in the file)'
          },
          new_text: {
            type: 'string',
            description: 'Replacement text'
          },
          replace_all: {
            type: 'boolean',
            description: 'Replace all occurrences (default: false, replaces first only)'
          }
        },
        required: ['path', 'old_text', 'new_text']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'upload_file',
      description: 'Upload a file from a local path or URL. Stores in CRM file storage and returns the file URL.',
      parameters: {
        type: 'object',
        properties: {
          source: { type: 'string', description: 'Local file path or HTTP(S) URL to upload' },
          space_id: { type: 'number', description: 'Space ID to associate the file with (optional)' },
          project_id: { type: 'number', description: 'Project ID to associate the file with (optional; system files like avatars or agent generations have no project)' },
          folder: { type: 'string', description: 'Sub-folder for organization (default: "mcp")' },
          description: { type: 'string', description: 'File description' },
          visibility: { type: 'string', enum: ['private', 'internal', 'public'], description: 'Who can read the file. Default: internal (any logged-in user). Use "public" for public assets, "private" for system snapshots.' }
        },
        required: ['source']
      }
    }
  }
];
