/**
 * Data & Table tool definitions.
 *
 * Covers: workspace info, table CRUD (rows, columns, schema), batch ops,
 * and statistical analysis.
 */

export const DATA_TOOLS = [
  // === CONSULTING TOOLS ===
  {
    type: 'function',
    function: {
      name: 'get_workspace_info',
      description: 'Get information about the current workspace including spaces, projects, and available tables',
      parameters: {
        type: 'object',
        properties: {
          space_id: {
            type: 'number',
            description: 'Space ID to get info for'
          }
        },
        required: ['space_id']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'query_table_data',
      description: 'Query data from a specific table with optional filtering. By default returns every column of each row. Pass fields:["colA","colB"] (ADR-182) to project only those user columns — id and created_at are always included; unrecognised names are ignored and echoed back in unknown_fields[]. Prefer fields to avoid pulling wide rows you don\'t need into context.',
      parameters: {
        type: 'object',
        properties: {
          table_id: {
            type: 'number',
            description: 'ID of the table to query'
          },
          limit: {
            type: 'number',
            description: 'Maximum number of rows to return (default: 100)'
          },
          search: {
            type: 'string',
            description: 'Search term to filter results'
          },
          fields: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional (ADR-182): allow-list of user column names to return per row. Omit for the full row (byte-identical default). id + created_at are always present; unrecognised names are ignored and reported in unknown_fields[].'
          }
        },
        required: ['table_id']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_table_schema',
      description: 'Get the schema (columns) of a specific table',
      parameters: {
        type: 'object',
        properties: {
          table_id: {
            type: 'number',
            description: 'ID of the table'
          }
        },
        required: ['table_id']
      }
    }
  },

  // === TABLE MANAGEMENT TOOLS ===
  {
    type: 'function',
    function: {
      name: 'create_table',
      description: 'Create a new table in a project with specified columns',
      parameters: {
        type: 'object',
        properties: {
          project_id: {
            type: 'number',
            description: 'Project ID where table will be created'
          },
          name: {
            type: 'string',
            description: 'Name of the new table'
          },
          icon: {
            type: 'string',
            description: 'Emoji icon for the table'
          },
          columns: {
            type: 'array',
            description: 'Array of column definitions',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string', description: 'Column name' },
                type: { type: 'string', description: 'Column type: text, number, select, date, checkbox, url, email' },
                icon: { type: 'string', description: 'Emoji icon' },
                required: { type: 'boolean', description: 'Is column required' }
              },
              required: ['name', 'type']
            }
          }
        },
        required: ['project_id', 'name', 'columns']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_table_row',
      description: 'Get a single row from a table by its ID. Returns the row data with all cell values and column metadata for display. Pass fields:["colA","colB"] (ADR-182) to project row.data down to only those columns — structural keys (id, base_id, table_id, timestamps) are always kept; unrecognised names are ignored and echoed back in unknown_fields[].',
      parameters: {
        type: 'object',
        properties: {
          table_id: {
            type: 'number',
            description: 'ID of the table containing the row'
          },
          row_id: {
            type: 'number',
            description: 'ID of the row to fetch'
          },
          fields: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional (ADR-182): allow-list of user column names to keep in row.data. Omit for the full row (byte-identical default). Structural keys always stay; unrecognised names are ignored and reported in unknown_fields[].'
          }
        },
        required: ['table_id', 'row_id']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'add_table_row',
      description: 'Add a new row to a table',
      parameters: {
        type: 'object',
        properties: {
          table_id: {
            type: 'number',
            description: 'ID of the table'
          },
          data: {
            type: 'object',
            description: 'Row data as key-value pairs'
          }
        },
        required: ['table_id', 'data']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_tables',
      description: 'List all tables. Can filter by project_id or space_id. If neither provided, returns empty.',
      parameters: {
        type: 'object',
        properties: {
          project_id: {
            type: 'number',
            description: 'Project ID (optional if space_id provided)'
          },
          space_id: {
            type: 'number',
            description: 'Space ID - returns all tables in the space'
          }
        },
        required: []
      }
    }
  },

  // === ANALYSIS TOOLS ===
  {
    type: 'function',
    function: {
      name: 'analyze_table_data',
      description: 'Perform statistical analysis on table data',
      parameters: {
        type: 'object',
        properties: {
          table_id: {
            type: 'number',
            description: 'ID of the table to analyze'
          },
          analysis_type: {
            type: 'string',
            enum: ['summary', 'distribution', 'trends', 'correlations'],
            description: 'Type of analysis to perform'
          },
          columns: {
            type: 'array',
            items: { type: 'string' },
            description: 'Specific columns to analyze (optional)'
          }
        },
        required: ['table_id', 'analysis_type']
      }
    }
  },

  // === P0 — Data Completeness (ADR-144) ===
  {
    type: 'function',
    function: {
      name: 'update_table_row',
      description: 'Update an existing row in a table. Merges provided data with existing row data (partial update). Returns a LEAN DIGEST by default (ADR-182): {success, table_id, row_id, changed[], bytes{field→len}, tail{field→last ~120 chars}} — NOT the whole row. Pass response:"full" to get the complete merged row back (RFC 7240 return=representation), or include_head:true to also see the first ~120 chars of each changed field. Prefer the default; re-read via get_table_row if you need the full value later.',
      parameters: {
        type: 'object',
        properties: {
          table_id: { type: 'number', description: 'ID of the table' },
          row_id: { type: 'number', description: 'ID of the row to update' },
          data: { type: 'object', description: 'Fields to update (merged with existing data)' },
          response: { type: 'string', enum: ['digest', 'full'], description: 'Response shape (default "digest"). "full" echoes the entire merged row.' },
          include_head: { type: 'boolean', description: 'When digesting, also return a ~120-char head preview per changed field (default false).' }
        },
        required: ['table_id', 'row_id', 'data']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'upsert_section',
      description: 'Idempotently ensure a marker-anchored section exists in a text field (ADR-182). If a line starting with `marker` exists, the section (from that line to the next same-or-higher markdown heading, or EOF) is REPLACED with `content`; otherwise `content` is APPENDED to the tail with one blank-line separator. Re-running with identical `content` is byte-idempotent — the marker is the idempotency key, so no client-side read-modify-write or hashing is needed. `content` MUST include the marker line. Returns the lean digest (never the whole field). Ideal for rolling one section into many rows (e.g. a footer across agent prompts).',
      parameters: {
        type: 'object',
        properties: {
          table_id: { type: 'number', description: 'ID of the table' },
          row_id: { type: 'number', description: 'ID of the row' },
          field: { type: 'string', description: 'Name of the text field to upsert the section into' },
          marker: { type: 'string', description: 'Line-anchored section marker, e.g. a heading like "## ⚙️ Friction footer". Matched at the start of a line.' },
          content: { type: 'string', description: 'Full section text INCLUDING the marker line. This exact block replaces or is appended as the section.' },
          response: { type: 'string', enum: ['digest', 'full'], description: 'Response shape (default "digest"). "full" echoes the entire merged row instead of the digest.' },
          include_head: { type: 'boolean', description: 'Also return a ~120-char head preview of the changed field (default false).' }
        },
        required: ['table_id', 'row_id', 'field', 'marker', 'content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'delete_table_row',
      description: 'Delete a single row from a table.',
      parameters: {
        type: 'object',
        properties: {
          table_id: { type: 'number', description: 'ID of the table' },
          row_id: { type: 'number', description: 'ID of the row to delete' }
        },
        required: ['table_id', 'row_id']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'batch_update_rows',
      description: 'Update multiple rows in a table at once. Max 100 rows per call. Each update merges data with existing. Returns a lean {success:[row_id,...], failed[]} summary by default (ADR-182); pass response:"full" to make each success entry a {row_id, data} object carrying the merged row.',
      parameters: {
        type: 'object',
        properties: {
          table_id: { type: 'number', description: 'ID of the table' },
          updates: {
            type: 'array',
            description: 'Array of {row_id, data} objects',
            items: {
              type: 'object',
              properties: {
                row_id: { type: 'number', description: 'Row ID' },
                data: { type: 'object', description: 'Fields to update' }
              },
              required: ['row_id', 'data']
            }
          },
          response: { type: 'string', enum: ['digest', 'full'], description: 'Response shape (default "digest"). "full" makes each success entry a {row_id, data} object instead of a bare row_id.' }
        },
        required: ['table_id', 'updates']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'batch_delete_rows',
      description: 'Delete multiple rows from a table at once. Max 100 row IDs per call.',
      parameters: {
        type: 'object',
        properties: {
          table_id: { type: 'number', description: 'ID of the table' },
          row_ids: {
            type: 'array',
            items: { type: 'number' },
            description: 'Array of row IDs to delete'
          }
        },
        required: ['table_id', 'row_ids']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'manage_columns',
      description: 'Create, update, or delete columns in a table schema. Action: "create" (needs name, type), "update" (needs column_id), "delete" (needs column_id).',
      parameters: {
        type: 'object',
        properties: {
          table_id: { type: 'number', description: 'ID of the table' },
          action: { type: 'string', enum: ['create', 'update', 'delete'], description: 'Operation to perform' },
          column_id: { type: 'number', description: 'Column ID (required for update/delete)' },
          name: { type: 'string', description: 'Column display name (for create/update)' },
          type: { type: 'string', description: 'Column type: text, number, select, date, checkbox, url, email, relation' },
          config: { type: 'object', description: 'Column configuration (icon, width, required, options, etc.)' }
        },
        required: ['table_id', 'action']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'delete_table',
      description: 'Delete an entire table including all rows and columns. Use with caution.',
      parameters: {
        type: 'object',
        properties: {
          table_id: { type: 'number', description: 'ID of the table to delete' }
        },
        required: ['table_id']
      }
    }
  },

  // === Marketplace staging — copy primitives (relation-aware, cascade rollback) ===
  {
    type: 'function',
    function: {
      name: 'copy_table',
      description: 'Clone a single table into another project. Modes: schema_only (columns only), full (schema + all rows), template (schema + rows with owner/timestamp/assignment fields auto-scrubbed). Relation columns whose target is NOT inside the copy scope are stripped by default — see dropped_relations in the response (or pass keep_external_relations:true to keep dangling pointers).',
      parameters: {
        type: 'object',
        properties: {
          src_table_id: { type: 'number', description: 'Source table ID' },
          dst_project_id: { type: 'number', description: 'Destination project ID (must already exist)' },
          name: { type: 'string', description: 'Name for the new table (default: "<src.name> (copy)")' },
          icon: { type: 'string', description: 'Icon (default: inherit from src)' },
          description: { type: 'string', description: 'Description (default: inherit from src)' },
          mode: { type: 'string', enum: ['schema_only', 'full', 'template'], description: 'Copy mode (default: full)' },
          row_filter: {
            type: 'object',
            description: 'Optional row constraints',
            properties: {
              limit: { type: 'number', description: 'Max rows to copy' }
            }
          },
          strip_columns: { type: 'array', items: { type: 'string' }, description: 'Column names to drop entirely (both schema and cells)' },
          keep_external_relations: { type: 'boolean', description: 'Keep relation columns whose target table is outside the copy scope (default false — they are stripped)' }
        },
        required: ['src_table_id', 'dst_project_id']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'copy_project',
      description: 'Clone a project (with ALL its non-system tables) into another space. Returns table_map of old→new IDs. Relation columns between tables in the same project are preserved and remapped to the new table/row IDs. System tables (_secrets, _secrets_audit) are skipped. On mid-op failure, every artifact created during the call is rolled back.',
      parameters: {
        type: 'object',
        properties: {
          src_project_id: { type: 'number', description: 'Source project ID' },
          dst_space_id: { type: 'number', description: 'Destination space ID (must already exist)' },
          name: { type: 'string', description: 'Name for the new project (default: "<src.name> (copy)")' },
          icon: { type: 'string', description: 'Icon (default: inherit)' },
          description: { type: 'string', description: 'Description (default: inherit)' },
          mode: { type: 'string', enum: ['schema_only', 'full', 'template'], description: 'Copy mode applied to every table (default: full)' },
          strip_columns: { type: 'array', items: { type: 'string' }, description: 'Column names dropped from every table in this op' },
          keep_external_relations: { type: 'boolean', description: 'Keep relation columns whose target table is outside the project (default false)' }
        },
        required: ['src_project_id', 'dst_space_id']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'copy_space',
      description: 'Clone an entire space (all projects + all non-system tables) into a NEW space owned by dst_owner_id (or caller). Returns project_map + table_map. Relations between tables anywhere in the space are preserved and remapped end-to-end. Full cascade rollback on failure.',
      parameters: {
        type: 'object',
        properties: {
          src_space_id: { type: 'number', description: 'Source space ID' },
          dst_owner_id: { type: 'number', description: 'Owner user ID for the new space (default: caller)' },
          name: { type: 'string', description: 'Name for the new space (default: "<src.name> (copy)")' },
          icon: { type: 'string', description: 'Icon (default: inherit)' },
          description: { type: 'string', description: 'Description (default: inherit)' },
          mode: { type: 'string', enum: ['schema_only', 'full', 'template'], description: 'Copy mode (default: full)' },
          strip_columns: { type: 'array', items: { type: 'string' }, description: 'Column names dropped from every table' },
          keep_external_relations: { type: 'boolean', description: 'Keep relations pointing outside the space (default false)' }
        },
        required: ['src_space_id']
      }
    }
  }
];
