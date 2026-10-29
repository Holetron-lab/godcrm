// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const mocks = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock('../../database/connection.js', () => ({ withTransactionAsync: (fn) => fn({ run: mocks.run }) }));
import { storeMailAttachments } from '../../services/mail/attachmentStorage.js';
let root;
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'mail-files-'));
  vi.stubEnv('UPLOAD_PATH', root);
  vi.clearAllMocks();
  mocks.run.mockResolvedValue({ changes: 0 });
});
afterEach(async () => { vi.unstubAllEnvs(); await rm(root, { recursive: true, force: true }); });
const input = { spaceId: 11, connectorId: 7, messageId: '<mail@example.com>', projectId: 3, userId: 1,
  attachments: [{ filename: '../../Счёт.pdf', contentType: 'application/pdf', content: Buffer.from('invoice') }] };
it('stores private project files with bytes, safe paths and no bytes in the returned metadata', async () => {
  const [att] = await storeMailAttachments(input);
  expect(att).toMatchObject({ filename: '../../Счёт.pdf', contentType: 'application/pdf', size: 7, fileId: expect.any(String), url: expect.stringMatching(/^\/uploads\/spaces\/11\/mail_.*\.pdf$/) });
  expect(att.content).toBeUndefined();
  expect(await readFile(path.join(root, att.url.replace('/uploads/', '')), 'utf8')).toBe('invoice');
  const [sql, values] = mocks.run.mock.calls.find(([query]) => query.startsWith('INSERT INTO files'));
  expect(sql).toContain("'private'");
  expect(values).toContain(3);
  expect(values).toContain(JSON.stringify({ source: 'mail', message_id: '<mail@example.com>', index: 0 }));
});
it('deduplicates repeated/concurrent sync of the same attachment but isolates spaces', async () => {
  const [a, b] = await Promise.all([storeMailAttachments(input), storeMailAttachments(input)]);
  expect(a).toEqual(b);
  const other = await storeMailAttachments({ ...input, spaceId: 12 });
  expect(other[0].fileId).not.toBe(a[0].fileId);
});
it('refuses missing bytes and invalid scope before writing', async () => {
  await expect(storeMailAttachments({ ...input, spaceId: '../12' })).rejects.toThrow();
  await expect(storeMailAttachments({ ...input, attachments: [{ filename: 'lost.pdf' }] })).rejects.toThrow();
  expect(mocks.run).not.toHaveBeenCalled();
});
