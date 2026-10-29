// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const mock = vi.hoisted(() => ({ get: vi.fn(), run: vi.fn(), access: vi.fn(), fetch: vi.fn(), store: vi.fn() }));
vi.mock('../../database/connection.js', () => ({ dbGet: mock.get, dbRun: mock.run, dbAll: vi.fn(), withTransactionAsync: vi.fn() }));
vi.mock('../../services/space/access.js', () => ({ checkUserSpaceAccess: mock.access }));
vi.mock('../../services/mail/connector.js', () => ({ loadImapConnector: async () => ({ id: 7, creds: {} }) }));
vi.mock('../../services/mail/imapFetch.js', () => ({ imapFetch: mock.fetch }));
vi.mock('../../services/mail/attachmentStorage.js', () => ({ storeMailAttachments: mock.store }));
import router from '../../routes/v3/mail.js';
let root, message, file;
const route = router.stack.find((l) => l.route?.path.endsWith('/attachments/:index')).route.stack[0].handle;
async function download(query = {}, index = '0') {
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis(), set: vi.fn().mockReturnThis(),
    download: vi.fn(), sendFile: vi.fn() };
  await route({ params: { spaceId: '11', msgId: '5', index }, query, body: {}, user: { id: 1 } }, res);
  return res;
}
beforeEach(async () => {
  vi.resetAllMocks();
  root = await mkdtemp(path.join(os.tmpdir(), 'mail-download-'));
  vi.stubEnv('UPLOAD_PATH', root);
  file = { id: 'file1', path: path.join(root, 'photo.png'), original_name: 'photo.png' };
  await writeFile(file.path, 'image');
  message = { id: 5, space_id: 11, connector_id: 7, folder: 'f8', imap_folder: 'inbox', imap_uid: 42,
    imap_uid_validity: '123', message_id: '<old@example.com>', attachments: [{ filename: 'photo.png', fileId: 'file1' }] };
  mock.access.mockResolvedValue(true);
  mock.get.mockImplementation(async (sql) => sql.includes('FROM spaces') ? { id: 11 } : sql.includes('FROM files') ? file : message);
  mock.fetch.mockResolvedValue([{ imap_uid: 42, imap_uid_validity: '123', message_id: '<old@example.com>',
    attachments: [{ filename: 'photo.png', content: Buffer.from('image') }] }]);
  mock.store.mockResolvedValue([{ filename: 'photo.png', fileId: 'file1', url: '/uploads/photo.png' }]);
});
afterEach(async () => { vi.unstubAllEnvs(); await rm(root, { recursive: true, force: true }); });
it('previews a saved image and forces download when requested', async () => {
  expect((await download()).sendFile).toHaveBeenCalledWith(file.path);
  expect((await download({ download: '1' })).download).toHaveBeenCalledWith(file.path, 'photo.png');
  expect(mock.fetch).not.toHaveBeenCalled();
});
it('recovers an old attachment from its source folder after a local move', async () => {
  delete message.attachments[0].fileId;
  expect((await download()).sendFile).toHaveBeenCalledWith(file.path);
  expect(mock.fetch).toHaveBeenCalledWith(expect.objectContaining({ folder: 'inbox', uid: 42, includeAttachmentContent: true }));
  expect(mock.run).toHaveBeenCalledWith(expect.stringContaining('UPDATE mail_messages'), expect.arrayContaining([5, 11]));
});
it('does not serve a different message after UID validity changes', async () => {
  delete message.attachments[0].fileId;
  message.imap_uid_validity = '122';
  expect((await download()).status).toHaveBeenCalledWith(409);
  expect(mock.store).not.toHaveBeenCalled();
});
it('denies access before IMAP or file storage and validates the attachment index', async () => {
  mock.access.mockResolvedValue(false);
  expect((await download()).status).toHaveBeenCalledWith(403);
  expect(mock.fetch).not.toHaveBeenCalled();
  mock.access.mockResolvedValue(true);
  expect((await download({}, '-1')).status).toHaveBeenCalledWith(400);
  expect((await download({}, '2')).status).toHaveBeenCalledWith(404);
});
it('never renders HTML attachments inline', async () => {
  file.path = path.join(root, 'page.html');
  file.original_name = 'page.html';
  await writeFile(file.path, '<script>alert(1)</script>');
  expect((await download()).download).toHaveBeenCalledWith(file.path, 'page.html');
});
it('reports unrecoverable legacy sent attachments without inventing bytes', async () => {
  delete message.attachments[0].fileId;
  message.imap_uid = null;
  expect((await download()).status).toHaveBeenCalledWith(404);
  expect(mock.fetch).not.toHaveBeenCalled();
});

it('serves real bytes through cookie authentication, including download headers', async () => {
  const { default: express } = await import('express');
  const { default: cookieParser } = await import('cookie-parser');
  const { default: jwt } = await import('jsonwebtoken');
  const { default: request } = await import('supertest');
  const { authenticate } = await import('../../middleware/auth.js');
  const app = express().use(cookieParser()).use(authenticate, router);
  const url = '/spaces/11/mail/messages/5/attachments/0';
  expect((await request(app).get(url)).status).toBe(401);
  const token = jwt.sign({ id: 1 }, process.env.JWT_SECRET);
  const response = await request(app).get(`${url}?download=1`).set('Cookie', `access_token=${token}`);
  expect(response.status).toBe(200);
  expect(response.headers['content-disposition']).toContain('attachment;');
  expect(response.headers['x-content-type-options']).toBe('nosniff');
  expect(response.body).toEqual(Buffer.from('image'));
});
