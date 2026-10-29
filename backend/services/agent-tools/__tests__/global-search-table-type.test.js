// @vitest-environment node
/**
 * ADR-164 addendum — table_type in global_search (CRM doc 232328).
 *
 * Pins (mocked connection, no DB):
 *  - every tables result row carries `table_type` (SELECT projects it)
 *  - optional exact `table_type` filter: no query needed, bound param, never LIKE
 *  - name + marker combine with AND
 *  - space_id narrows tables via projects.space_id (JOIN), before LIMIT
 *  - validation fails before any SQL: empty call, bad marker, non-table types
 *  - legacy calls (query only) keep default types and behaviour
 *  - the advertised MCP schema exposes table_type and no longer requires query
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const dbAll = vi.fn();
const dbGet = vi.fn();
const dbRun = vi.fn();
const isPostgres = vi.fn(() => true);
const sqlNow = vi.fn(() => 'NOW()');

vi.mock('../../../database/connection.js', () => ({
  dbAll: (...args) => dbAll(...args),
  dbGet: (...args) => dbGet(...args),
  dbRun: (...args) => dbRun(...args),
  isPostgres: (...args) => isPostgres(...args),
  sqlNow: (...args) => sqlNow(...args),
}));

vi.mock('../../../utils/logger.js', () => {
  const mkLogger = () => ({
    error: () => {}, info: () => {}, warn: () => {}, debug: () => {},
    child: () => mkLogger(),
  });
  return { aiLogger: mkLogger(), apiLogger: mkLogger(), dbLogger: mkLogger(), default: mkLogger() };
});

const { calendarToolHandlers } = await import('../calendar-tools.js');
const { CALENDAR_TOOLS } = await import('../tool-definitions/calendar.js');
const { buildToolList } = await import('../../mcp/buildToolList.js');

const search = (args) => calendarToolHandlers.global_search(args);
const tablesCall = () => dbAll.mock.calls.find(([sql]) => /FROM universal_tables/.test(sql));
const tablesSql = () => tablesCall()[0];
const tablesParams = () => tablesCall()[1];

beforeEach(() => {
  dbAll.mockReset().mockResolvedValue([]);
  isPostgres.mockReset().mockReturnValue(true);
});

describe('global_search tables branch — table_type projection (legacy name search)', () => {
  it('selects table_type and keeps the name predicate + envelope (pg)', async () => {
    dbAll.mockResolvedValueOnce([
      { id: 1, name: 'AI Agents', icon: null, description: null, table_type: 'ai_agents' },
      { id: 2, name: 'Agent Log', icon: null, description: null, table_type: null },
    ]);
    const res = await search({ query: 'agent', types: ['tables'] });

    expect(tablesSql()).toMatch(/SELECT[^]*\btable_type\b[^]*FROM universal_tables/);
    expect(tablesSql()).toContain('ILIKE $1');
    expect(tablesSql()).not.toContain('table_type =');
    expect(tablesSql()).not.toContain('JOIN projects');
    expect(tablesParams()).toEqual(['%agent%', 20]);
    expect(res.query).toBe('agent');
    expect(res.results.tables.map((t) => t.table_type)).toEqual(['ai_agents', null]);
  });

  it('sqlite branch uses LIKE ? and still projects table_type', async () => {
    isPostgres.mockReturnValue(false);
    await search({ query: 'agent', types: ['tables'] });
    expect(tablesSql()).toMatch(/\btable_type\b/);
    expect(tablesSql()).toContain('LIKE ?');
    expect(tablesParams()).toEqual(['%agent%', 20]);
  });

  it('legacy default types are unchanged (tables, rows, projects, conversations)', async () => {
    const res = await search({ query: 'x' });
    expect(dbAll).toHaveBeenCalledTimes(4);
    expect(Object.keys(res.results).sort()).toEqual(['conversations', 'projects', 'rows', 'tables']);
  });

  it('legacy mode without query still fails before SQL', async () => {
    expect(await search({})).toHaveProperty('error');
    expect(await search({ query: '' })).toHaveProperty('error');
    expect(dbAll).not.toHaveBeenCalled();
  });
});

describe('global_search — exact table_type filter', () => {
  it('marker only, types omitted: searches tables only, no name predicate, query ""', async () => {
    const res = await search({ table_type: 'ai_agents' });

    expect(dbAll).toHaveBeenCalledTimes(1);
    expect(tablesSql()).toContain('table_type = $1');
    expect(tablesSql()).not.toMatch(/LIKE/i);
    expect(tablesSql()).not.toContain('JOIN projects');
    expect(tablesParams()).toEqual(['ai_agents', 20]);
    expect(res.query).toBe('');
    expect(Object.keys(res.results)).toEqual(['tables']);
  });

  it('marker + name combine with AND (pg)', async () => {
    await search({ table_type: 'ai_agents', query: 'Research', types: ['tables'] });
    expect(tablesSql()).toMatch(/ILIKE \$1 AND [\w.]*table_type = \$2/);
    expect(tablesParams()).toEqual(['%Research%', 'ai_agents', 20]);
  });

  it('marker + name combine with AND (sqlite)', async () => {
    isPostgres.mockReturnValue(false);
    await search({ table_type: 'ai_agents', query: 'Research' });
    expect(tablesSql()).toMatch(/LIKE \? AND [\w.]*table_type = \?/);
    expect(tablesParams()).toEqual(['%Research%', 'ai_agents', 20]);
  });

  it('marker is a bound literal: % and quotes never become wildcards or SQL', async () => {
    const marker = `%'; DROP TABLE x; --`;
    await search({ table_type: marker });
    expect(tablesSql()).not.toContain(marker);
    expect(tablesSql()).toContain('table_type = $1');
    expect(tablesParams()[0]).toBe(marker);
  });

  it('honours limit after filtering', async () => {
    await search({ table_type: 'ai_agents', limit: 500 });
    expect(tablesSql()).toMatch(/table_type = \$1[^]*LIMIT \$2$/);
    expect(tablesParams()).toEqual(['ai_agents', 500]);
  });

  it('explicit types ["tables"] is accepted', async () => {
    const res = await search({ table_type: 'ai_agents', types: ['tables'] });
    expect(res.error).toBeUndefined();
    expect(dbAll).toHaveBeenCalledTimes(1);
  });
});

describe('global_search — space_id applies to tables', () => {
  it('joins projects and binds space_id before LIMIT (pg)', async () => {
    await search({ table_type: 'ai_agents', space_id: 11, limit: 500 });
    expect(tablesSql()).toContain('JOIN projects');
    expect(tablesSql()).toMatch(/table_type = \$1 AND [\w.]*space_id = \$2[^]*LIMIT \$3$/);
    expect(tablesParams()).toEqual(['ai_agents', 11, 500]);
  });

  it('joins projects and binds space_id (sqlite)', async () => {
    isPostgres.mockReturnValue(false);
    await search({ table_type: 'ai_agents', space_id: 11 });
    expect(tablesSql()).toContain('JOIN projects');
    expect(tablesSql()).toMatch(/table_type = \? AND [\w.]*space_id = \?[^]*LIMIT \?$/);
    expect(tablesParams()).toEqual(['ai_agents', 11, 20]);
  });

  it('legacy name search now also honours space_id for tables', async () => {
    await search({ query: 'agent', types: ['tables'], space_id: 11 });
    expect(tablesSql()).toContain('JOIN projects');
    expect(tablesParams()).toEqual(['%agent%', 11, 20]);
  });

  it('projects branch keeps its own space_id filter', async () => {
    await search({ query: 'x', types: ['projects'], space_id: 11 });
    const [sql, params] = dbAll.mock.calls[0];
    expect(sql).toContain('FROM projects');
    expect(sql).toContain('space_id = $2');
    expect(params).toEqual(['%x%', 11, 20]);
  });
});

describe('global_search — validation before SQL', () => {
  it.each([
    ['empty string', ''],
    ['whitespace', '   '],
    ['number', 5],
    ['null', null],
    ['object', { a: 1 }],
    ['too long (51)', 'a'.repeat(51)],
  ])('rejects table_type %s', async (_label, table_type) => {
    const res = await search({ table_type });
    expect(res).toHaveProperty('error');
    expect(dbAll).not.toHaveBeenCalled();
  });

  it('accepts a 50-char marker (column bound)', async () => {
    const res = await search({ table_type: 'a'.repeat(50) });
    expect(res.error).toBeUndefined();
    expect(dbAll).toHaveBeenCalledTimes(1);
  });

  it('does not lowercase or trim the marker', async () => {
    await search({ table_type: 'AI_Agents' });
    expect(tablesParams()[0]).toBe('AI_Agents');
  });

  it.each([
    ['non-table type', ['rows']],
    ['mixed types', ['tables', 'rows']],
    ['empty types', []],
    ['non-array types', 'tables'],
  ])('rejects table_type with %s', async (_label, types) => {
    const res = await search({ table_type: 'ai_agents', types });
    expect(res.error).toMatch(/types/);
    expect(dbAll).not.toHaveBeenCalled();
  });
});

describe('advertised schema', () => {
  const fromDefs = CALENDAR_TOOLS.find((t) => t.function.name === 'global_search').function.parameters;
  const fromMcp = buildToolList().find((t) => t.name === 'global_search').inputSchema;

  it.each([
    ['tool definition', fromDefs],
    ['emitted MCP inputSchema', fromMcp],
  ])('%s advertises table_type and does not require query', (_label, schema) => {
    expect(schema.properties.table_type).toMatchObject({ type: 'string' });
    expect(schema.properties.query).toMatchObject({ type: 'string' });
    expect(schema.required || []).not.toContain('query');
  });

  it('MCP schema is propagated from the definition, not a parallel copy', () => {
    expect(fromMcp).toBe(fromDefs);
  });
});
