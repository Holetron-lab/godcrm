// @vitest-environment node
/**
 * Archived-docs filter for agent search tools (collegium decision 2026-07-04,
 * «archived вместо tombstone»): archived rows must not pollute agent context.
 *
 * Pins:
 *  - global_search rows branch excludes data->>'status' = 'archived' by default
 *  - list_documents excludes archived in BOTH the COUNT and the SELECT
 *  - include_archived: true disables the filter in both tools
 *  - rows with no status field (non-document rows) still match
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
const { documentToolHandlers } = await import('../document-tools.js');

const PG_FILTER = `(data->>'status' IS DISTINCT FROM 'archived')`;
const SQLITE_FILTER = `json_extract(data, '$.status') IS NOT 'archived'`;

beforeEach(() => {
  dbAll.mockReset().mockResolvedValue([]);
  dbGet.mockReset();
  isPostgres.mockReset().mockReturnValue(true);
});

describe('global_search rows branch', () => {
  const rowsSql = () => dbAll.mock.calls.at(-1)[0];

  it('excludes archived rows by default (pg)', async () => {
    await calendarToolHandlers.global_search({ query: 'x', types: ['rows'] });
    expect(rowsSql()).toContain(PG_FILTER);
  });

  it('excludes archived rows by default (sqlite)', async () => {
    isPostgres.mockReturnValue(false);
    await calendarToolHandlers.global_search({ query: 'x', types: ['rows'] });
    expect(rowsSql()).toContain(SQLITE_FILTER);
  });

  it('include_archived: true drops the filter', async () => {
    await calendarToolHandlers.global_search({ query: 'x', types: ['rows'], include_archived: true });
    expect(rowsSql()).not.toContain('archived');
  });

  it('does not touch non-row branches', async () => {
    await calendarToolHandlers.global_search({ query: 'x', types: ['tables', 'projects', 'conversations'] });
    for (const call of dbAll.mock.calls) expect(call[0]).not.toContain('archived');
  });
});

describe('list_documents', () => {
  beforeEach(() => {
    dbGet
      .mockResolvedValueOnce({ id: 218, config: { registry_table_id: 2197 } }) // widget
      .mockResolvedValueOnce({ project_id: 1, folder_path: 'databases/documents/' }) // table
      .mockResolvedValueOnce({ cnt: '0' }); // COUNT
  });

  const countSql = () => dbGet.mock.calls.at(-1)[0];
  const selectSql = () => dbAll.mock.calls.at(-1)[0];

  it('excludes archived in COUNT and SELECT by default (pg)', async () => {
    await documentToolHandlers.list_documents({ widget_id: 218 });
    expect(countSql()).toContain(PG_FILTER);
    expect(selectSql()).toContain(PG_FILTER);
  });

  it('excludes archived by default (sqlite)', async () => {
    isPostgres.mockReturnValue(false);
    await documentToolHandlers.list_documents({ widget_id: 218 });
    expect(countSql()).toContain(SQLITE_FILTER);
    expect(selectSql()).toContain(SQLITE_FILTER);
  });

  it('include_archived: true drops the filter', async () => {
    await documentToolHandlers.list_documents({ widget_id: 218, include_archived: true });
    expect(countSql()).not.toContain('archived');
    expect(selectSql()).not.toContain('archived');
  });
});
