// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ get: vi.fn(), run: vi.fn(), access: vi.fn() }));
vi.mock('../../database/connection.js', () => ({ dbGet: mocks.get, dbRun: mocks.run, dbAll: vi.fn() }));
vi.mock('../../services/space/access.js', () => ({ checkUserSpaceAccess: mocks.access }));
vi.mock('../../services/SystemTablesCreator.js', () => ({ ensureMailSystemTableForSpace: vi.fn() }));
import router from '../../routes/v3/connectors.js';
async function patch(body) {
  const handler = router.stack.find((l) => l.route?.path === '/spaces/:spaceId/connectors/:id' && l.route.methods.patch).route.stack[0].handle;
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
  await handler({ params: { spaceId: '11', id: '7' }, body, user: { id: 1 }, get: () => '' }, res);
  return { status: res.status.mock.lastCall?.[0] || 200, body: res.json.mock.lastCall?.[0] };
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.access.mockResolvedValue(true);
  mocks.get.mockImplementation(async (sql) => sql.includes('FROM spaces') ? { id: 11 } :
    { id: 7, space_id: 11, type_slug: 'imap', status: 'active', display_name: 'Office', account_email: 'me@example.com' });
});
it('renames a connector without changing identity or enabled state', async () => {
  expect((await patch({ display_name: '  Office  ' })).status).toBe(200);
  const [sql, params] = mocks.run.mock.calls[0];
  expect(sql).toContain('display_name = ?');
  expect(sql).not.toMatch(/SET status|account_email|account_name/);
  expect(params).toContain('Office');
});
it.each([{ display_name: '' }, { display_name: 'x'.repeat(121) }, { display_name: 123 }, {}])('rejects invalid rename %j', async (body) => {
  expect((await patch(body)).status).toBe(400);
  expect(mocks.run).not.toHaveBeenCalled();
});
it('preserves enable/disable and rejects forbidden access', async () => {
  expect((await patch({ enabled: false })).status).toBe(200);
  mocks.access.mockResolvedValue(false);
  mocks.run.mockClear();
  expect((await patch({ display_name: 'Other' })).status).toBe(403);
  expect(mocks.run).not.toHaveBeenCalled();
});
