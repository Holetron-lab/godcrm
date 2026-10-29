// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ get: vi.fn(), all: vi.fn(), run: vi.fn(), access: vi.fn(), connector: vi.fn(), send: vi.fn(), fetch: vi.fn() }));
vi.mock('../../database/connection.js', () => ({ dbGet: mocks.get, dbAll: mocks.all, dbRun: mocks.run,
  withTransactionAsync: (fn) => fn({ get: mocks.get, all: mocks.all, run: mocks.run }) }));
vi.mock('../../services/space/access.js', () => ({ checkUserSpaceAccess: mocks.access }));
vi.mock('../../services/mail/connector.js', () => ({ loadImapConnector: mocks.connector }));
vi.mock('../../services/mail/deliver.js', () => ({ deliverMail: mocks.send, MailSendError: class extends Error {} }));
vi.mock('../../services/mail/imapFetch.js', () => ({ imapFetch: mocks.fetch }));
import router from '../../routes/v3/mail.js';

async function call(method, path, { body = {}, params = {}, query = {} } = {}) {
  const route = router.stack.find((l) => l.route?.path === `/spaces/:spaceId/mail/${path}` && l.route.methods[method]);
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis(), set: vi.fn().mockReturnThis() };
  if (!route) return { status: 404 };
  await route.route.stack[0].handle({ params: { spaceId: '11', ...params }, query, body, user: { id: 1, role: 'owner' } }, res);
  return { status: res.status.mock.lastCall?.[0] || 200, body: res.json.mock.lastCall?.[0] };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.access.mockResolvedValue(true);
  mocks.connector.mockResolvedValue({ id: 7, creds: {} });
  mocks.all.mockResolvedValue([]);
  mocks.get.mockImplementation(async (sql) => {
    if (sql.includes('FROM spaces')) return { id: 11 };
    if (sql.includes('mail_folders')) return { id: 8, key: 'f8', name: 'Clients', order_index: 1 };
    if (sql.includes('mail_messages')) return { id: 5, space_id: 11, connector_id: 7, folder: 'inbox', replied_at: '2026-10-16T07:00:00Z' };
    return null;
  });
  mocks.send.mockResolvedValue({ sentRow: { id: 6 }, info: {} });
});

describe('mail UX backend contract', () => {
  it('returns system flags and editable archive/spam even without a connector', async () => {
    mocks.connector.mockResolvedValue(null);
    mocks.all.mockResolvedValue([{ key: 'archive', name: 'Archive', order_index: 0 }, { key: 'spam', name: 'Spam', order_index: 1 }]);
    const res = await call('get', 'folders');
    expect(res.body.data.folders).toContainEqual(expect.objectContaining({ id: 'inbox', system: true }));
    expect(res.body.data.folders).toContainEqual(expect.objectContaining({ id: 'archive', system: false }));
    expect(res.body.data.folders).toContainEqual(expect.objectContaining({ id: 'spam', system: false }));
  });
  it('creates and renames a custom folder', async () => {
    expect((await call('post', 'folders', { body: { name: 'Clients' } })).status).toBe(201);
    expect((await call('patch', 'folders/:key', { params: { key: 'f8' }, body: { name: 'Contracts' } })).status).toBe(200);
  });
  it('rejects empty names and protected folder deletion', async () => {
    expect((await call('post', 'folders', { body: { name: ' ' } })).status).toBe(400);
    expect((await call('delete', 'folders/:key', { params: { key: 'inbox' } })).status).toBe(400);
  });
  it('moves custom-folder messages back to inbox on deletion', async () => {
    expect((await call('delete', 'folders/:key', { params: { key: 'f8' } })).status).toBe(200);
    expect(mocks.run).toHaveBeenCalledWith(expect.stringMatching(/UPDATE mail_messages/), expect.arrayContaining([11, 'f8']));
  });
  it('accepts a custom destination and returns repliedAt', async () => {
    const res = await call('patch', 'messages/:msgId', { params: { msgId: '5' }, body: { folder: 'f8' } });
    expect(res.status).toBe(200);
    expect(res.body.data.message.repliedAt).toBe('2026-10-16T07:00:00.000Z');
  });
  it('refuses another space/connector reply before SMTP', async () => {
    mocks.get.mockImplementation(async (sql) => sql.includes('FROM spaces') ? { id: 11 } : null);
    const res = await call('post', 'send', { body: { to: 'a@example.com', subject: 'Re', in_reply_to_id: 999 } });
    expect(res.status).toBe(404);
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it('carries a validated reply id into the delivery path', async () => {
    await call('post', 'send', { body: { to: 'a@example.com', subject: 'Re', in_reply_to_id: 5 } });
    expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({ inReplyToId: 5 }));
  });
  it('denies space access before folder mutation', async () => {
    mocks.access.mockResolvedValue(false);
    expect((await call('post', 'folders', { body: { name: 'Clients' } })).status).toBe(403);
    expect(mocks.run).not.toHaveBeenCalled();
  });
});
