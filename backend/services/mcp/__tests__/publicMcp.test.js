/**
 * Public MCP mount — security-invariant tests (NO-SIGNUP-MCP §B2/B3).
 *
 * These assert the two gates the v1 design got wrong, at the handler-dispatch
 * level, WITHOUT a DB: the gated `public.js` loaders are mocked so we can prove
 * the *wiring* fails closed. The loaders' own cross-space `null` behaviour is
 * covered by `backend/routes/v3/__tests__/public.test.js` against a real DB.
 */

import { describe, test, expect, vi, beforeEach } from 'vitest';

// Mock the gated loaders so the handlers' fail-closed wiring is testable in
// isolation (and so importing publicMcp doesn't drag in express/db).
vi.mock('../../../routes/v3/public.js', () => ({
  default: {},
  loadPublicTable: vi.fn(),
  loadPublicTableSchema: vi.fn(),
  fetchPublicRows: vi.fn(),
  fetchPublicRowById: vi.fn(),
  clampPagination: vi.fn(() => ({ limit: 50, offset: 0 })),
  loadPublicTree: vi.fn(),
  loadPublicDocumentsRegistry: vi.fn(),
  loadPublicDocument: vi.fn(),
  listPublicDashboardWidgets: vi.fn(),
}));

vi.mock('../../agent-tools/memory-tools.js', () => ({
  memoryToolHandlers: { memory_recall: vi.fn(async () => ({ success: true, memories: [] })) },
}));

import * as loaders from '../../../routes/v3/public.js';
import { memoryToolHandlers } from '../../agent-tools/memory-tools.js';
import {
  PUBLIC_MCP_HANDLERS,
  PUBLIC_ALLOWLIST,
  PUBLIC_MEMORY_BANK,
  upsellError,
  assertAllowlistAdvertised,
  mcpPublicHandler,
} from '../publicMcp.js';
import { buildToolList } from '../buildToolList.js';

const SPACE = { id: 7773, name: 'GOD CRM Public', settings: null };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('capability isolation (allow-set)', () => {
  test('allow-set is exactly the gated read tools', () => {
    expect([...PUBLIC_ALLOWLIST].sort()).toEqual([
      'get_dashboard_widgets',
      'get_document_content',
      'get_table_row',
      'get_table_schema',
      'list_documents',
      'list_projects',
      'list_tables',
      'memory_recall',
      'query_table_data',
    ]);
  });

  test('boot invariant: every allow-set name has a gated handler', () => {
    for (const name of PUBLIC_ALLOWLIST) {
      expect(typeof PUBLIC_MCP_HANDLERS[name]).toBe('function');
    }
  });

  test.each([
    'list_spaces', 'global_search', 'analyze_table_data',
    'list_conversations', 'get_conversation_messages', 'get_workspace_info',
    'delete_table_row', 'send_telegram_message', 'add_table_row',
    'memory_retain', 'printer_start',
  ])('dropped/dangerous tool %s is not public', (name) => {
    expect(PUBLIC_ALLOWLIST.has(name)).toBe(false);
  });
});

describe('legibility: tools/list advertises EXACTLY the allow-set (Option A)', () => {
  // The advertised surface (tools/list filtered by PUBLIC_ALLOWLIST) must equal
  // the callable surface — collapsing the advertise-77 / allow-9 divergence that
  // read as a tool-poisoning fingerprint to scanners (MCP-DOOR-LEGIBILITY §B6 v2).
  const advertised = buildToolList().filter((t) => PUBLIC_ALLOWLIST.has(t.name));

  test('advertised set is exactly the 9 allow-set tools', () => {
    expect(advertised.map((t) => t.name).sort()).toEqual([...PUBLIC_ALLOWLIST].sort());
  });

  test('advertised set leaks no write/destructive verb', () => {
    const writeVerb = /^(delete_|add_|update_|create_|send_|batch_|move_|copy_|printer_)/;
    expect(advertised.filter((t) => writeVerb.test(t.name))).toEqual([]);
  });

  test('every advertised tool carries an inputSchema (valid MCP tool shape)', () => {
    for (const t of advertised) expect(t.inputSchema).toBeTruthy();
  });
});

describe('boot guardrail #2: allow-set ⊆ advertised (symmetric assertion)', () => {
  test('passes for the shipped (allow-set, buildToolList) pair', () => {
    expect(() => assertAllowlistAdvertised(PUBLIC_ALLOWLIST, buildToolList())).not.toThrow();
  });

  test('throws when an allow-set name is not advertised (drift caught at boot)', () => {
    const drifted = new Set([...PUBLIC_ALLOWLIST, 'renamed_away_tool']);
    expect(() => assertAllowlistAdvertised(drifted, buildToolList()))
      .toThrow(/renamed_away_tool/);
  });
});

describe('fail-closed: gated loader null → not_found', () => {
  test('query_table_data → not_found when table is outside the pinned space', async () => {
    loaders.loadPublicTable.mockResolvedValue(null); // cross-space id → null
    const out = await PUBLIC_MCP_HANDLERS.query_table_data({ table_id: 1708 }, SPACE);
    expect(out).toEqual({ error: 'not_found' });
    // The only scope source is space.id — never the caller's args.
    expect(loaders.loadPublicTable).toHaveBeenCalledWith(7773, 1708);
    expect(loaders.fetchPublicRows).not.toHaveBeenCalled();
  });

  test('get_table_row → not_found when table is cross-space', async () => {
    loaders.loadPublicTable.mockResolvedValue(null);
    const out = await PUBLIC_MCP_HANDLERS.get_table_row({ table_id: 1708, row_id: 5 }, SPACE);
    expect(out).toEqual({ error: 'not_found' });
    expect(loaders.fetchPublicRowById).not.toHaveBeenCalled();
  });

  test('get_table_schema → not_found when loader returns null', async () => {
    loaders.loadPublicTableSchema.mockResolvedValue(null);
    const out = await PUBLIC_MCP_HANDLERS.get_table_schema({ table_id: 1708 }, SPACE);
    expect(out).toEqual({ error: 'not_found' });
    expect(loaders.loadPublicTableSchema).toHaveBeenCalledWith(7773, 1708);
  });

  test('get_document_content → not_found when loader returns null', async () => {
    loaders.loadPublicDocument.mockResolvedValue(null);
    const out = await PUBLIC_MCP_HANDLERS.get_document_content({ document_id: 999 }, SPACE);
    expect(out).toEqual({ error: 'not_found' });
    expect(loaders.loadPublicDocument).toHaveBeenCalledWith(7773, 999);
  });

  test('get_dashboard_widgets → not_found when dashboard is cross-space', async () => {
    loaders.listPublicDashboardWidgets.mockResolvedValue(null);
    const out = await PUBLIC_MCP_HANDLERS.get_dashboard_widgets({ dashboard_id: 42 }, SPACE);
    expect(out).toEqual({ error: 'not_found' });
  });
});

describe('happy path: in-space read returns data', () => {
  test('query_table_data returns rows for an in-space table', async () => {
    loaders.loadPublicTable.mockResolvedValue({ id: 100 });
    loaders.fetchPublicRows.mockResolvedValue({ rows: [{ id: 1 }], total: 1 });
    const out = await PUBLIC_MCP_HANDLERS.query_table_data({ table_id: 100 }, SPACE);
    expect(out).toEqual({ rows: [{ id: 1 }], total: 1 });
    expect(loaders.fetchPublicRows).toHaveBeenCalledWith(100, { limit: 50, offset: 0 });
  });

  test('list_tables flattens the gated tree and filters by project_id', async () => {
    loaders.loadPublicTree.mockResolvedValue({
      projects: [
        { id: 1, name: 'A', icon: null, tables: [{ id: 10, name: 't10', icon: null }] },
        { id: 2, name: 'B', icon: null, tables: [{ id: 20, name: 't20', icon: null }] },
      ],
    });
    const all = await PUBLIC_MCP_HANDLERS.list_tables({}, SPACE);
    expect(all.tables.map(t => t.id)).toEqual([10, 20]);
    const filtered = await PUBLIC_MCP_HANDLERS.list_tables({ project_id: 2 }, SPACE);
    expect(filtered.tables.map(t => t.id)).toEqual([20]);
  });
});

describe('memory_recall is pinned to the public bank', () => {
  test('caller bank_id cannot redirect to the private bank', async () => {
    await PUBLIC_MCP_HANDLERS.memory_recall({ query: 'comics', bank_id: 'godcrm-main', limit: 5 }, SPACE);
    expect(memoryToolHandlers.memory_recall).toHaveBeenCalledTimes(1);
    const [args] = memoryToolHandlers.memory_recall.mock.calls[0];
    expect(args.bank_id).toBe(PUBLIC_MEMORY_BANK);
    expect(args.bank_id).not.toBe('godcrm-main');
    expect(args.query).toBe('comics');
  });
});

describe('ADR-157 scope router wired into public memory_recall', () => {
  test('a confident keyword query applies the routed room before search', async () => {
    memoryToolHandlers.memory_recall.mockResolvedValueOnce({
      success: true, count: 1, memories: [{ text: 'jwt session login token rotation' }],
    });
    await PUBLIC_MCP_HANDLERS.memory_recall(
      { query: 'how does the jwt login token session work' }, SPACE);
    expect(memoryToolHandlers.memory_recall).toHaveBeenCalledTimes(1);
    const [args] = memoryToolHandlers.memory_recall.mock.calls[0];
    expect(args.room).toBe('auth');            // narrowed to the Collection
    expect(args.bank_id).toBe(PUBLIC_MEMORY_BANK);
  });

  test('a low-confidence query widens (no room) — search the domain unscoped', async () => {
    await PUBLIC_MCP_HANDLERS.memory_recall({ query: 'tell me about the weather' }, SPACE);
    const [args] = memoryToolHandlers.memory_recall.mock.calls[0];
    expect(args.room).toBeUndefined();         // widen-by-one-level fallback
  });

  test('a confident route that returns empty retries unscoped (widen-after-empty)', async () => {
    memoryToolHandlers.memory_recall
      .mockResolvedValueOnce({ success: true, count: 0, memories: [] })  // routed → empty
      .mockResolvedValueOnce({ success: true, count: 2, memories: [{ text: 'x' }] }); // widened
    await PUBLIC_MCP_HANDLERS.memory_recall(
      { query: 'the nginx server pm2 docker host infra' }, SPACE);
    expect(memoryToolHandlers.memory_recall).toHaveBeenCalledTimes(2);
    expect(memoryToolHandlers.memory_recall.mock.calls[0][0].room).toBe('infrastructure');
    expect(memoryToolHandlers.memory_recall.mock.calls[1][0].room).toBeUndefined();
  });
});

describe('upsellError shape (NO-SIGNUP-MCP §B4)', () => {
  test('account_required, names the tool, points at signup', () => {
    const e = upsellError('delete_table_row');
    expect(e.error).toBe('account_required');
    expect(e.message).toContain('delete_table_row');
    expect(e.signup_url).toBe('https://godcrm.ai');
  });
});

describe('Lever 2: GET probe → benign banner before any transport/DB (MCP-DOOR-LEGIBILITY)', () => {
  // A GreyNoise/Censys/Shodan probe hits the mount with GET, not MCP JSON-RPC.
  // The handler must short-circuit to a fingerprintable benign banner BEFORE it
  // builds an MCP Server/transport or calls any gated loader — so the scanner
  // catalogues a known-benign service, not a context-less 4xx that reads hostile.
  const mockRes = () => ({
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  });

  test('GET returns a 200 benign banner that signals intentional anonymous read-only access', async () => {
    const res = mockRes();
    await mcpPublicHandler({ method: 'GET', publicSpace: SPACE }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      service: 'godcrm-public-mcp',
      access: 'anonymous-read-only',
      intentional: true,
    });
  });

  test('banner advertises no tools and leaks no write/destructive verb', async () => {
    const res = mockRes();
    await mcpPublicHandler({ method: 'GET', publicSpace: SPACE }, res);
    expect(res.body.tools).toBeUndefined();
    const writeVerb = /(delete_|add_|update_|create_|send_|batch_|move_|copy_|printer_)/;
    expect(writeVerb.test(JSON.stringify(res.body))).toBe(false);
  });

  test('short-circuits before any gated loader or transport is touched', async () => {
    const res = mockRes();
    await mcpPublicHandler({ method: 'GET', publicSpace: SPACE }, res);
    expect(loaders.loadPublicTree).not.toHaveBeenCalled();
    expect(loaders.loadPublicTable).not.toHaveBeenCalled();
  });
});
