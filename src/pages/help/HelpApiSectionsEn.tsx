import {
    Bot,
    Code,
    Cpu,
    Key,
    MessageSquare,
    RefreshCw
} from 'lucide-react';

export function ApiSection() {
  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-3xl font-bold text-[var(--text-primary)] mb-4">
          <Code className="inline w-8 h-8 mr-2 text-indigo-500" />
          API Reference
        </h1>
        <p className="text-lg text-[var(--text-secondary)]">
          GOD CRM provides a REST API for integration with external systems.
          All endpoints require authentication.
        </p>
      </header>

      <section>
        <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-4">Authentication</h2>
        <div className="space-y-4">
          <p className="text-[var(--text-secondary)]">
            The API supports two authentication methods: JWT tokens and API keys.
          </p>

          <div className="bg-primary-500/10 rounded-xl p-6 border border-primary-500/30">
            <div className="flex items-center gap-3 mb-4">
              <Key className="w-5 h-5 text-primary-500" />
              <span className="text-[var(--text-primary)] font-medium">🔑 API Keys (recommended for integrations)</span>
            </div>
            <p className="text-sm text-[var(--text-secondary)] mb-4">
              Create an API key in Settings → API Keys. Keys start with <code className="bg-[var(--bg-secondary)] px-1 rounded">sk-</code>
            </p>
            <CodeBlock code={`X-API-Key: sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`} />
            <p className="text-sm text-[var(--text-secondary)] mt-3 mb-2">Or via Authorization header:</p>
            <CodeBlock code={`Authorization: Bearer sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`} />
          </div>

          <div className="bg-emerald-500/10 rounded-xl p-6 border border-emerald-500/30">
            <div className="flex items-center gap-3 mb-4">
              <Key className="w-5 h-5 text-emerald-500" />
              <span className="text-[var(--text-primary)] font-medium">🎫 JWT Tokens (for web applications)</span>
            </div>
            <p className="text-sm text-[var(--text-secondary)] mb-4">
              Get a token via <code className="bg-[var(--bg-secondary)] px-1 rounded">POST /api/v3/auth/login</code>
            </p>
            <CodeBlock code={`Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...`} />
          </div>
        </div>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-4">Base URL</h2>
        <CodeBlock code={`https://crm.hltrn.cc/api/v3`} />
      </section>

      <section>
        <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-4">API Keys Management</h2>
        <div className="space-y-4">
          <ApiEndpoint method="GET" path="/api-keys" description="List your API keys" />
          <ApiEndpoint method="POST" path="/api-keys" description="Create a new API key" body={`{
  "name": "n8n Integration",
  "scopes": ["*"],
  "expires_in_days": 90
}`} />
          <ApiEndpoint method="DELETE" path="/api-keys/:id" description="Revoke an API key" />

          <div className="bg-yellow-500/10 rounded-xl p-4 border border-yellow-500/30">
            <h4 className="font-medium text-[var(--text-primary)] mb-2">Available Scopes</h4>
            <div className="grid grid-cols-2 gap-2 text-sm text-[var(--text-secondary)]">
              <span>• <code className="bg-[var(--bg-secondary)] px-1 rounded">*</code> — full access</span>
              <span>• <code className="bg-[var(--bg-secondary)] px-1 rounded">tables:read</code></span>
              <span>• <code className="bg-[var(--bg-secondary)] px-1 rounded">tables:write</code></span>
              <span>• <code className="bg-[var(--bg-secondary)] px-1 rounded">rows:read</code></span>
              <span>• <code className="bg-[var(--bg-secondary)] px-1 rounded">rows:write</code></span>
              <span>• <code className="bg-[var(--bg-secondary)] px-1 rounded">widgets:read</code></span>
              <span>• <code className="bg-[var(--bg-secondary)] px-1 rounded">widgets:write</code></span>
            </div>
          </div>
        </div>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-4">Tables API</h2>
        <div className="space-y-4">
          <ApiEndpoint method="GET" path="/tables" description="List all tables" response={`{
  "success": true,
  "data": [
    { "id": 1, "name": "tasks", "displayName": "Tasks", ... }
  ]
}`} />
          <ApiEndpoint method="GET" path="/tables/:id" description="Get table details" response={`{
  "success": true,
  "data": { "id": 1, "name": "tasks", "columns": [...] }
}`} />
          <ApiEndpoint method="POST" path="/tables" description="Create a new table" body={`{
  "name": "contacts",
  "displayName": "Contacts",
  "projectId": 1,
  "columns": [
    { "name": "name", "type": "text" },
    { "name": "email", "type": "email" }
  ]
}`} />
          <ApiEndpoint method="PUT" path="/tables/:id" description="Update table settings" />
          <ApiEndpoint method="DELETE" path="/tables/:id" description="Delete a table" />
        </div>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-4">Columns API</h2>
        <div className="space-y-4">
          <ApiEndpoint method="GET" path="/tables/:tableId/columns" description="List table columns" />
          <ApiEndpoint method="POST" path="/tables/:tableId/columns" description="Add a column" body={`{
  "name": "status",
  "displayName": "Status",
  "type": "select",
  "config": {
    "options": [
      { "value": "new", "label": "New", "color": "#3b82f6" },
      { "value": "done", "label": "Done", "color": "#22c55e" }
    ]
  }
}`} />
          <ApiEndpoint method="PUT" path="/tables/:tableId/columns/:columnId" description="Update column" />
          <ApiEndpoint method="DELETE" path="/tables/:tableId/columns/:columnId" description="Delete column" />
        </div>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-4">Rows API</h2>
        <div className="space-y-4">
          <ApiEndpoint method="GET" path="/tables/:tableId/rows" description="List rows with pagination" response={`{
  "success": true,
  "data": {
    "rows": [
      { "id": 1, "data": { "name": "John", "email": "john@example.com" } }
    ],
    "pagination": { "page": 1, "limit": 50, "total": 100, "pages": 2 }
  }
}`} />
          <ApiEndpoint method="GET" path="/tables/:tableId/rows/:rowId" description="Get single row" />
          <ApiEndpoint method="POST" path="/tables/:tableId/rows" description="Create a row" body={`{
  "name": "Jane Doe",
  "email": "jane@example.com",
  "status": "new"
}`} />
          <ApiEndpoint method="PUT" path="/tables/:tableId/rows/:rowId" description="Update a row" body={`{
  "status": "done"
}`} />
          <ApiEndpoint method="DELETE" path="/tables/:tableId/rows/:rowId" description="Delete a row" />
        </div>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-4">Spaces & Projects API</h2>
        <div className="space-y-4">
          <ApiEndpoint method="GET" path="/spaces" description="List all spaces" />
          <ApiEndpoint method="POST" path="/spaces" description="Create a space" body={`{
  "name": "My Workspace",
  "icon": "🚀",
  "type": "business"
}`} />
          <ApiEndpoint method="GET" path="/projects" description="List all projects" />
          <ApiEndpoint method="POST" path="/projects" description="Create a project" body={`{
  "name": "Sales CRM",
  "spaceId": 1,
  "icon": "💼"
}`} />
        </div>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-4">Widgets API</h2>
        <div className="space-y-4">
          <ApiEndpoint method="GET" path="/widgets" description="List widgets" />
          <ApiEndpoint method="GET" path="/widgets/:id" description="Get widget details" />
          <ApiEndpoint method="POST" path="/widgets" description="Create a widget" body={`{
  "dashboardId": 1,
  "presetName": "kanban_board",
  "title": "Tasks Board",
  "config": {
    "tableId": 5,
    "groupByColumn": "status"
  }
}`} />
          <ApiEndpoint method="PUT" path="/widgets/:id" description="Update widget" />
          <ApiEndpoint method="DELETE" path="/widgets/:id" description="Delete widget" />
        </div>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-4">Error Responses</h2>
        <div className="bg-[var(--bg-secondary)] rounded-xl p-6 border border-[var(--border-primary)]">
          <p className="text-sm text-[var(--text-secondary)] mb-4">
            All errors follow a consistent format:
          </p>
          <CodeBlock code={`{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid input data",
    "details": { "field": "email", "issue": "Invalid email format" }
  }
}`} />
          <div className="mt-4 space-y-2">
            <div className="flex items-center gap-2 text-sm">
              <span className="px-2 py-0.5 bg-red-500/20 text-red-400 rounded text-xs font-mono">400</span>
              <span className="text-[var(--text-secondary)]">Bad Request — invalid input</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <span className="px-2 py-0.5 bg-yellow-500/20 text-yellow-400 rounded text-xs font-mono">401</span>
              <span className="text-[var(--text-secondary)]">Unauthorized — missing or invalid token</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <span className="px-2 py-0.5 bg-orange-500/20 text-orange-400 rounded text-xs font-mono">403</span>
              <span className="text-[var(--text-secondary)]">Forbidden — insufficient permissions</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <span className="px-2 py-0.5 bg-gray-500/20 text-gray-400 rounded text-xs font-mono">404</span>
              <span className="text-[var(--text-secondary)]">Not Found — resource doesn&apos;t exist</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <span className="px-2 py-0.5 bg-red-500/20 text-red-400 rounded text-xs font-mono">500</span>
              <span className="text-[var(--text-secondary)]">Server Error — something went wrong</span>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

// === HELPER COMPONENTS ===

function CodeBlock({ code }: { code: string }) {
  return (
    <pre className="px-4 py-3 bg-[var(--bg-tertiary)] rounded-lg overflow-x-auto">
      <code className="text-sm text-emerald-400 whitespace-pre">{code}</code>
    </pre>
  );
}

function ApiEndpoint({ method, path, description, body, response }: { method: string; path: string; description: string; body?: string; response?: string }) {
  const methodColors: Record<string, string> = {
    GET: 'bg-emerald-500/20 text-emerald-400',
    POST: 'bg-primary-500/20 text-primary-400',
    PUT: 'bg-amber-500/20 text-amber-400',
    PATCH: 'bg-amber-500/20 text-amber-400',
    DELETE: 'bg-red-500/20 text-red-400',
  };
  return (
    <div className="p-4 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-primary)]">
      <div className="flex items-center gap-3 mb-2">
        <span className={`px-2 py-1 rounded text-xs font-mono font-semibold ${methodColors[method]}`}>{method}</span>
        <code className="text-sm text-[var(--text-primary)]">{path}</code>
      </div>
      <p className="text-sm text-[var(--text-secondary)] mb-3">{description}</p>
      {body && (
        <div className="mb-3">
          <p className="text-xs text-[var(--text-tertiary)] mb-1">Request Body:</p>
          <CodeBlock code={body} />
        </div>
      )}
      {response && (
        <div>
          <p className="text-xs text-[var(--text-tertiary)] mb-1">Response:</p>
          <CodeBlock code={response} />
        </div>
      )}
    </div>
  );
}

// === AI AGENTS API SECTION ===

export function AIAgentsApiSection() {
  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-3xl font-bold text-[var(--text-primary)] mb-4">
          <Bot className="inline w-8 h-8 mr-2 text-violet-500" />
          AI Agents API
        </h1>
        <p className="text-lg text-[var(--text-secondary)]">
          API for working with AI agents, providers, and models. Manage artificial
          intelligence in your workspace.
        </p>
      </header>

      {/* Overview */}
      <section>
        <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-4">🎯 Overview</h2>
        <div className="grid grid-cols-2 gap-4">
          <div className="p-4 rounded-xl bg-violet-500/10 border border-violet-500/30">
            <Bot className="w-6 h-6 text-violet-500 mb-2" />
            <h4 className="font-medium text-[var(--text-primary)]">AI Agents</h4>
            <p className="text-sm text-[var(--text-secondary)]">Create and manage intelligent assistants</p>
          </div>
          <div className="p-4 rounded-xl bg-primary-500/10 border border-primary-500/30">
            <MessageSquare className="w-6 h-6 text-primary-500 mb-2" />
            <h4 className="font-medium text-[var(--text-primary)]">Chat with Agents</h4>
            <p className="text-sm text-[var(--text-secondary)]">Send messages and receive AI responses</p>
          </div>
          <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30">
            <Cpu className="w-6 h-6 text-emerald-500 mb-2" />
            <h4 className="font-medium text-[var(--text-primary)]">Providers</h4>
            <p className="text-sm text-[var(--text-secondary)]">OpenAI, Anthropic, Google, Ollama</p>
          </div>
          <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30">
            <RefreshCw className="w-6 h-6 text-amber-500 mb-2" />
            <h4 className="font-medium text-[var(--text-primary)]">Models</h4>
            <p className="text-sm text-[var(--text-secondary)]">GPT-4, Claude, Gemini and more</p>
          </div>
        </div>
      </section>

      {/* Base URL */}
      <section>
        <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-4">🌐 Base URL</h2>
        <CodeBlock code="https://crm.hltrn.cc/api/v3/ai" />
      </section>

      {/* Agents API */}
      <section>
        <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-4">🤖 Agents</h2>
        <div className="space-y-4">
          <ApiEndpoint method="GET" path="/ai/agents" description="Get list of all agents" />
          <ApiEndpoint method="GET" path="/ai/agents/:spaceId" description="Get agents for a specific space" />
          <ApiEndpoint method="POST" path="/ai/agents" description="Create a new agent" body={`{
  "name": "Sales Assistant",
  "description": "Helps with sales data",
  "model": "gpt-4-turbo",
  "provider": "openai",
  "system_prompt": "You are a helpful sales assistant...",
  "tools": ["query_table_data", "create_row"]
}`} />
          <ApiEndpoint method="PATCH" path="/ai/agents/:id" description="Update an agent" />
          <ApiEndpoint method="DELETE" path="/ai/agents/:id" description="Delete an agent" />
        </div>
      </section>

      {/* Chat API */}
      <section>
        <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-4">💬 Chat with Agent</h2>
        <div className="space-y-4">
          <ApiEndpoint method="POST" path="/ai/chat" description="Send a message to agent and receive response" body={`{
  "agentId": 1,
  "message": "Show me sales statistics for this month",
  "conversationId": "conv_abc123",
  "context": { "spaceId": 5, "tableId": 12 }
}`} />

          <div className="p-4 rounded-xl bg-primary-500/10 border border-primary-500/30">
            <h4 className="font-medium text-[var(--text-primary)] mb-2">Response Example</h4>
            <CodeBlock code={`{
  "success": true,
  "response": "Here's the sales data for this month...",
  "conversationId": "conv_abc123",
  "model": "gpt-4-turbo",
  "usage": {
    "promptTokens": 150,
    "completionTokens": 85,
    "totalTokens": 235
  }
}`} />
          </div>

          <ApiEndpoint method="GET" path="/ai/conversations/:conversationId" description="Get conversation history" />
          <ApiEndpoint method="DELETE" path="/ai/conversations/:conversationId" description="Delete a conversation" />
        </div>
      </section>

      {/* Providers API */}
      <section>
        <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-4">🔌 AI Providers</h2>
        <div className="space-y-4">
          <ApiEndpoint method="GET" path="/ai/providers" description="Get list of AI providers" />

          <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30">
            <h4 className="font-medium text-[var(--text-primary)] mb-2">Supported Providers</h4>
            <div className="grid grid-cols-2 gap-2 text-sm text-[var(--text-secondary)]">
              <span>• <code className="bg-[var(--bg-secondary)] px-1 rounded">openai</code> — OpenAI (GPT-4, GPT-3.5)</span>
              <span>• <code className="bg-[var(--bg-secondary)] px-1 rounded">anthropic</code> — Anthropic (Claude)</span>
              <span>• <code className="bg-[var(--bg-secondary)] px-1 rounded">google</code> — Google (Gemini)</span>
              <span>• <code className="bg-[var(--bg-secondary)] px-1 rounded">ollama</code> — Ollama (local models)</span>
            </div>
          </div>

          <ApiEndpoint method="POST" path="/ai/providers" description="Add a provider" body={`{
  "name": "OpenAI",
  "provider_key": "openai",
  "base_url": "https://api.openai.com/v1",
  "is_active": true
}`} />
          <ApiEndpoint method="PATCH" path="/ai/providers/:id" description="Update a provider" />
          <ApiEndpoint method="DELETE" path="/ai/providers/:id" description="Delete a provider" />
        </div>
      </section>

      {/* Models API */}
      <section>
        <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-4">🧠 Models</h2>
        <div className="space-y-4">
          <ApiEndpoint method="GET" path="/ai/models" description="Get list of all models" />
          <ApiEndpoint method="GET" path="/ai/models?providerId=:id" description="Get models for a specific provider" />

          <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30">
            <h4 className="font-medium text-[var(--text-primary)] mb-2">Popular Models</h4>
            <div className="space-y-2 text-sm text-[var(--text-secondary)]">
              <p><strong>OpenAI:</strong> gpt-4-turbo, gpt-4o, gpt-3.5-turbo</p>
              <p><strong>Anthropic:</strong> claude-3-5-sonnet-20241022, claude-3-opus</p>
              <p><strong>Google:</strong> gemini-1.5-pro, gemini-1.5-flash</p>
              <p><strong>Ollama:</strong> llama3.2, mistral, codellama</p>
            </div>
          </div>

          <ApiEndpoint method="POST" path="/ai/models" description="Add a model" body={`{
  "provider_id": 1,
  "model_id": "gpt-4-turbo",
  "display_name": "GPT-4 Turbo",
  "context_window": 128000,
  "is_active": true
}`} />
          <ApiEndpoint method="PATCH" path="/ai/models/:id" description="Update a model" />
          <ApiEndpoint method="DELETE" path="/ai/models/:id" description="Delete a model" />
        </div>
      </section>

      {/* Refresh Models */}
      <section>
        <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-4">🔄 Refresh Models</h2>
        <div className="space-y-4">
          <ApiEndpoint method="POST" path="/ai/providers/:providerId/refresh-models" description="Refresh model list from provider API" />

          <div className="p-4 rounded-xl bg-purple-500/10 border border-purple-500/30">
            <h4 className="font-medium text-[var(--text-primary)] mb-2">Response Example</h4>
            <CodeBlock code={`{
  "success": true,
  "message": "Updated models: 17",
  "added": 12,
  "updated": 5,
  "models": [
    { "model_id": "gpt-4-turbo", "display_name": "GPT-4 Turbo" },
    { "model_id": "gpt-4o", "display_name": "GPT-4o" }
  ]
}`} />
          </div>

          <div className="p-4 rounded-xl bg-yellow-500/10 border border-yellow-500/30">
            <h4 className="font-medium text-[var(--text-primary)] mb-2">⚠️ Important</h4>
            <p className="text-sm text-[var(--text-secondary)]">
              Refreshing models requires a configured API key for the provider in the API Keys table.
              Automatic refresh is supported for OpenAI and Anthropic.
            </p>
          </div>
        </div>
      </section>

      {/* Agent Tools */}
      <section>
        <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-4">🛠️ Agent Tools</h2>
        <div className="space-y-4">
          <p className="text-[var(--text-secondary)]">
            Agents can use tools to interact with the CRM.
          </p>

          <div className="bg-[var(--bg-secondary)] rounded-xl border border-[var(--border-primary)] divide-y divide-[var(--border-primary)]">
            <ToolRow name="get_workspace_info" description="Get information about spaces, projects, and tables" />
            <ToolRow name="query_table_data" description="Query data from a table" />
            <ToolRow name="create_table" description="Create a new table" />
            <ToolRow name="create_row" description="Add a record to a table" />
            <ToolRow name="update_row" description="Update a record in a table" />
            <ToolRow name="create_dashboard" description="Create a dashboard" />
            <ToolRow name="create_widget" description="Add a widget to dashboard" />
            <ToolRow name="search_records" description="Search records by criteria" />
          </div>
        </div>
      </section>

      {/* Examples */}
      <section>
        <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-4">💡 Usage Examples</h2>
        <div className="space-y-4">
          <div className="rounded-xl border border-[var(--border-primary)] overflow-hidden">
            <div className="px-4 py-2 bg-[var(--bg-secondary)] border-b border-[var(--border-primary)]">
              <span className="text-sm font-medium text-[var(--text-primary)]">Send message to agent (cURL)</span>
            </div>
            <CodeBlock code={`curl -X POST https://crm.hltrn.cc/api/v3/ai/chat \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_TOKEN" \\
  -d '{
    "agentId": 1,
    "message": "Show sales statistics for this month",
    "context": { "spaceId": 5, "tableId": 12 }
  }'`} />
          </div>

          <div className="rounded-xl border border-[var(--border-primary)] overflow-hidden">
            <div className="px-4 py-2 bg-[var(--bg-secondary)] border-b border-[var(--border-primary)]">
              <span className="text-sm font-medium text-[var(--text-primary)]">JavaScript / Fetch</span>
            </div>
            <CodeBlock code={`const response = await fetch('/api/v3/ai/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    agentId: 1,
    message: 'Create a report on tasks',
    conversationId: 'conv_existing_id'
  })
});

const { response: aiResponse, usage } = await response.json();
logger.debug('AI responded:', aiResponse);
logger.debug('Tokens used:', usage.totalTokens);`} />
          </div>
        </div>
      </section>

      {/* Error Handling */}
      <section>
        <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-4">⚠️ Error Handling</h2>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-primary)]">
              <span className="font-mono text-red-500">400</span>
              <span className="text-[var(--text-secondary)] ml-2">Bad Request</span>
            </div>
            <div className="p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-primary)]">
              <span className="font-mono text-yellow-500">401</span>
              <span className="text-[var(--text-secondary)] ml-2">Unauthorized</span>
            </div>
            <div className="p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-primary)]">
              <span className="font-mono text-orange-500">404</span>
              <span className="text-[var(--text-secondary)] ml-2">Agent Not Found</span>
            </div>
            <div className="p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-primary)]">
              <span className="font-mono text-red-500">500</span>
              <span className="text-[var(--text-secondary)] ml-2">AI Provider Error</span>
            </div>
          </div>
          <CodeBlock code={`{
  "success": false,
  "error": "AI_PROVIDER_ERROR",
  "message": "OpenAI API rate limit exceeded",
  "details": {
    "provider": "openai",
    "model": "gpt-4-turbo"
  }
}`} />
        </div>
      </section>
    </div>
  );
}

function ToolRow({ name, description }: { name: string; description: string }) {
  return (
    <div className="flex items-center gap-4 px-4 py-3">
      <code className="px-2 py-1 text-xs bg-violet-500/20 rounded text-violet-400 font-mono">
        {name}
      </code>
      <span className="text-sm text-[var(--text-secondary)]">{description}</span>
    </div>
  );
}
