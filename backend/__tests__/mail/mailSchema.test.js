// @vitest-environment node
import '../../test/setup.js';
import { expect, it } from 'vitest';
import knexFactory from 'knex';
import { randomUUID } from 'node:crypto';
import { up, down } from '../../database/migrations/knex/102_mail_folders_reply_source.js';

it('migrates twice, preserves moved IMAP identity, and rolls back in an isolated test schema', async () => {
  const knex = knexFactory({ client: 'pg', connection: {
    host: process.env.POSTGRES_HOST, port: Number(process.env.POSTGRES_PORT),
    database: process.env.POSTGRES_DB, user: process.env.POSTGRES_USER, password: process.env.POSTGRES_PASSWORD,
  }, pool: { min: 0, max: 1 } });
  let tx;
  try {
    const { rows: [db] } = await knex.raw('SELECT current_database() AS name');
    expect(db.name).toBe('godcrm_test');
    tx = await knex.transaction();
    const schema = `mail_ux_${randomUUID().replaceAll('-', '')}`;
    await tx.raw('CREATE SCHEMA ??', [schema]);
    await tx.raw('SET LOCAL search_path TO ??', [schema]);
    await tx.raw(`CREATE TABLE spaces (id INTEGER PRIMARY KEY);
      CREATE TABLE projects (id INTEGER PRIMARY KEY);
      CREATE TABLE mail_messages (id BIGSERIAL PRIMARY KEY, connector_id INTEGER, folder TEXT, imap_uid BIGINT);
      CREATE TABLE mail_outbox (id BIGSERIAL PRIMARY KEY);
      CREATE UNIQUE INDEX mail_messages_sync_uq ON mail_messages(connector_id, folder, imap_uid);
      INSERT INTO spaces VALUES (11);
      INSERT INTO mail_messages(connector_id, folder, imap_uid) VALUES (7, 'inbox', 42);`);
    await up(tx);
    await up(tx);
    await tx('mail_messages').update({ folder: 'f8' });
    await tx.raw(`INSERT INTO mail_messages(connector_id, folder, imap_folder, imap_uid)
      VALUES (7, 'inbox', 'inbox', 42) ON CONFLICT(connector_id, imap_folder, imap_uid)
      DO UPDATE SET imap_uid = EXCLUDED.imap_uid`);
    expect(await tx('mail_messages').select('folder', 'imap_folder')).toEqual([{ folder: 'f8', imap_folder: 'inbox' }]);
    await tx.raw(`WITH n AS (SELECT nextval('mail_folders_id_seq') AS id)
      INSERT INTO mail_folders(id, space_id, key, name) SELECT id, 11, 'f' || id, 'Clients' FROM n`);
    expect((await tx('mail_folders').first()).key).toMatch(/^f\d+$/);
    await down(tx);
    expect((await tx('mail_messages').first()).folder).toBe('inbox');
  } finally {
    if (tx) await tx.rollback();
    await knex.destroy();
  }
}, 20000);
