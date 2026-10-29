// @vitest-environment node
import '../../test/setup.js';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import knexFactory from 'knex';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const mock = vi.hoisted(() => ({ transaction: vi.fn() }));
vi.mock('../../database/connection.js', () => ({ withTransactionAsync: mock.transaction }));
import { storeMailAttachments } from '../../services/mail/attachmentStorage.js';

let db, root;
const schema = `mail_files_${randomUUID().replaceAll('-', '')}`;
const input = { spaceId: 11, connectorId: 7, messageId: '<file@example.com>',
  attachments: [{ filename: 'invoice.pdf', contentType: 'application/pdf', content: Buffer.from('invoice') }] };

beforeAll(async () => {
  db = knexFactory({ client: 'pg', connection: { host: process.env.POSTGRES_HOST,
    port: Number(process.env.POSTGRES_PORT), database: process.env.POSTGRES_DB,
    user: process.env.POSTGRES_USER, password: process.env.POSTGRES_PASSWORD }, pool: { min: 0, max: 4 } });
  expect((await db.raw('SELECT current_database() AS name')).rows[0].name).toBe('godcrm_test');
  await db.schema.createSchema(schema);
  // Mirror the installed schema: no PRIMARY KEY or UNIQUE constraint on id.
  await db.schema.withSchema(schema).createTable('files', (table) => {
    table.string('id', 100).notNullable();
    for (const key of ['name', 'original_name', 'mime_type', 'path', 'url', 'storage_provider_id', 'visibility']) table.text(key);
    for (const key of ['space_id', 'project_id', 'uploaded_by', 'size']) table.integer(key);
    table.jsonb('metadata');
    table.timestamp('created_at');
    table.timestamp('updated_at');
  });
  mock.transaction.mockImplementation((fn) => db.transaction(async (tx) => {
    await tx.raw('SET LOCAL search_path TO ??', [schema]);
    await tx.raw("SET LOCAL statement_timeout = '3s'");
    return fn({ run: async (sql, values = []) => ({ changes: (await tx.raw(sql, values)).rowCount }) });
  }));
  root = await mkdtemp(path.join(os.tmpdir(), 'mail-files-pg-'));
  vi.stubEnv('UPLOAD_PATH', root);
}, 20000);

afterAll(async () => {
  vi.unstubAllEnvs();
  if (db) {
    await db.schema.withSchema(schema).dropTableIfExists('files');
    await db.schema.dropSchemaIfExists(schema);
    await db.destroy();
  }
  if (root) await rm(root, { recursive: true, force: true });
});

it('stores bytes without a unique files.id and fills a missing project without replacing one', async () => {
  const [file] = await storeMailAttachments(input);
  expect(await readFile(path.join(root, file.url.replace('/uploads/', '')), 'utf8')).toBe('invoice');
  await storeMailAttachments({ ...input, projectId: 3 });
  await storeMailAttachments({ ...input, projectId: 4 });
  expect(await db.withSchema(schema).from('files').where({ id: file.fileId }).select('project_id', 'visibility'))
    .toEqual([{ project_id: 3, visibility: 'private' }]);
});

it('deduplicates simultaneous transactions and isolates connector and space identities', async () => {
  const concurrent = { ...input, messageId: '<concurrent@example.com>' };
  const results = await Promise.all(Array.from({ length: 4 }, () => storeMailAttachments(concurrent)));
  expect(results.every((r) => r[0].fileId === results[0][0].fileId)).toBe(true);
  expect(await db.withSchema(schema).from('files').where({ id: results[0][0].fileId })).toHaveLength(1);
  const [otherSpace] = await storeMailAttachments({ ...concurrent, spaceId: 12 });
  const [otherConnector] = await storeMailAttachments({ ...concurrent, connectorId: 8 });
  expect(new Set([results[0][0].fileId, otherSpace.fileId, otherConnector.fileId]).size).toBe(3);
});

it('does not require cleanup of unrelated pre-existing duplicate ids', async () => {
  await db.withSchema(schema).into('files').insert([{ id: 'legacy' }, { id: 'legacy' }]);
  const [file] = await storeMailAttachments({ ...input, messageId: '<after-legacy@example.com>' });
  expect(await db.withSchema(schema).from('files').where({ id: file.fileId })).toHaveLength(1);
  expect(await db.withSchema(schema).from('files').where({ id: 'legacy' })).toHaveLength(2);
});
