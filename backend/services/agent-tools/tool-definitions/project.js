/**
 * Document & Project tool definitions.
 */

export const PROJECT_TOOLS = [
  // === Documents ===
  {
    type: 'function',
    function: {
      name: 'list_documents',
      description: 'List documents stored in the registry table bound to the given widget. The widget\'s config defines which registry & atoms tables to read. Use `get_dashboard_widgets(dashboard_id)` to discover the documents widget on a dashboard.',
      parameters: {
        type: 'object',
        properties: {
          widget_id: { type: 'number', description: 'ID of the Documents widget that owns the store. Find via `get_dashboard_widgets(dashboard_id)`.' },
          search: { type: 'string', description: 'Search in document titles' },
          limit: { type: 'number', description: 'Max results (default: 50)' },
          include_archived: { type: 'boolean', description: 'Include documents with status=archived (default: false — archived docs are hidden)' }
        },
        required: ['widget_id']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_document_content',
      description: 'Get full document content (all atoms + rendered markdown) for a document in the registry bound to the given widget.',
      parameters: {
        type: 'object',
        properties: {
          widget_id: { type: 'number', description: 'ID of the Documents widget that owns the store. Find via `get_dashboard_widgets(dashboard_id)`.' },
          document_id: { type: 'number', description: 'ID of the document row' }
        },
        required: ['widget_id', 'document_id']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'create_document',
      description: 'Create a new document in the widget\'s registry and its per-doc companion table (canonical v4 model). If `content` is a markdown string, headings (#/##/###), paragraphs, and dividers are parsed into sections and inserted into the companion table. Returns `document_id`, `registry_table_id` (the table that holds the document row — pass to `send_widget_message` to chip the doc into a chat), `table_id` (per-doc atoms table), and section count.',
      parameters: {
        type: 'object',
        properties: {
          widget_id: { type: 'number', description: 'ID of the Documents widget that owns the store. Find via `get_dashboard_widgets(dashboard_id)`.' },
          title: { type: 'string', description: 'Document title' },
          icon: { type: 'string', description: 'Emoji icon (default: 📄)' },
          content: { type: 'string', description: 'Initial document content — markdown preferred (# / ## / ### are parsed into h1/h2/h3 sections, --- into dividers, other lines into text sections).' },
          status: { type: 'string', enum: ['draft', 'review', 'approved', 'ready', 'published', 'archived'], description: 'Document status slug. Resolved against _doc_statuses registry (ADR-0001 §5) → status_id relation. Default: "draft".' }
        },
        required: ['widget_id', 'title']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'delete_document',
      description: 'Delete a document and all its atoms from the store bound to the given widget.',
      parameters: {
        type: 'object',
        properties: {
          widget_id: { type: 'number', description: 'ID of the Documents widget that owns the store. Find via `get_dashboard_widgets(dashboard_id)`.' },
          document_id: { type: 'number', description: 'ID of the document to delete' }
        },
        required: ['widget_id', 'document_id']
      }
    }
  },

  // === Projects ===
  {
    type: 'function',
    function: {
      name: 'list_projects',
      description: 'List all projects in a space.',
      parameters: {
        type: 'object',
        properties: {
          space_id: { type: 'number', description: 'Space ID' },
          limit: { type: 'number', description: 'Max results (default: 50)' }
        },
        required: ['space_id']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'create_project',
      description: 'Create a new project in a space.',
      parameters: {
        type: 'object',
        properties: {
          space_id: { type: 'number', description: 'Space ID' },
          name: { type: 'string', description: 'Project name' },
          icon: { type: 'string', description: 'Emoji icon (default: 📁)' },
          description: { type: 'string', description: 'Project description' }
        },
        required: ['space_id', 'name']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'update_project',
      description: 'Update a project name, icon, or description.',
      parameters: {
        type: 'object',
        properties: {
          project_id: { type: 'number', description: 'Project ID' },
          name: { type: 'string', description: 'New name' },
          icon: { type: 'string', description: 'New icon' },
          description: { type: 'string', description: 'New description' }
        },
        required: ['project_id']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'delete_project',
      description: 'Delete a project. Fails if project contains tables.',
      parameters: {
        type: 'object',
        properties: {
          project_id: { type: 'number', description: 'Project ID to delete' }
        },
        required: ['project_id']
      }
    }
  },

  // === ADR-0045 P1 — space/project move primitives ===
  {
    type: 'function',
    function: {
      name: 'create_space',
      description: 'Create a new top-level space. The caller becomes owner. `is_public` toggles visibility between "open" (anyone in the workspace can see) and "internal" (default).',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Space name' },
          type: { type: 'string', description: 'Space type slug (e.g. business, personal, ai, kanban)' },
          icon: { type: 'string', description: 'Emoji icon (default: 📁)' },
          description: { type: 'string', description: 'Space description' },
          is_public: { type: 'boolean', description: 'When true, visibility is "open"; otherwise "internal" (default: false)' }
        },
        required: ['name', 'type']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'move_project_to_space',
      description: 'Move a project to a different space. Verifies the target space exists and that the caller can administer both the source and target spaces. Only updates projects.space_id — does not touch tables/data.',
      parameters: {
        type: 'object',
        properties: {
          project_id: { type: 'number', description: 'ID of the project to move' },
          space_id: { type: 'number', description: 'Target space ID' }
        },
        required: ['project_id', 'space_id']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'move_table_to_project',
      description: 'Reparent a universal_tables row to a different project. Safe — does not rename the table or move any row/column data, only updates universal_tables.project_id. Caller must admin both source and target project spaces.',
      parameters: {
        type: 'object',
        properties: {
          table_id: { type: 'number', description: 'ID of the table (universal_tables row) to move' },
          project_id: { type: 'number', description: 'Target project ID' }
        },
        required: ['table_id', 'project_id']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'delete_project_cascade',
      description: 'DESTRUCTIVE: drop a project together with every universal_table under it (with rows + columns) and every dashboard under it (with widgets), all in a single transaction. Requires admin on the project space. SAFETY: you MUST call with `dry_run: true` first in the same conversation to get a preview; calls without a prior preview return error PREVIEW_REQUIRED. The preview is valid for 10 minutes.',
      parameters: {
        type: 'object',
        properties: {
          project_id: { type: 'number', description: 'ID of the project to cascade-delete' },
          dry_run: { type: 'boolean', description: 'When true, returns a preview { tables_to_drop, rows_count, dashboards_count } without making changes. Must be true on first call.' }
        },
        required: ['project_id']
      }
    }
  }
];
