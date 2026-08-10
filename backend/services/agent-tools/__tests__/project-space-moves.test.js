// @vitest-environment node
/**
 * ADR-0045 P1 — Tests for new MCP space/project move tools.
 *
 * Covers create_space, move_project_to_space, move_table_to_project,
 * delete_project_cascade. DB + EffectiveRoleService are mocked so the suite
 * runs without a fixture; we assert (a) input validation, (b) admin gating,
 * (c) missing-target behaviour, and (d) the two-phase guard on cascade
 * delete (dry_run preview required before destructive call).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const dbGet = vi.fn();
const dbRun = vi.fn();
const dbAll = vi.fn();
const isPostgres = vi.fn(() => false);
const sqlNow = vi.fn(() => "datetime('now')");
const withTransactionAsync = vi.fn(async (cb) => {
  const trx = {
    run: vi.fn().mockResolvedValue({ rowCount: 1 }),
    get: vi.fn(),
    all: vi.fn(),
  };
  const result = await cb(trx);
  return { result, trx };
});

vi.mock('../../../database/connection.js', () => ({
  dbGet: (...args) => dbGet(...args),
  dbRun: (...args) => dbRun(...args),
  dbAll: (...args) => dbAll(...args),
  isPostgres: (...args) => isPostgres(...args),
  sqlNow: (...args) => sqlNow(...args),
  withTransactionAsync: (...args) => withTransactionAsync(...args),
}));

const canAdminister = vi.fn();
vi.mock('../../EffectiveRoleService.js', () => ({
  canAdminister: (...args) => canAdminister(...args),
}));

const _stubLogger = {
  error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn(),
  child: vi.fn(() => _stubLogger),
};
vi.mock('../../../utils/logger.js', () => ({
  apiLogger: _stubLogger,
  aiLogger: _stubLogger,
  dbLogger: _stubLogger,
  default: _stubLogger,
}));

const { projectToolHandlers } = await import('../project-tools.js');

beforeEach(() => {
  dbGet.mockReset();
  dbRun.mockReset();
  dbAll.mockReset();
  canAdminister.mockReset();
  withTransactionAsync.mockClear();
  projectToolHandlers._resetCascadePreviewsForTests();
});

// ─── create_space ────────────────────────────────────────────────────────

describe('create_space', () => {
  it('rejects missing name', async () => {
    const res = await projectToolHandlers.create_space({ type: 'business' }, 1);
    expect(res).toEqual({ error: expect.stringContaining('name') });
    expect(dbRun).not.toHaveBeenCalled();
  });

  it('rejects missing type', async () => {
    const res = await projectToolHandlers.create_space({ name: 'My Space' }, 1);
    expect(res).toEqual({ error: expect.stringContaining('type') });
    expect(dbRun).not.toHaveBeenCalled();
  });

  it('happy path — defaults is_public=false (visibility="internal") and returns space_id', async () => {
    dbRun.mockResolvedValueOnce({ lastInsertRowid: 9001 });
    const res = await projectToolHandlers.create_space(
      { name: 'GodCRM Public', type: 'business' },
      77
    );
    expect(res).toEqual({
      success: true,
      space_id: 9001,
      message: expect.stringContaining('GodCRM Public'),
    });
    const [, params] = dbRun.mock.calls[0];
    expect(params[0]).toBe(77);              // owner_id from userId
    expect(params[1]).toBe('GodCRM Public'); // name
    expect(params[3]).toBe('📁');             // default icon
    expect(params[4]).toBe('business');      // type
    expect(params[5]).toBe('internal');      // visibility default
  });

  it('is_public=true maps visibility to "open"', async () => {
    dbRun.mockResolvedValueOnce({ lastInsertRowid: 9002 });
    await projectToolHandlers.create_space(
      { name: 'Public Marketing', type: 'business', is_public: true, icon: '🌐' },
      77
    );
    const [, params] = dbRun.mock.calls[0];
    expect(params[3]).toBe('🌐');
    expect(params[5]).toBe('open');
  });
});

// ─── move_project_to_space ──────────────────────────────────────────────

describe('move_project_to_space', () => {
  it('rejects missing project_id', async () => {
    const res = await projectToolHandlers.move_project_to_space({ space_id: 1 }, 1);
    expect(res).toEqual({ error: expect.stringContaining('project_id') });
  });

  it('rejects missing space_id', async () => {
    const res = await projectToolHandlers.move_project_to_space({ project_id: 1 }, 1);
    expect(res).toEqual({ error: expect.stringContaining('space_id') });
  });

  it('errors when project missing', async () => {
    dbGet.mockResolvedValueOnce(null); // project lookup
    const res = await projectToolHandlers.move_project_to_space(
      { project_id: 9999, space_id: 11 }, 1
    );
    expect(res).toEqual({ error: expect.stringMatching(/Project 9999 not found/) });
  });

  it('errors when target space missing', async () => {
    dbGet
      .mockResolvedValueOnce({ id: 100, name: 'P', space_id: 11 })
      .mockResolvedValueOnce(null); // target space lookup
    const res = await projectToolHandlers.move_project_to_space(
      { project_id: 100, space_id: 9999 }, 1
    );
    expect(res).toEqual({ error: expect.stringMatching(/Target space 9999 not found/) });
  });

  it('noop when already in target space', async () => {
    dbGet
      .mockResolvedValueOnce({ id: 100, name: 'P', space_id: 11 })
      .mockResolvedValueOnce({ id: 11, name: 'Dev' });
    const res = await projectToolHandlers.move_project_to_space(
      { project_id: 100, space_id: 11 }, 1
    );
    expect(res.success).toBe(true);
    expect(res.message).toMatch(/already in target/);
    expect(dbRun).not.toHaveBeenCalled();
  });

  it('denies when caller is not admin of source space', async () => {
    dbGet
      .mockResolvedValueOnce({ id: 100, name: 'P', space_id: 11 })
      .mockResolvedValueOnce({ id: 22, name: 'Other' });
    canAdminister.mockResolvedValueOnce(false); // source check fails
    const res = await projectToolHandlers.move_project_to_space(
      { project_id: 100, space_id: 22 }, 1
    );
    expect(res).toEqual({
      error: expect.stringMatching(/not admin of source space 11/),
      code: 'AUTH',
    });
    expect(dbRun).not.toHaveBeenCalled();
  });

  it('denies when caller is not admin of target space', async () => {
    dbGet
      .mockResolvedValueOnce({ id: 100, name: 'P', space_id: 11 })
      .mockResolvedValueOnce({ id: 22, name: 'Other' });
    canAdminister
      .mockResolvedValueOnce(true)   // source ok
      .mockResolvedValueOnce(false); // target fails
    const res = await projectToolHandlers.move_project_to_space(
      { project_id: 100, space_id: 22 }, 1
    );
    expect(res).toEqual({
      error: expect.stringMatching(/not admin of target space 22/),
      code: 'AUTH',
    });
    expect(dbRun).not.toHaveBeenCalled();
  });

  it('happy path updates projects.space_id', async () => {
    dbGet
      .mockResolvedValueOnce({ id: 100, name: 'P', space_id: 11 })
      .mockResolvedValueOnce({ id: 22, name: 'Other' });
    canAdminister.mockResolvedValue(true);
    dbRun.mockResolvedValueOnce({ rowCount: 1 });
    const res = await projectToolHandlers.move_project_to_space(
      { project_id: 100, space_id: 22 }, 1
    );
    expect(res).toMatchObject({
      success: true,
      project_id: 100,
      from_space_id: 11,
      to_space_id: 22,
    });
    expect(dbRun).toHaveBeenCalledTimes(1);
    const [sql, params] = dbRun.mock.calls[0];
    expect(sql).toMatch(/UPDATE projects SET space_id/);
    expect(params).toEqual([22, 100]);
  });
});

// ─── move_table_to_project ──────────────────────────────────────────────

describe('move_table_to_project', () => {
  it('rejects missing args', async () => {
    expect(await projectToolHandlers.move_table_to_project({ project_id: 1 }, 1))
      .toEqual({ error: expect.stringContaining('table_id') });
    expect(await projectToolHandlers.move_table_to_project({ table_id: 1 }, 1))
      .toEqual({ error: expect.stringContaining('project_id') });
  });

  it('errors when table missing', async () => {
    dbGet.mockResolvedValueOnce(null);
    const res = await projectToolHandlers.move_table_to_project(
      { table_id: 9999, project_id: 1 }, 1
    );
    expect(res).toEqual({ error: expect.stringMatching(/Table 9999 not found/) });
  });

  it('errors when target project missing', async () => {
    dbGet
      .mockResolvedValueOnce({ id: 500, name: 'T', project_id: 8313 })
      .mockResolvedValueOnce(null);
    const res = await projectToolHandlers.move_table_to_project(
      { table_id: 500, project_id: 9999 }, 1
    );
    expect(res).toEqual({ error: expect.stringMatching(/Target project 9999 not found/) });
  });

  it('denies when not admin of target space', async () => {
    dbGet
      .mockResolvedValueOnce({ id: 500, name: 'T', project_id: 8313 }) // table lookup
      .mockResolvedValueOnce({ id: 9999, name: 'X', space_id: 22 })    // target project
      .mockResolvedValueOnce({ space_id: 11 });                         // source project space
    canAdminister
      .mockResolvedValueOnce(true)   // source ok
      .mockResolvedValueOnce(false); // target fails
    const res = await projectToolHandlers.move_table_to_project(
      { table_id: 500, project_id: 9999 }, 1
    );
    expect(res).toEqual({
      error: expect.stringMatching(/not admin of target space 22/),
      code: 'AUTH',
    });
    expect(dbRun).not.toHaveBeenCalled();
  });

  it('happy path updates universal_tables.project_id only', async () => {
    dbGet
      .mockResolvedValueOnce({ id: 500, name: 'T', project_id: 8313 })
      .mockResolvedValueOnce({ id: 9999, name: 'X', space_id: 22 })
      .mockResolvedValueOnce({ space_id: 11 });
    canAdminister.mockResolvedValue(true);
    dbRun.mockResolvedValueOnce({ rowCount: 1 });
    const res = await projectToolHandlers.move_table_to_project(
      { table_id: 500, project_id: 9999 }, 1
    );
    expect(res).toMatchObject({
      success: true,
      table_id: 500,
      from_project_id: 8313,
      to_project_id: 9999,
    });
    const [sql, params] = dbRun.mock.calls[0];
    expect(sql).toMatch(/UPDATE universal_tables SET project_id/);
    expect(params).toEqual([9999, 500]);
  });
});

// ─── delete_project_cascade ─────────────────────────────────────────────

describe('delete_project_cascade', () => {
  it('rejects missing project_id', async () => {
    const res = await projectToolHandlers.delete_project_cascade({}, 1, {});
    expect(res).toEqual({ error: expect.stringContaining('project_id') });
  });

  it('errors when project missing', async () => {
    dbGet.mockResolvedValueOnce(null);
    const res = await projectToolHandlers.delete_project_cascade(
      { project_id: 9999, dry_run: true }, 1, { conversationId: 42 }
    );
    expect(res).toEqual({ error: expect.stringMatching(/Project 9999 not found/) });
  });

  it('denies when caller is not admin of project space', async () => {
    dbGet.mockResolvedValueOnce({ id: 8313, name: 'P', space_id: 11 });
    canAdminister.mockResolvedValueOnce(false);
    const res = await projectToolHandlers.delete_project_cascade(
      { project_id: 8313, dry_run: true }, 1, { conversationId: 42 }
    );
    expect(res).toEqual({
      error: expect.stringMatching(/not admin of space 11/),
      code: 'AUTH',
    });
  });

  it('dry_run=true returns preview without dropping', async () => {
    dbGet
      .mockResolvedValueOnce({ id: 8313, name: 'P', space_id: 11 })
      .mockResolvedValueOnce({ cnt: 42 }); // rows count
    dbAll
      .mockResolvedValueOnce([{ id: 9886, name: 't1' }, { id: 9887, name: 't2' }])  // tables
      .mockResolvedValueOnce([{ id: 1000, name: 'd1' }]);                            // dashboards
    canAdminister.mockResolvedValue(true);

    const res = await projectToolHandlers.delete_project_cascade(
      { project_id: 8313, dry_run: true }, 1, { conversationId: 42 }
    );
    expect(res).toMatchObject({
      success: true,
      dry_run: true,
      project_id: 8313,
      tables_to_drop: [{ id: 9886, name: 't1' }, { id: 9887, name: 't2' }],
      rows_count: 42,
      dashboards_count: 1,
    });
    expect(withTransactionAsync).not.toHaveBeenCalled();
    expect(dbRun).not.toHaveBeenCalled();
  });

  it('rejects destructive call without prior dry_run in the same conversation', async () => {
    dbGet
      .mockResolvedValueOnce({ id: 8313, name: 'P', space_id: 11 })
      .mockResolvedValueOnce({ cnt: 42 });
    dbAll
      .mockResolvedValueOnce([{ id: 9886, name: 't1' }])
      .mockResolvedValueOnce([]);
    canAdminister.mockResolvedValue(true);

    const res = await projectToolHandlers.delete_project_cascade(
      { project_id: 8313, dry_run: false }, 1, { conversationId: 42 }
    );
    expect(res).toEqual({
      error: 'preview required',
      code: 'PREVIEW_REQUIRED',
      message: expect.stringMatching(/dry_run=true call first/),
    });
    expect(withTransactionAsync).not.toHaveBeenCalled();
  });

  it('preview is conversation-scoped (preview in conv A does not authorize delete in conv B)', async () => {
    // First call: preview in conversation 100
    dbGet
      .mockResolvedValueOnce({ id: 8313, name: 'P', space_id: 11 })
      .mockResolvedValueOnce({ cnt: 0 });
    dbAll.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    canAdminister.mockResolvedValue(true);
    await projectToolHandlers.delete_project_cascade(
      { project_id: 8313, dry_run: true }, 1, { conversationId: 100 }
    );

    // Second call: destructive from conversation 200 (different)
    dbGet
      .mockResolvedValueOnce({ id: 8313, name: 'P', space_id: 11 })
      .mockResolvedValueOnce({ cnt: 0 });
    dbAll.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    const res = await projectToolHandlers.delete_project_cascade(
      { project_id: 8313, dry_run: false }, 1, { conversationId: 200 }
    );
    expect(res.code).toBe('PREVIEW_REQUIRED');
  });

  it('happy path drops everything in a single transaction after dry_run', async () => {
    // Dry run first
    dbGet
      .mockResolvedValueOnce({ id: 8313, name: 'P', space_id: 11 })
      .mockResolvedValueOnce({ cnt: 5 });
    dbAll
      .mockResolvedValueOnce([{ id: 9886, name: 't1' }])
      .mockResolvedValueOnce([{ id: 1000, name: 'd1' }]);
    canAdminister.mockResolvedValue(true);
    await projectToolHandlers.delete_project_cascade(
      { project_id: 8313, dry_run: true }, 1, { conversationId: 50 }
    );
    expect(withTransactionAsync).not.toHaveBeenCalled();

    // Destructive call
    dbGet
      .mockResolvedValueOnce({ id: 8313, name: 'P', space_id: 11 })
      .mockResolvedValueOnce({ cnt: 5 });
    dbAll
      .mockResolvedValueOnce([{ id: 9886, name: 't1' }])
      .mockResolvedValueOnce([{ id: 1000, name: 'd1' }]);

    const trxRun = vi.fn().mockResolvedValue({ rowCount: 1 });
    withTransactionAsync.mockImplementationOnce(async (cb) => {
      return cb({ run: trxRun, get: vi.fn(), all: vi.fn() });
    });

    const res = await projectToolHandlers.delete_project_cascade(
      { project_id: 8313, dry_run: false }, 1, { conversationId: 50 }
    );
    expect(res.success).toBe(true);
    expect(res.project_id).toBe(8313);
    expect(withTransactionAsync).toHaveBeenCalledTimes(1);

    const sqls = trxRun.mock.calls.map(c => c[0]);
    expect(sqls.some(s => /DELETE FROM table_rows/.test(s))).toBe(true);
    expect(sqls.some(s => /DELETE FROM table_columns/.test(s))).toBe(true);
    expect(sqls.some(s => /DELETE FROM universal_tables/.test(s))).toBe(true);
    expect(sqls.some(s => /DELETE FROM widgets/.test(s))).toBe(true);
    expect(sqls.some(s => /DELETE FROM dashboards/.test(s))).toBe(true);
    expect(sqls.some(s => /DELETE FROM projects/.test(s))).toBe(true);
  });
});

// ─── AGENT_TOOLS registry ───────────────────────────────────────────────

describe('AGENT_TOOLS registry includes ADR-0045 P1 tools', () => {
  it('exposes all four new tool definitions', async () => {
    const { AGENT_TOOLS } = await import('../tool-definitions.js');
    const names = AGENT_TOOLS.map(t => t.function.name);
    expect(names).toContain('create_space');
    expect(names).toContain('move_project_to_space');
    expect(names).toContain('move_table_to_project');
    expect(names).toContain('delete_project_cascade');
  });
});
