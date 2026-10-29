// @vitest-environment node
import '../../test/setup.js';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import knexFactory from 'knex';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
const mock = vi.hoisted(() => ({ get: vi.fn(), all: vi.fn(), run: vi.fn(), send: vi.fn(), fetch: vi.fn() }));
vi.mock('../../database/connection.js', () => ({ dbGet: mock.get, dbAll: mock.all, dbRun: mock.run,
  withTransactionAsync: (fn) => fn({ get: mock.get, all: mock.all, run: mock.run }) }));
vi.mock('../../services/space/access.js', () => ({ checkUserSpaceAccess: async () => true }));
vi.mock('../../services/mail/connector.js', () => ({ loadImapConnector: async () => ({ id: 7,
  creds: { smtp_host: 'test', username: 'me@example.com', password: 'test' } }) }));
vi.mock('../../services/mail/imapFetch.js', () => ({ imapFetch: mock.fetch }));
vi.mock('../../services/SMTPService.js', () => ({ default: { createTransport: () => ({ sendMail: mock.send }) } }));
import router from '../../routes/v3/mail.js';
let db, tx, root;
async function call(method, endpoint, body = {}, params = {}) {
  const handler = router.stack.find((l) => l.route?.path === `/spaces/:spaceId/mail/${endpoint}` && l.route.methods[method]).route.stack[0].handle;
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
  await handler({ params: { spaceId: '11', ...params }, body, query: {}, user: { id: 1 } }, res);
  return { status: res.status.mock.lastCall?.[0] || 200, ...res.json.mock.lastCall?.[0] };
}
beforeAll(async () => {
  db = knexFactory({ client: 'pg', connection: { host: process.env.POSTGRES_HOST,
    port: Number(process.env.POSTGRES_PORT), database: process.env.POSTGRES_DB,
    user: process.env.POSTGRES_USER, password: process.env.POSTGRES_PASSWORD }, pool: { min: 0, max: 1 } });
  expect((await db.raw('SELECT current_database() AS name')).rows[0].name).toBe('godcrm_test');
  tx = await db.transaction();
  const schema = `mail_paths_${randomUUID().replaceAll('-', '')}`;
  await tx.raw('CREATE SCHEMA ??', [schema]);
  await tx.raw('SET LOCAL search_path TO ??', [schema]);
  await tx.raw(`CREATE TABLE users (id INTEGER PRIMARY KEY);
    CREATE TABLE spaces (id INTEGER PRIMARY KEY);
    CREATE TABLE projects (id INTEGER PRIMARY KEY);
    CREATE TABLE folders (id INTEGER PRIMARY KEY);
    CREATE TABLE space_connectors (id INTEGER PRIMARY KEY);
    INSERT INTO users VALUES (1); INSERT INTO spaces VALUES (11);
    INSERT INTO space_connectors VALUES (7);`);
  const dir = new URL('../../database/migrations/knex/', import.meta.url);
  const files = await readdir(dir);
  for (const prefix of ['016_', '075_', '079_', '080_', '081_', '082_', '083_', '102_']) {
    await (await import(new URL(files.find((f) => f.startsWith(prefix)), dir).href)).up(tx);
  }
  await tx.raw("ALTER TABLE files ADD COLUMN visibility TEXT DEFAULT 'private'");
  // Existing installations have files.id without a unique constraint.
  await tx.raw('ALTER TABLE files DROP CONSTRAINT files_pkey');
  mock.get.mockImplementation(async (sql, values = []) => (await tx.raw(sql, values)).rows[0] || null);
  mock.all.mockImplementation(async (sql, values = []) => (await tx.raw(sql, values)).rows);
  mock.run.mockImplementation(async (sql, values = []) => ({ changes: (await tx.raw(sql, values)).rowCount }));
  mock.send.mockImplementation(async (message) => ({ messageId: message.messageId }));
  root = await mkdtemp(path.join(os.tmpdir(), 'mail-persistence-'));
  vi.stubEnv('UPLOAD_PATH', root);
}, 20000);
afterAll(async () => {
  vi.unstubAllEnvs();
  if (tx) await tx.rollback();
  if (db) await db.destroy();
  if (root) await rm(root, { recursive: true, force: true });
});

it('syncs bytes once, preserves a local move on resync, and deletes folders without losing mail', async () => {
  mock.fetch.mockResolvedValue([{ imap_uid: 42, imap_uid_validity: '123', message_id: '<in@example.com>',
    from_name: 'Sender', from_address: 'a@example.com', to_addresses: ['me@example.com'], subject: 'Invoice',
    preview: '', body_text: 'invoice', body_html: null, date: new Date(), is_read: false,
    attachments: [{ filename: 'invoice.pdf', contentType: 'application/pdf', content: Buffer.from('invoice') }] }]);
  expect((await call('post', 'sync')).data.synced).toBe(1);
  const row = await tx('mail_messages').first();
  const folder = (await call('post', 'folders', { name: 'Clients' })).data.folder;
  expect((await call('patch', 'messages/:msgId', { folder: folder.id }, { msgId: String(row.id) })).status).toBe(200);
  expect((await call('post', 'sync')).data.synced).toBe(1);
  expect(await tx('mail_messages').select('folder')).toEqual([{ folder: folder.id }]);
  expect((await tx('files').count('* as n'))[0].n).toBe('1');
  const file = await tx('files').first();
  expect(file.visibility).toBe('private');
  expect(await readFile(file.path, 'utf8')).toBe('invoice');
  await call('delete', 'folders/:key', {}, { key: folder.id });
  expect((await tx('mail_messages').first()).folder).toBe('inbox');
  await call('get', 'folders');
  expect((await tx('mail_folders').where({ key: folder.id }).first()).deleted).toBe(true);
});
it('persists a scheduled reply with its source id before SMTP is called', async () => {
  const original = await tx('mail_messages').first();
  mock.send.mockClear();
  const res = await call('post', 'send', { to: 'a@example.com', subject: 'Re', in_reply_to_id: Number(original.id),
    scheduledAt: new Date(Date.now() + 60000).toISOString() });
  expect(res.status).toBe(201);
  expect((await tx('mail_outbox').first()).in_reply_to_id).toBe(original.id);
  expect(mock.send).not.toHaveBeenCalled();
});
it('stores outgoing files and marks replied only after successful delivery', async () => {
  const original = await tx('mail_messages').first();
  const res = await call('post', 'send', { to: 'a@example.com', subject: 'Re', in_reply_to_id: Number(original.id),
    attachments: [{ filename: 'reply.txt', contentType: 'text/plain', content: Buffer.from('reply').toString('base64') }] });
  expect(res.status).toBe(200);
  expect((await tx('mail_messages').where({ id: original.id }).first()).replied_at).toBeInstanceOf(Date);
  const sent = await tx('mail_messages').where({ folder: 'sent' }).first();
  expect(sent.attachments[0].fileId).toBeTruthy();
  expect(sent.attachments[0].content).toBeUndefined();
});

it('saves queued attachments immediately and reuses the same files on delivery', async () => {
  const before = Number((await tx('files').count('* as n'))[0].n);
  const res = await call('post', 'send', { to: 'a@example.com', subject: 'Queued file',
    scheduledAt: new Date(Date.now() + 60000).toISOString(),
    attachments: [{ filename: 'queued.txt', contentType: 'text/plain', content: Buffer.from('queued').toString('base64') }] });
  expect(res.status).toBe(201);
  expect(Number((await tx('files').count('* as n'))[0].n)).toBe(before + 1);
  const queued = await tx('mail_outbox').where({ id: res.data.scheduled.id }).first();
  const { deliverMail } = await import('../../services/mail/deliver.js');
  const { normalizeAttachments } = await import('../../services/mail/attachments.js');
  await deliverMail({ spaceId: 11, conn: { id: 7, creds: { smtp_host: 'test', username: 'me@example.com', password: 'test' } },
    to: queued.to_addresses, subject: queued.subject, messageId: queued.message_id,
    attachments: normalizeAttachments(queued.attachments) });
  expect(Number((await tx('files').count('* as n'))[0].n)).toBe(before + 1);
});

it('stores files added while editing a queued message without changing existing file identities', async () => {
  const queued = await tx('mail_outbox').where({ subject: 'Queued file' }).first();
  const before = Number((await tx('files').count('* as n'))[0].n);
  const response = await call('patch', 'scheduled/:id', { to: 'a@example.com', subject: queued.subject,
    scheduledAt: new Date(Date.now() + 60000).toISOString(),
    attachments: [{ filename: 'added.txt', contentType: 'text/plain', content: Buffer.from('added').toString('base64') }] }, { id: String(queued.id) });
  expect(response.status).toBe(200);
  expect(Number((await tx('files').count('* as n'))[0].n)).toBe(before + 1);
  const updated = await tx('mail_outbox').where({ id: queued.id }).first();
  expect(updated.message_id).toBe(queued.message_id);
  expect(updated.attachments).toHaveLength(2);
});
