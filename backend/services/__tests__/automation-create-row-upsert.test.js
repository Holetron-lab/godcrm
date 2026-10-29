// @vitest-environment node
/**
 * executeCreateRow idempotent upsert (opt-in via action_config.upsertKey).
 *
 * Root cause this guards: the "Blog → public mirror on publish" automation
 * (3720/177443) used a plain INSERT, so re-publishing a post (or editing then
 * re-publishing) spawned a duplicate mirror row and post-publish edits never
 * propagated. With upsertKey=slug the action now matches an existing target row
 * by that JSON field and UPDATEs it in place; without upsertKey the action keeps
 * its original insert-only behaviour byte-for-byte.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const dbGet = vi.fn();
const dbRun = vi.fn();
const dbAll = vi.fn();

vi.mock('../../database/connection.js', () => ({
  dbGet: (...a) => dbGet(...a),
  dbRun: (...a) => dbRun(...a),
  dbAll: (...a) => dbAll(...a),
}));

// Trim incidental imports so the module loads in isolation.
vi.mock('../../utils/logger.js', () => ({ apiLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('../SkillEnrichmentService.js', () => ({ enrichSkill: vi.fn() }));
vi.mock('../TelegramService.js', () => ({ sendMessage: vi.fn(), sendAdminAlert: vi.fn() }));
vi.mock('../schedule-trigger/pipeline-executors.js', () => ({ executeTicketRouting: vi.fn() }));
// Live-grid NOTIFY rides on dbRun too; keep the write-count assertions about table_rows only.
vi.mock('../realtime/rowEvents.js', () => ({ notifyRowChange: vi.fn(async () => true), notifyRowChanges: vi.fn() }));

const { executeCreateRow } = await import('../AutomationTriggerService.js');

const MIRROR_CONFIG = {
  targetTableId: 100245,
  upsertKey: 'slug',
  field_mapping: { slug: 'Slug', title: 'Title', body: 'Body' },
};

beforeEach(() => {
  dbGet.mockReset();
  dbRun.mockReset();
  dbAll.mockReset();
});

describe('executeCreateRow upsert', () => {
  it('INSERTs a new row when no existing row matches the upsert key', async () => {
    dbGet.mockResolvedValueOnce(undefined);           // no existing slug
    dbRun.mockResolvedValueOnce({ lastInsertRowid: 9001 });

    const res = await executeCreateRow(MIRROR_CONFIG, { Slug: 'fresh-post', Title: 'Fresh', Body: 'x' });

    expect(res.success).toBe(true);
    expect(res.created_row_id).toBe(9001);
    expect(res.upserted).toBeUndefined();
    // exactly one write, and it is an INSERT
    expect(dbRun).toHaveBeenCalledTimes(1);
    expect(dbRun.mock.calls[0][0]).toMatch(/^INSERT INTO table_rows/);
  });

  it('UPDATEs the matching row instead of inserting when the slug already exists', async () => {
    dbGet.mockResolvedValueOnce({ id: 180639, data: { slug: 'we-deleted-a-magic-number', title: 'old', extra: 'keep' } });
    dbRun.mockResolvedValueOnce({});

    const res = await executeCreateRow(
      MIRROR_CONFIG,
      { Slug: 'we-deleted-a-magic-number', Title: 'new title', Body: 'new body' }
    );

    expect(res.success).toBe(true);
    expect(res.upserted).toBe(true);
    expect(res.updated_row_id).toBe(180639);
    expect(res.created_row_id).toBeUndefined();
    // single write, and it is an UPDATE on the existing id
    expect(dbRun).toHaveBeenCalledTimes(1);
    expect(dbRun.mock.calls[0][0]).toMatch(/^UPDATE table_rows/);
    expect(dbRun.mock.calls[0][1][2]).toBe(180639);
    // merged: new fields win, untouched existing fields survive
    expect(res.data).toMatchObject({ title: 'new title', body: 'new body', extra: 'keep' });
  });

  it('looks up by the configured key + value over the target table', async () => {
    dbGet.mockResolvedValueOnce(undefined);
    dbRun.mockResolvedValueOnce({ lastInsertRowid: 1 });

    await executeCreateRow(MIRROR_CONFIG, { Slug: 'some-slug', Title: 't', Body: 'b' });

    expect(dbGet).toHaveBeenCalledTimes(1);
    const [sql, params] = dbGet.mock.calls[0];
    expect(sql).toMatch(/data->>\?/);
    expect(params).toEqual([100245, 'slug', 'some-slug']);
  });

  it('without upsertKey it stays insert-only (no lookup, plain INSERT)', async () => {
    dbRun.mockResolvedValueOnce({ lastInsertRowid: 7 });

    const res = await executeCreateRow(
      { targetTableId: 100245, field_mapping: { slug: 'Slug', title: 'Title' } },
      { Slug: 'no-upsert', Title: 't' }
    );

    expect(res.success).toBe(true);
    expect(res.created_row_id).toBe(7);
    expect(dbGet).not.toHaveBeenCalled();           // no existence probe
    expect(dbRun.mock.calls[0][0]).toMatch(/^INSERT INTO table_rows/);
  });

  it('empty/missing upsert value falls back to INSERT (never matches everything)', async () => {
    dbRun.mockResolvedValueOnce({ lastInsertRowid: 8 });

    const res = await executeCreateRow(MIRROR_CONFIG, { Slug: '', Title: 't', Body: 'b' });

    expect(res.success).toBe(true);
    expect(res.created_row_id).toBe(8);
    expect(dbGet).not.toHaveBeenCalled();
    expect(dbRun.mock.calls[0][0]).toMatch(/^INSERT INTO table_rows/);
  });
});
