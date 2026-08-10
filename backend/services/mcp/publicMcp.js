/**
 * Public, no-signup MCP mount (NO-SIGNUP-MCP.md Stream B, v2).
 *
 * Mounted under the ADR-105 public-space router as `/s/:slug/mcp`. The space
 * slug in the URL is the identity: `publicSpaceAccess` resolves and PINS
 * `req.publicSpace` before this handler runs.
 *
 * SECURITY MODEL (why this is not `executeTool`):
 *   - DATA isolation comes from the space-gated `public.js` loaders. Every
 *     loader takes `spaceId` from `req.publicSpace` (never caller args) and
 *     re-checks space membership, so a table/row/doc id from another tenant
 *     resolves to `not_found`. `executeTool` — which keys off raw table_id with
 *     no space gate — is NOT on this path.
 *   - CAPABILITY isolation comes from `PUBLIC_ALLOWLIST`: an explicit allow-set,
 *     never a deny-set. A tool is public iff it has a gated loader behind it.
 *   Both gates are required. Adding a name to the allow-set without a handler
 *   throws at module load (fail closed) — see the boot assertion below.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { buildToolList } from './buildToolList.js';
import { apiLogger } from '../../utils/logger.js';
import { memoryToolHandlers } from '../agent-tools/memory-tools.js';
import { assessGrounding } from '../dcd/fastGuardrail.js';
import { routeMemoryScope } from '../dcd/scopeRouter.js';
import {
  loadPublicTable,
  loadPublicTableSchema,
  fetchPublicRows,
  fetchPublicRowById,
  clampPagination,
  loadPublicTree,
  loadPublicDocumentsRegistry,
  loadPublicDocument,
  listPublicDashboardWidgets,
} from '../../routes/v3/public.js';

// The lore bank — read-only, public, NEVER the private `godcrm-main` bank.
// Pinned at the mount so a caller can never redirect `memory_recall` at the
// agent's private memory (NO-SIGNUP-MCP §B3 Hindsight note).
export const PUBLIC_MEMORY_BANK = 'godcrm-public';

const NOT_FOUND = { error: 'not_found' };

/**
 * Per-tool public handlers. Each receives `(args, space)` where `space` is the
 * pinned `req.publicSpace`; the only scope source is `space.id`. Each wraps a
 * space-gated `public.js` loader; a loader returning null surfaces as
 * `not_found`, never a fallback to an un-gated path.
 */
export const PUBLIC_MCP_HANDLERS = {
  async list_projects(args, space) {
    const tree = await loadPublicTree(space);
    return { projects: tree.projects.map(p => ({ id: p.id, name: p.name, icon: p.icon })) };
  },

  async list_tables(args, space) {
    const tree = await loadPublicTree(space);
    let tables = tree.projects.flatMap(p =>
      p.tables.map(t => ({ id: t.id, name: t.name, icon: t.icon, project_id: p.id }))
    );
    const projectId = Number(args?.project_id);
    if (Number.isFinite(projectId) && projectId > 0) {
      tables = tables.filter(t => t.project_id === projectId);
    }
    return { tables };
  },

  async get_table_schema(args, space) {
    const schema = await loadPublicTableSchema(space.id, Number(args?.table_id));
    return schema || NOT_FOUND;
  },

  async query_table_data(args, space) {
    const table = await loadPublicTable(space.id, Number(args?.table_id));
    if (!table) return NOT_FOUND;
    const { limit, offset } = clampPagination(args?.limit, args?.offset);
    return fetchPublicRows(Number(args.table_id), { limit, offset });
  },

  async get_table_row(args, space) {
    const table = await loadPublicTable(space.id, Number(args?.table_id));
    if (!table) return NOT_FOUND;
    const row = await fetchPublicRowById(Number(args.table_id), args?.row_id);
    return row ? { row } : NOT_FOUND;
  },

  async get_dashboard_widgets(args, space) {
    const result = await listPublicDashboardWidgets(space.id, Number(args?.dashboard_id));
    return result || NOT_FOUND;
  },

  async list_documents(args, space) {
    // Space-scoped — the admin tool's `widget_id` is ignored; the public
    // surface lists the documents registry of the pinned space.
    return loadPublicDocumentsRegistry(space.id);
  },

  async get_document_content(args, space) {
    // `document_id` (registry row id) or a slug both resolve via the loader.
    const ref = args?.document_id ?? args?.slug ?? args?.doc_slug;
    if (ref === undefined || ref === null || ref === '') return NOT_FOUND;
    const doc = await loadPublicDocument(space.id, ref);
    return doc || NOT_FOUND;
  },

  async memory_recall(args, space) {
    // ADR-157 scope router — narrow the Collection (Hindsight `room`) BEFORE the
    // semantic search (the step that buys +34% precision). A low-confidence match
    // returns room=null → the domain is searched unscoped, exactly as before.
    // Storage stays liquid: `room` is a predicate over the bank, not a partition.
    const route = routeMemoryScope(args?.query);

    // bank_id is FORCED to the public bank — caller args cannot redirect it.
    const recall = (room) => memoryToolHandlers.memory_recall(
      { query: args?.query, limit: args?.limit, bank_id: PUBLIC_MEMORY_BANK, room },
      null,
      { source: 'public-mcp' }
    );

    let result = await recall(route.room ?? undefined);

    // Second fallback (ADR-157 sketch §2): a confident route that comes back empty
    // drops one scope level and retries unscoped, so routing can never hide a hit
    // that lives outside the chosen room.
    let routeOutcome = route.room ? 'routed' : 'widened';
    if (route.room && (result?.count ?? 0) === 0) {
      result = await recall(undefined);
      routeOutcome = 'widened-after-empty';
    }

    apiLogger.info(
      { spaceId: space?.id, query: args?.query, route, routeOutcome, count: result?.count ?? 0 },
      'public memory_recall scope-router'
    );

    // ADR-157 fast guardrail — SHADOW MODE on the public surface (the costliest,
    // least-supervised place to hallucinate). We assess whether the recall is
    // grounded in the query and LOG the verdict, but the result is returned
    // UNCHANGED. Promote to blocking only after shadow telemetry proves the
    // threshold (ADR-157 Consequences: "start in log-only / shadow mode").
    try {
      const verdict = assessGrounding(args?.query, result?.memories);
      apiLogger.info(
        {
          spaceId: space?.id,
          query: args?.query,
          verdict,
          // Adaptive-head telemetry (ADR-157): how much of the context the
          // guardrail actually had to read to settle — this is what later
          // justifies the threshold / shadow→blocking promotion.
          inspectedTokens: verdict.inspectedTokens,
          totalTokens: verdict.totalTokens,
          count: result?.count ?? 0,
          mode: 'shadow',
        },
        'public memory_recall fast-guardrail'
      );
    } catch (err) {
      apiLogger.warn({ err: err.message, spaceId: space?.id }, 'fast-guardrail shadow assess failed');
    }

    return result;
  },
};

/**
 * Explicit allow-set (NO-SIGNUP-MCP §B3). A tool is public iff it appears here
 * AND has a gated handler above. Dropped tools (`list_spaces`, `global_search`,
 * `analyze_table_data`, conversations, …) are absent on purpose — they have no
 * space-gated loader and would leak cross-tenant.
 */
export const PUBLIC_ALLOWLIST = new Set([
  'list_tables',
  'list_projects',
  'list_documents',
  'get_table_schema',
  'get_table_row',
  'query_table_data',
  'get_document_content',
  'get_dashboard_widgets',
  'memory_recall',
]);

/**
 * Boot assertion: every allow-set name MUST have a gated handler (§B3, §Risks
 * "New-tool default"). Adding a tool to the allow-set without wiring a gated
 * loader re-opens the v1 cross-tenant breach class, so we throw at load — never
 * fall back to `executeTool`. Exported so the fail-closed contract is testable.
 */
export function assertHandlersWired(allowlist, handlers) {
  for (const name of allowlist) {
    if (typeof handlers[name] !== 'function') {
      throw new Error(
        `[publicMcp] PUBLIC_ALLOWLIST contains "${name}" with no PUBLIC_MCP_HANDLERS entry — ` +
        `a public tool MUST have a gated loader (NO-SIGNUP-MCP §B3). Fail closed.`
      );
    }
  }
}

/**
 * Symmetric boot assertion (MCP-DOOR-LEGIBILITY "Two hard guardrails" #2): every
 * allow-set name MUST appear in `buildToolList()`. Once tools/list advertises
 * exactly the allow-set, a rename in `tool-definitions.js` could silently shrink
 * the advertised surface BELOW the allow-set (advertise 8, allow 9) with no
 * error — the inverse drift `assertHandlersWired` doesn't catch. Throw at load so
 * the advertised surface can never fall out of lockstep with the callable one.
 * Exported so the lockstep contract is testable.
 */
export function assertAllowlistAdvertised(allowlist, toolList) {
  const advertised = new Set(toolList.map((t) => t.name));
  for (const name of allowlist) {
    if (!advertised.has(name)) {
      throw new Error(
        `[publicMcp] PUBLIC_ALLOWLIST contains "${name}" but buildToolList() does not ` +
        `advertise it — the public tools/list would offer fewer tools than it allows ` +
        `(MCP-DOOR-LEGIBILITY guardrail #2). Fail closed.`
      );
    }
  }
}

// Fail closed at module load.
assertHandlersWired(PUBLIC_ALLOWLIST, PUBLIC_MCP_HANDLERS);
assertAllowlistAdvertised(PUBLIC_ALLOWLIST, buildToolList());

/**
 * Upsell tool-result for a locked tool. A normal (non-error-transport) result
 * so the client renders it inline — the conversion point, pulled AFTER the
 * user is already exploring (NO-SIGNUP-MCP §B4).
 */
export function upsellError(name) {
  return {
    error: 'account_required',
    message: `\`${name}\` writes data — create a free space at https://godcrm.ai to unlock it. Reading is open, no signup.`,
    signup_url: 'https://godcrm.ai',
  };
}

/**
 * Build a fresh MCP Server bound to one pinned public space. A new server +
 * transport is created per request (stateless), so the space binding cannot
 * leak across requests.
 */
function buildPublicMcpServer(space) {
  const server = new Server(
    // Lever 1 (MCP-DOOR-LEGIBILITY): the name itself signals read-only, and
    // `instructions` answers the exact triage question a Shodan/Censys/GreyNoise
    // analyst asks of a new no-auth service — in-band, in the protocol it parses.
    { name: 'godcrm-public-readonly', version: '1.0.0' },
    {
      capabilities: { tools: {} },
      instructions:
        'Public read-only demo of GOD CRM. Anonymous tier, no authentication by ' +
        'design — this endpoint is intentionally public, not a misconfiguration. ' +
        'Scoped to a single public demo space; cross-space ids return not_found. ' +
        'Reads are open; writes require a free account at https://godcrm.ai.',
    }
  );

  // tools/list advertises EXACTLY the allow-set (NO-SIGNUP-MCP §B6 v2, amended by
  // MCP-DOOR-LEGIBILITY "ARCHITECT VERDICT — Option A"). Advertised surface ===
  // callable surface: a static scanner reading tools/list sees only read-safe
  // tools, not the 68 write verbs it would fingerprint as tool-poisoning. The
  // filter lives ONLY here, never in the shared buildToolList() (which the stdio
  // agent surface needs whole).
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: buildToolList().filter((t) => PUBLIC_ALLOWLIST.has(t.name)),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    if (!PUBLIC_ALLOWLIST.has(name)) {
      // Locked or unknown tool → friendly upsell, never a raw 500/401.
      return { content: [{ type: 'text', text: JSON.stringify(upsellError(name)) }] };
    }

    try {
      const result = await PUBLIC_MCP_HANDLERS[name](args || {}, space);
      const isError = !!result?.error;
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        isError,
      };
    } catch (err) {
      apiLogger.error({ err, tool: name, spaceId: space?.id }, 'public MCP tool error');
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: err.message }) }],
        isError: true,
      };
    }
  });

  return server;
}

/**
 * Express handler for `/s/:slug/mcp`. `publicSpaceAccess` has already pinned
 * `req.publicSpace` (or 404'd / demanded the password). Stateless
 * streamable-http: one Server + transport per request, JSON responses.
 */
export async function mcpPublicHandler(req, res) {
  const space = req.publicSpace;
  if (!space) {
    // Defence-in-depth: should be unreachable (middleware pins it or bails).
    return res.status(404).json({ error: 'not_found' });
  }

  // Lever 2 (MCP-DOOR-LEGIBILITY): GreyNoise/Censys/Shodan probe with GET, not
  // MCP JSON-RPC. Without this, GET falls into the streamable-http transport and
  // returns a context-less 4xx that reads as a broken/hostile endpoint. Answer a
  // benign, fingerprintable banner instead → catalogued as a known-benign
  // service, sentinel converts to free third-party verification.
  if (req.method === 'GET') {
    return res.status(200).json({
      service: 'godcrm-public-mcp',
      access: 'anonymous-read-only',
      intentional: true,
      transport: 'streamable-http (POST JSON-RPC)',
      docs: 'https://godcrm.ai',
      contact: 'security@godcrm.ai',
    });
  }

  const server = buildPublicMcpServer(space);
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless — no session, no cross-request state
    enableJsonResponse: true,
  });

  res.on('close', () => {
    transport.close();
    server.close();
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    apiLogger.error({ err, spaceId: space.id }, 'public MCP transport error');
    if (!res.headersSent) {
      res.status(500).json({ error: 'mcp_transport_error' });
    }
  }
}
