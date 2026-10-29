// @vitest-environment node
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

const db = vi.hoisted(() => ({ get: vi.fn(), all: vi.fn(), run: vi.fn() }));
vi.mock('../../../../database/connection.js', () => ({
  dbGet: db.get, safeJsonParse: (value, fallback) => value ?? fallback,
}));
vi.mock('../chatShared.js', async () => ({
  ...await import('../../../../utils/response.js'),
  dbGet: db.get, dbAll: db.all, dbRun: db.run, isPostgres: () => true,
  safeJsonParse: (value, fallback) => value ?? fallback,
  apiLogger: { error: vi.fn(), info: vi.fn() },
  requireAuth: (_req, _res, next) => next(),
}));
vi.mock('../chatAgentDelegation.js', () => ({}));
// Keep the real router and participant controller (including reactions/batch).
// Other controllers are probes below: no agent runtimes or database connections.
vi.mock('../conversationCrudController.js', () => ({ default: () => {} }));
vi.mock('../conversationSpaceController.js', () => ({ default: () => {} }));
vi.mock('../conversationExtrasController.js', () => ({ default: () => {} }));
vi.mock('../messageController.js', () => ({ default: () => {} }));
vi.mock('../streamController.js', () => ({ default: () => {} }));
vi.mock('../taskRowController.js', () => ({ default: () => {} }));
vi.mock('../toolApprovalController.js', () => ({ default: () => {} }));
vi.mock('../stepsController.js', () => ({ default: () => {} }));
vi.mock('../summaryController.js', () => ({ default: () => {} }));
vi.mock('../conversationSummaryController.js', () => ({ default: () => {} }));
vi.mock('../callController.js', () => ({ default: () => {} }));
vi.mock('../scheduledMessageController.js', () => ({ default: () => {} }));
vi.mock('../notificationPrefsController.js', () => ({ default: () => {} }));
vi.mock('../pinController.js', () => ({ default: () => {} }));
vi.mock('../voiceNoteController.js', () => ({ default: () => {} }));
vi.mock('../presenceController.js', () => ({ default: () => {} }));

const { default: router } = await import('../index.js');
const staticRoutes = [
  ['post', '/conversations/find-or-create'], ['post', '/conversations/ensure-row-chat'],
  ['get', '/conversations'], ['get', '/messages/future-static'],
  ['put', '/tool-approval-rules/:id'], ['get', '/notification-prefs/conversation/:id'],
];
const protectedRoutes = [
  ['get', '/conversations/:id'], ['get', '/conversations/:id/messages'],
  ['get', '/conversations/:id/steps'], ['get', '/conversations/:id/summary'],
  ['post', '/conversations/:id/tools/:messageId/approve'],
  ['get', '/messages/:messageId/full'], ['post', '/messages/:messageId/translate'],
  ['patch', '/messages/:messageId/content'], ['delete', '/messages/:messageId'],
  ['post', '/messages/:id/pin'], ['delete', '/messages/:id/pin'],
];
for (const [method, path] of [...staticRoutes, ...protectedRoutes]) {
  router[method](path, (_req, res) => res.json({ reached: true }));
}
const app = express();
app.use(express.json());
app.use((req, _res, next) => { req.user = { id: 22, userId: 22 }; next(); });
app.use('/api/v3/chat', router);
app.use((err, _req, res, _next) => res.status(500).json({ error: err.message }));
let server;
beforeAll(async () => {
  await new Promise(resolve => { server = app.listen(0, '127.0.0.1', resolve); });
});
afterAll(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
});
const url = path => '/api/v3/chat' + path.replaceAll(':id', '50').replaceAll(':messageId', '99');

beforeEach(() => {
  vi.clearAllMocks();
  db.get.mockImplementation(async (sql, params) => {
    if (sql.includes('FROM messages WHERE id')) {
      if (!/^\d+$/.test(String(params[0]))) throw new Error('invalid input syntax for type integer');
      return { conversation_id: 50 };
    }
    if (sql.includes('SELECT settings')) return { settings: { historical_import: { key: 'source' } } };
    if (sql.includes('conversation_participants')) return null;
    return null;
  });
  db.all.mockResolvedValue([]);
});

it('routes reactions/batch to the real controller without treating reactions as an ID', async () => {
  db.all.mockResolvedValue([{ message_id: 99, emoji: '👍', user_id: 22, user_name: 'Reader' }]);
  const res = await request(server).post(url('/messages/reactions/batch')).send({ messageIds: [99, 100] });
  expect(res.status).toBe(200);
  expect(res.body.data).toEqual({ 99: { '👍': [{ user_id: 22, user_name: 'Reader' }] }, 100: {} });
  expect(db.get).not.toHaveBeenCalled();
  expect(db.all.mock.calls[0][1]).toEqual([99, 100]);
});

it.each([...staticRoutes, ['get', '/conversations/with/22'], ['get', '/unread'], ['get', '/search']])(
  'does not run historical ACL for static/unrelated %s %s', async (method, path) => {
    const res = await request(server)[method](url(path)).send({});
    expect(res.status).toBe(200);
    expect(db.get.mock.calls.some(([sql]) => /SELECT settings|FROM messages WHERE id/.test(sql))).toBe(false);
  });

it.each(protectedRoutes)('denies historical outsiders before %s %s', async (method, path) => {
  const res = await request(server)[method](url(path)).send({});
  expect(res.status).toBe(404);
  expect(res.body).toEqual({ success: false, error: 'Conversation not found' });
});

it.each(protectedRoutes)('allows historical participants through %s %s', async (method, path) => {
  const original = db.get.getMockImplementation();
  db.get.mockImplementation((sql, params) => sql.includes('conversation_participants')
    ? { user_id: 22 } : original(sql, params));
  const res = await request(server)[method](url(path)).send({});
  expect(res.status).toBe(200);
  expect(res.body.reached).toBe(true);
});

it.each(protectedRoutes)('leaves ordinary-chat authorization to %s %s', async (method, path) => {
  const original = db.get.getMockImplementation();
  db.get.mockImplementation((sql, params) => sql.includes('SELECT settings')
    ? { settings: {} } : original(sql, params));
  expect((await request(server)[method](url(path)).send({})).body.reached).toBe(true);
  expect(db.get.mock.calls.some(([sql]) => sql.includes('conversation_participants'))).toBe(false);
});

it.each(['get', 'post'])('preserves historical ACL on real %s reactions route', async method => {
  expect((await request(server)[method](url('/messages/99/reactions')).send({ emoji: '👍' })).status).toBe(404);
  expect(db.all).not.toHaveBeenCalled();
  expect(db.run).not.toHaveBeenCalled();
});

it('forwards lookup failures without executing the protected controller', async () => {
  db.get.mockRejectedValue(new Error('lookup unavailable'));
  const res = await request(server).get(url('/messages/99/full'));
  expect(res.status).toBe(500);
  expect(res.body.reached).toBeUndefined();
});

it.each([['get', '/messages/%39%39/full'], ['get', '/conversations/%35%30/messages'], ['post', '/messages/%39%39/pin']])(
  'cannot bypass historical ACL with encoded IDs: %s %s', async (method, path) => {
    expect((await request(server)[method](url(path))).status).toBe(404);
    expect(db.get).toHaveBeenCalled();
  });

it.each(['reactions', '0', '-1', '1.5', '1e2', '0x32', '2147483648', '9007199254740993', '%20', '99bad'])(
  'rejects invalid ID %s before SQL', async id => {
    for (const path of [`/messages/${id}/full`, `/conversations/${id}/messages`]) {
      const res = await request(server).get(url(path));
      expect(res.status).toBe(400);
    }
    expect(db.get).not.toHaveBeenCalled();
  });

it('checks the conversation as well as the message on nested tool routes', async () => {
  const original = db.get.getMockImplementation();
  db.get.mockImplementation((sql, params) => sql.includes('FROM messages WHERE id')
    ? { conversation_id: 60 } : sql.includes('SELECT settings') && Number(params[0]) === 60
      ? { settings: {} } : original(sql, params));
  const res = await request(server).post(url('/conversations/50/tools/99/approve')).send({});
  expect(res.status).toBe(404);
});
