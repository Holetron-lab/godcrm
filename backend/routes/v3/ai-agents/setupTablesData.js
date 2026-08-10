/**
 * Setup Tables Data
 * Contains table definitions, default agents, and default tools
 * for the POST /setup-tables endpoint.
 */

/**
 * Workspace Manager system prompt
 */
const workspaceManagerPrompt = `# Workspace Manager - AI Assistant

## About Business CRM

You are working in **Business CRM** — a modern low-code platform for business data management. It's a flexible system similar to Notion or Airtable, where users create custom data structures for their needs.

### Platform Capabilities:
- 📊 **Universal Tables** — create any tables with typed columns
- 🔗 **Data Relationships** — link columns connect records from different tables
- 📈 **Dashboards & Widgets** — data visualization via charts, kanban boards, timelines
- 🤖 **AI Agents** — intelligent assistants for working with data
- 🔄 **Automations** — automated actions on schedule or triggers
- 👥 **Multi-user Access** — roles and permissions

## Data Architecture

\`\`\`
🏢 Space — top level, isolated workspace
    └── 📁 Projects — logical groupings of tables
         └── 📋 Tables — store data in rows and columns
              ├── Columns — typed fields
              └── Rows — data records
    └── 📊 Dashboards — pages with widgets
         └── 🔲 Widgets — visualization components
\`\`\`

### Column Types
- **text** — short text
- **long_text** — multiline text, supports Markdown
- **number** — numbers (configurable format, min/max)
- **select** — single value from a list
- **multi-select** — multiple values
- **date** — date
- **datetime** — date and time
- **checkbox** — boolean (true/false)
- **url** — link
- **email** — email address
- **phone** — phone number
- **user** — reference to a user
- **link** — relationship to a record from another table
- **rollup** — aggregation of data from linked records
- **formula** — computed field
- **file** — attached files
- **color** — color (HEX)

## Your Role

You are the **Workspace Manager**, an intelligent assistant for working with data in the current space.

### Your Capabilities:
1. **Navigation** — help find tables, projects, records
2. **Search** — find data by keywords or conditions
3. **Analysis** — compute statistics, group, aggregate data
4. **Editing** — create/update/delete records (with confirmation)
5. **Explanation** — describe data structure and capabilities

## Available Tools

### Reading Data
- **list_tables** — get all tables with metadata
- **get_table_schema** — get table structure (columns and types)
- **query_table_data** — fetch records with pagination and filtering
- **search_data** — full-text search across tables
- **sql_query_readonly** — execute SELECT query (safe, read-only)
- **analyze_table_data** — get statistics (counts, sums, averages)
- **get_workspace_info** — information about spaces and projects

### Modifying Data
- **create_table** — create a new table with columns
- **add_table_row** — add a record
- **update_table_row** — update a record
- **delete_table_row** — delete a record

### Widgets
- **create_widget** — create a widget on a dashboard

## How to Work

### When Searching Data:
1. First use \`list_tables\` to discover available tables
2. Use \`get_table_schema\` to understand table structure
3. Use \`query_table_data\` to fetch records
4. For complex queries use \`sql_query_readonly\`

### When Analyzing:
1. Use \`analyze_table_data\` for quick statistics
2. For complex aggregations use SQL with GROUP BY
3. Present results in Markdown tables

### When Modifying Data:
1. **Always ask for confirmation** before modifying/deleting
2. Use exact column names from the schema
3. Validate data types

## Communication Style
- Be concise but informative
- Use Markdown for formatting
- Display data in tables when appropriate
- Explain your actions for complex queries
- Suggest next steps
- Respond in the same language as the user

## Context
You are working within a specific user's space. Use the tools to discover the current data structure — it's unique to each space.`;

export function getTableDefinitions() {
  return [
    { name: 'AI Operators', icon: '🔌', columns: [
      { name: 'name', type: 'text', isRequired: true },
      { name: 'provider', type: 'select', config: { options: [{ value: 'openai', label: 'OpenAI' }, { value: 'anthropic', label: 'Anthropic' }, { value: 'google', label: 'Google AI' }, { value: 'groq', label: 'Groq' }, { value: 'local', label: 'Local (Ollama)' }] } },
      { name: 'api_key', type: 'text' }, { name: 'api_url', type: 'text' },
      { name: 'status', type: 'select', config: { options: [{ value: 'active' }, { value: 'inactive' }] } },
      { name: 'description', type: 'long_text' }
    ]},
    { name: 'AI Agents', icon: '🤖', columns: [
      { name: 'name', type: 'text', isRequired: true }, { name: 'description', type: 'long_text' },
      { name: 'icon', type: 'text' }, { name: 'color', type: 'text' },
      { name: 'operator_id', type: 'number' }, { name: 'model', type: 'text' },
      { name: 'system_prompt', type: 'long_text' },
      { name: 'temperature', type: 'number', config: { min: 0, max: 2, step: 0.1 } },
      { name: 'max_tokens', type: 'number' }, { name: 'context_settings', type: 'long_text' },
      { name: 'status', type: 'select', config: { options: [{ value: 'active' }, { value: 'inactive' }] } },
      { name: 'response_mode', type: 'select', config: { options: [{ value: 'always', label: 'Always respond' }, { value: 'topic_only', label: 'Topic only' }, { value: 'mention_only', label: 'Mention only' }], defaultValue: 'mention_only' } },
      { name: 'group_chat_behavior', type: 'select', config: { options: [{ value: 'silent', label: 'Silent' }, { value: 'topic_only', label: 'Topic only' }, { value: 'respond_all', label: 'Respond to all' }], defaultValue: 'silent' } }
    ]},
    { name: 'AI Chat History', icon: '💬', columns: [
      { name: 'agent_id', type: 'number' }, { name: 'user_id', type: 'number' },
      { name: 'title', type: 'text' }, { name: 'messages', type: 'long_text' }, { name: 'created_at', type: 'datetime' }
    ]},
    { name: 'AI Run Logs', icon: '📝', columns: [
      { name: 'run_id', type: 'text' }, { name: 'agent_id', type: 'number' }, { name: 'timestamp', type: 'datetime' },
      { name: 'type', type: 'select', config: { options: [{ value: 'llm' }, { value: 'agent' }, { value: 'tool' }] } },
      { name: 'model', type: 'text' }, { name: 'provider', type: 'text' },
      { name: 'input_preview', type: 'long_text' }, { name: 'output_preview', type: 'long_text' },
      { name: 'tokens', type: 'number' }, { name: 'latency_ms', type: 'number' },
      { name: 'status', type: 'select', config: { options: [{ value: 'success' }, { value: 'error' }] } }
    ]},
    { name: 'AI Models', icon: '🧠', columns: [
      { name: 'name', type: 'text', isRequired: true }, { name: 'model_id', type: 'text', isRequired: true },
      { name: 'operator_id', type: 'number' }, { name: 'max_tokens', type: 'number' },
      { name: 'context_window', type: 'number' }, { name: 'input_price', type: 'number' }, { name: 'output_price', type: 'number' }
    ]},
    { name: 'Files', icon: '📁', columns: [
      { name: 'name', type: 'text', isRequired: true }, { name: 'original_name', type: 'text' },
      { name: 'mime_type', type: 'text' }, { name: 'size', type: 'number' }, { name: 'url', type: 'url' },
      { name: 'space_id', type: 'number' }, { name: 'project_id', type: 'number' }, { name: 'uploaded_by', type: 'user' },
      { name: 'storage_provider_id', type: 'text' }, { name: 'description', type: 'long_text' },
      { name: 'created_at', type: 'datetime' }, { name: 'updated_at', type: 'datetime' }
    ]},
    { name: 'Storage Providers', icon: '💾', columns: [
      { name: 'name', type: 'text', isRequired: true },
      { name: 'type', type: 'select', config: { options: [{ label: '💾 Local', value: 'local' }, { label: '☁️ S3', value: 's3' }, { label: '📁 Google Drive', value: 'google_drive' }, { label: '📦 Dropbox', value: 'dropbox' }] } },
      { name: 'is_default', type: 'checkbox' }, { name: 'is_enabled', type: 'checkbox' },
      { name: 'config', type: 'long_text' }, { name: 'created_at', type: 'datetime' }, { name: 'updated_at', type: 'datetime' }
    ]},
    { name: 'AI Tools', icon: '🔧', columns: [
      { name: 'name', type: 'text', isRequired: true, config: { icon: '🔧' } },
      { name: 'display_name', type: 'text', config: { icon: '📝' } },
      { name: 'description', type: 'long_text', config: { icon: '📄' } },
      { name: 'category', type: 'select', config: { icon: '📁', options: [{ value: 'data', label: 'Data Operations', color: '#3B82F6' }, { value: 'tables', label: 'Tables', color: '#10B981' }, { value: 'workspace', label: 'Workspace', color: '#8B5CF6' }, { value: 'widgets', label: 'Widgets', color: '#F59E0B' }, { value: 'analysis', label: 'Analysis', color: '#EC4899' }, { value: 'system', label: 'System', color: '#6B7280' }] } },
      { name: 'endpoint', type: 'text', config: { icon: '🌐' } },
      { name: 'method', type: 'select', config: { icon: '📤', options: [{ value: 'GET', label: 'GET', color: '#10B981' }, { value: 'POST', label: 'POST', color: '#3B82F6' }, { value: 'PUT', label: 'PUT', color: '#F59E0B' }, { value: 'DELETE', label: 'DELETE', color: '#EF4444' }] } },
      { name: 'parameters_schema', type: 'long_text', config: { icon: '📋' } },
      { name: 'required_scopes', type: 'multi-select', config: { icon: '🔐', options: [{ value: 'tables:read', label: 'Read Tables', color: '#3B82F6' }, { value: 'tables:write', label: 'Write Tables', color: '#10B981' }, { value: 'rows:read', label: 'Read Rows', color: '#8B5CF6' }, { value: 'rows:write', label: 'Write Rows', color: '#F59E0B' }, { value: 'widgets:read', label: 'Read Widgets', color: '#EC4899' }, { value: 'widgets:write', label: 'Write Widgets', color: '#6B7280' }] } },
      { name: 'is_active', type: 'checkbox', config: { icon: '✅' } },
      { name: 'usage_count', type: 'number', config: { icon: '📊' } },
      { name: 'avg_execution_ms', type: 'number', config: { icon: '⏱️' } }
    ]},
    { name: 'AI Usage Analytics', icon: '📈', columns: [
      { name: 'date', type: 'date' }, { name: 'agent_id', type: 'number' }, { name: 'total_requests', type: 'number' },
      { name: 'tokens_in', type: 'number' }, { name: 'tokens_out', type: 'number' }, { name: 'total_cost', type: 'number' },
      { name: 'avg_latency_ms', type: 'number' }, { name: 'error_count', type: 'number' }, { name: 'unique_users', type: 'number' }
    ]},
    { name: 'AI Feedback', icon: '⭐', columns: [
      { name: 'chat_id', type: 'number' }, { name: 'agent_id', type: 'number' }, { name: 'user_id', type: 'number' },
      { name: 'rating', type: 'select', config: { options: [{ value: 'positive', label: '👍' }, { value: 'negative', label: '👎' }, { value: 'neutral', label: '😐' }] } },
      { name: 'score', type: 'number', config: { min: 1, max: 5 } }, { name: 'comment', type: 'long_text' }, { name: 'created_at', type: 'datetime' }
    ]},
    { name: 'AI API Keys', icon: '🔑', columns: [
      { name: 'name', type: 'text', isRequired: true }, { name: 'api_key', type: 'text', config: { isSecret: true } },
      { name: 'operator_id', type: 'number' }, { name: 'description', type: 'text' },
      { name: 'status', type: 'select', config: { options: [{ value: 'active', label: 'Активный', color: '#22c55e' }, { value: 'inactive', label: 'Неактивный', color: '#6b7280' }, { value: 'expired', label: 'Истёк', color: '#ef4444' }] } },
      { name: 'expires_at', type: 'date' }, { name: 'usage_limit', type: 'number' }, { name: 'current_usage', type: 'number' }
    ]}
  ];
}

export function getDefaultAgents(operatorIds) {
  const anthropicId = operatorIds['Anthropic'] || null;
  const openaiId = operatorIds['OpenAI'] || null;
  const googleId = operatorIds['Google AI'] || null;

  return [
    { name: 'Workspace Manager', description: 'Workspace navigation, search and data management', icon: '🧭', color: '#3B82F6', operator_id: anthropicId, model: 'claude-sonnet-4-20250514', system_prompt: workspaceManagerPrompt, temperature: 0.3, max_tokens: 8192, status: 'active', response_mode: 'mention_only' },
    { name: 'Claude Assistant', description: 'Universal assistant powered by Claude', icon: '🤖', color: '#7C3AED', operator_id: anthropicId, model: 'claude-sonnet-4-20250514', system_prompt: 'You are a helpful AI assistant. Be concise and accurate. Respond in the same language as the user.', temperature: 0.7, max_tokens: 4096, status: 'active', response_mode: 'mention_only' },
    { name: 'GPT Assistant', description: 'Universal assistant powered by GPT-4', icon: '💬', color: '#10A37F', operator_id: openaiId, model: 'gpt-4o', system_prompt: 'You are a helpful AI assistant. Be concise and accurate. Respond in the same language as the user.', temperature: 0.7, max_tokens: 4096, status: 'active', response_mode: 'mention_only' },
    { name: 'Code Expert', description: 'Programming expert and code reviewer', icon: '👨‍💻', color: '#2563EB', operator_id: anthropicId, model: 'claude-sonnet-4-20250514', system_prompt: `You are an expert programmer and code reviewer.\n\n## Your Capabilities\n- Code review with security, performance, and best practices analysis\n- Debugging and error resolution\n- Writing clean, efficient, and maintainable code\n- Explaining complex code concepts\n- Suggesting refactoring improvements\n\n## Response Style\n- Always explain your reasoning\n- Provide code examples when helpful\n- Use markdown code blocks with language hints\n- Highlight potential issues with severity levels\n- Suggest tests when appropriate\n\nRespond in the same language as the user.`, temperature: 0.3, max_tokens: 8192, status: 'active', response_mode: 'mention_only' },
    { name: 'Data Analyst', description: 'Data analysis and visualization expert', icon: '📊', color: '#10B981', operator_id: anthropicId, model: 'claude-sonnet-4-20250514', system_prompt: `You are a data analyst expert.\n\n## Your Capabilities\n- Statistical analysis and data exploration\n- Pattern recognition and trend identification\n- Data visualization recommendations\n- SQL query optimization\n- Business insights extraction\n\n## Available Tools\nUse sql_query_readonly for complex queries with JOINs, GROUP BY, and aggregations.\nUse analyze_table_data for quick table statistics.\nUse query_table_data for fetching raw data.\n\n## Response Style\n- Present data in formatted tables\n- Provide clear statistical summaries\n- Explain findings in business terms\n- Suggest actionable next steps\n- Use charts/visualizations when appropriate\n\nRespond in the same language as the user.`, temperature: 0.3, max_tokens: 4096, status: 'active', response_mode: 'mention_only' },
    { name: 'Gemini Assistant', description: 'Assistant powered by Google Gemini', icon: '✨', color: '#EA4335', operator_id: googleId, model: 'gemini-2.0-flash', system_prompt: 'You are a helpful AI assistant powered by Google Gemini. Be concise and accurate. Respond in the same language as the user.', temperature: 0.7, max_tokens: 4096, status: 'active', response_mode: 'mention_only' }
  ];
}

export function getDefaultTools() {
  return [
    { name: 'list_tables', display_name: 'List Tables', description: 'Get a list of all tables in the workspace with metadata (ID, name, project, row count, columns). Use to explore data structure.', category: 'workspace', endpoint: '/api/v3/tables', method: 'GET', parameters_schema: JSON.stringify({ type: 'object', properties: { project_id: { type: 'integer', description: 'Project ID to filter by (optional)' }, space_id: { type: 'integer', description: 'Space ID to filter by (optional)' } }, required: [] }), required_scopes: ['tables:read'], is_active: true, usage_count: 0, avg_execution_ms: 0 },
    { name: 'get_workspace_info', display_name: 'Get Workspace Info', description: 'Get general workspace information: list of projects, table and row statistics, recent activity.', category: 'workspace', endpoint: '/api/v3/workspace/info', method: 'GET', parameters_schema: JSON.stringify({ type: 'object', properties: { space_id: { type: 'integer', description: 'Space ID (optional)' } }, required: [] }), required_scopes: ['tables:read'], is_active: true, usage_count: 0, avg_execution_ms: 0 },
    { name: 'get_table_schema', display_name: 'Get Table Schema', description: 'Get complete table schema: all columns with types, settings, relationships.', category: 'tables', endpoint: '/api/v3/tables/:tableId/columns', method: 'GET', parameters_schema: JSON.stringify({ type: 'object', properties: { tableId: { type: 'integer', description: 'Table ID' } }, required: ['tableId'] }), required_scopes: ['tables:read'], is_active: true, usage_count: 0, avg_execution_ms: 0 },
    { name: 'create_table', display_name: 'Create Table', description: 'Create a new table with columns.', category: 'tables', endpoint: '/api/v3/tables', method: 'POST', parameters_schema: JSON.stringify({ type: 'object', properties: { project_id: { type: 'integer', description: 'Project ID' }, name: { type: 'string', description: 'Table name' }, icon: { type: 'string', description: 'Emoji icon' }, description: { type: 'string' }, columns: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, display_name: { type: 'string' }, type: { type: 'string' }, is_required: { type: 'boolean' } } } } }, required: ['project_id', 'name'] }), required_scopes: ['tables:write'], is_active: true, usage_count: 0, avg_execution_ms: 0 },
    { name: 'query_table_data', display_name: 'Query Table Data', description: 'Get data from a table with pagination.', category: 'data', endpoint: '/api/v3/tables/:tableId/rows', method: 'GET', parameters_schema: JSON.stringify({ type: 'object', properties: { tableId: { type: 'integer', description: 'Table ID' }, limit: { type: 'integer', description: 'Max rows (default 50)' }, page: { type: 'integer' }, sort_by: { type: 'string' }, sort_order: { type: 'string', enum: ['asc', 'desc'] } }, required: ['tableId'] }), required_scopes: ['rows:read'], is_active: true, usage_count: 0, avg_execution_ms: 0 },
    { name: 'search_data', display_name: 'Search Data', description: 'Full-text search across all tables in the workspace.', category: 'data', endpoint: '/api/v3/search', method: 'GET', parameters_schema: JSON.stringify({ type: 'object', properties: { query: { type: 'string', description: 'Search query' }, tables: { type: 'array', items: { type: 'integer' } }, limit: { type: 'integer' } }, required: ['query'] }), required_scopes: ['rows:read'], is_active: true, usage_count: 0, avg_execution_ms: 0 },
    { name: 'sql_query_readonly', display_name: 'SQL Query (Read-Only)', description: 'Execute arbitrary SQL SELECT queries. Read-only.', category: 'data', endpoint: '/api/v3/ai/sql', method: 'POST', parameters_schema: JSON.stringify({ type: 'object', properties: { query: { type: 'string', description: 'SQL SELECT query' }, limit: { type: 'integer' } }, required: ['query'] }), required_scopes: ['rows:read', 'tables:read'], is_active: true, usage_count: 0, avg_execution_ms: 0 },
    { name: 'analyze_table_data', display_name: 'Analyze Table Data', description: 'Statistical analysis of a table.', category: 'analysis', endpoint: '/api/v3/tables/:tableId/analyze', method: 'GET', parameters_schema: JSON.stringify({ type: 'object', properties: { tableId: { type: 'integer', description: 'Table ID' }, columns: { type: 'array', items: { type: 'string' } } }, required: ['tableId'] }), required_scopes: ['rows:read'], is_active: true, usage_count: 0, avg_execution_ms: 0 },
    { name: 'add_table_row', display_name: 'Add Row', description: 'Add a new row to a table.', category: 'data', endpoint: '/api/v3/tables/:tableId/rows', method: 'POST', parameters_schema: JSON.stringify({ type: 'object', properties: { tableId: { type: 'integer' }, data: { type: 'object', description: 'Row data {column_name: value}' } }, required: ['tableId', 'data'] }), required_scopes: ['rows:write'], is_active: true, usage_count: 0, avg_execution_ms: 0 },
    { name: 'update_table_row', display_name: 'Update Row', description: 'Update an existing row.', category: 'data', endpoint: '/api/v3/tables/:tableId/rows/:rowId', method: 'PUT', parameters_schema: JSON.stringify({ type: 'object', properties: { tableId: { type: 'integer' }, rowId: { type: 'integer' }, data: { type: 'object' } }, required: ['tableId', 'rowId', 'data'] }), required_scopes: ['rows:write'], is_active: true, usage_count: 0, avg_execution_ms: 0 },
    { name: 'delete_table_row', display_name: 'Delete Row', description: 'Delete a row from a table. Irreversible.', category: 'data', endpoint: '/api/v3/tables/:tableId/rows/:rowId', method: 'DELETE', parameters_schema: JSON.stringify({ type: 'object', properties: { tableId: { type: 'integer' }, rowId: { type: 'integer' } }, required: ['tableId', 'rowId'] }), required_scopes: ['rows:write'], is_active: true, usage_count: 0, avg_execution_ms: 0 },
    { name: 'create_widget', display_name: 'Create Widget', description: 'Create a widget on a dashboard.', category: 'widgets', endpoint: '/api/v3/widgets', method: 'POST', parameters_schema: JSON.stringify({ type: 'object', properties: { dashboard_id: { type: 'integer' }, type: { type: 'string' }, name: { type: 'string' }, config: { type: 'object' } }, required: ['dashboard_id', 'type'] }), required_scopes: ['widgets:write'], is_active: true, usage_count: 0, avg_execution_ms: 0 }
  ];
}
