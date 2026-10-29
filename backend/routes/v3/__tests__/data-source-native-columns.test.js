// QA-3660-SCHEMA: metadata only; no database or fixture writes.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { dbGet, dbAll, listTableColumns } = vi.hoisted(() => ({
  dbGet: vi.fn(), dbAll: vi.fn(), listTableColumns: vi.fn(),
}));
vi.mock('../../../database/connection.js', () => ({
  dbGet, dbAll, dbRun: vi.fn(), safeJsonParse: JSON.parse,
}));
vi.mock('../../../services/DataSourceService.js', () => ({
  default: class {
    get = dbGet;
    listTableColumns = listTableColumns;
  },
}));

const { default: router } = await import('../data-sources.js');
const handler = router.stack.find(layer =>
  layer.route?.path === '/:id/tables/:tableName/columns'
).route.stack[0].handle;

async function readColumns(role = 'admin', tableName = 'conversations') {
  const req = {
    params: { id: 'internal-crm', tableName },
    user: role ? { id: 8981, role } : undefined,
  };
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
  await handler(req, res);
  return { status: res.status.mock.calls[0][0], body: res.json.mock.calls[0][0] };
}

beforeEach(() => {
  vi.resetAllMocks();
  dbGet.mockResolvedValue({ id: 'internal-crm', type: 'internal' });
  listTableColumns.mockRejectedValue(new Error('Listing columns not supported for type: internal'));
  dbAll.mockResolvedValue([
    { name: 'id', type: 'integer', nullable: false, default: "nextval('conversations_id_seq'::regclass)", is_identity: false, is_generated: false },
    { name: 'space_id', type: 'integer', nullable: true, default: null, is_identity: false, is_generated: false },
  ]);
});

describe('native column metadata', () => {
  it.each(['admin', 'owner'])('allows global %s to read names/types/nullability/defaults', async role => {
    const result = await readColumns(role);
    expect(result.status).toBe(200);
    expect(result.body.data).toEqual(await dbAll.mock.results[0].value);
    expect(listTableColumns).not.toHaveBeenCalled();
    const [sql, params] = dbAll.mock.calls[0];
    expect(sql).toContain('information_schema.columns');
    expect(sql).toContain("table_schema = 'public'");
    expect(sql).toContain('table_name = $1');
    expect(params).toEqual(['conversations']);
  });

  it.each(['user', 'viewer', 'space_admin'])('denies %s without reading metadata', async role => {
    expect((await readColumns(role)).status).toBe(403);
    expect(dbAll).not.toHaveBeenCalled();
    expect(listTableColumns).not.toHaveBeenCalled();
  });

  it('denies anonymous requests before looking up a source', async () => {
    expect((await readColumns(null)).status).toBe(401);
    expect(dbGet).not.toHaveBeenCalled();
    expect(dbAll).not.toHaveBeenCalled();
  });

  it.each(['public.users', "users'; DROP TABLE users;--", 'x'.repeat(65)])('rejects invalid table name %s', async name => {
    expect((await readColumns('admin', name)).status).toBe(400);
    expect(dbAll).not.toHaveBeenCalled();
  });

  it('returns 404 for a missing native table', async () => {
    dbAll.mockResolvedValue([]);
    expect((await readColumns('admin', 'missing_table')).status).toBe(404);
  });

  it('preserves the external source response and delegation', async () => {
    dbGet.mockResolvedValue({ type: 'mysql' });
    listTableColumns.mockResolvedValue([{ name: 'id', type: 'int' }]);
    const result = await readColumns('user', 'x'.repeat(64));
    expect(result.status).toBe(200);
    expect(result.body.data).toEqual([{ name: 'id', type: 'int' }]);
    expect(listTableColumns).toHaveBeenCalledWith('internal-crm', 'x'.repeat(64));
    expect(dbAll).not.toHaveBeenCalled();
  });
});
