// Run only inside the disposable Docker harness (selfhost-upgrade.py).
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import knex from 'knex';

const db = knex({ client: 'pg', connection: process.env.POSTGRES_URL });
try {
  assert.equal((await db.raw('SELECT current_database() AS name')).rows[0].name, 'godcrm_test');
  for (const table of ['mail_outbox', 'mail_boxes', 'mail_messages', 'mail_folders', 'mail_labels']) {
    assert.equal(await db.schema.hasTable(table), true, table);
  }
  assert.equal(await db.schema.hasColumn('users', 'handle'), true);
  assert.equal(Number((await db('knex_migrations').count('* AS n').first()).n), 0);
  const ledger = await db('selfhost_migrations').select('*');
  assert.equal(ledger.length, 1);
  const rerun = spawnSync('node', ['run-migrations.mjs', '--selfhost'], { encoding: 'utf8' });
  assert.equal(rerun.status, 0, rerun.stdout + rerun.stderr);
  assert.deepEqual(await db('selfhost_migrations').select('*'), ledger);
  assert.equal((await db('_app_settings').where('key', 'mailbox_provisioning_enabled').first()).value, false);

  // Real service, real PG and filesystem, no SMTP/IMAP server or external network.
  const { provisionMailbox } = await import('../../backend/services/mail/provisionMailbox.js');
  const { default: vault } = await import('../../backend/services/connectors/CredentialVault.js');
  const { default: bcrypt } = await import('bcrypt');
  await fs.mkdir(process.env.MAILBOX_VMAIL_ROOT, { recursive: true });
  const [user] = await db('users').insert({ email: 'selfhost-qa@example.test', name: 'Selfhost QA',
    password_hash: 'disabled', encryption_key_encrypted: 'test-only', user_type: 'human' }).returning('*');
  assert.equal((await provisionMailbox({ userId: user.id })).status, 'disabled');
  await db('_app_settings').where('key', 'mailbox_provisioning_enabled').update({ value: true });
  const created = await provisionMailbox({ userId: user.id, reason: 'isolated selfhost QA' });
  assert.equal(created.status, 'created');
  const box = await db('mail_boxes').where('id', created.mailboxId).first();
  const space = await db('spaces').where('id', created.spaceId).first();
  assert.equal(space.type, 'personal');
  assert.equal(space.owner_id, user.id);
  const connector = await db('space_connectors').where('id', created.connectorId).first();
  assert.equal(connector.created_by, user.id);
  assert.equal(connector.space_id, space.id);
  const credentials = vault.decrypt(connector.encrypted_payload);
  assert.equal(credentials.username, box.address);
  assert.equal(JSON.stringify(connector.encrypted_payload).includes(credentials.password), false);
  assert.equal(await bcrypt.compare(credentials.password, box.password_hash.replace('{BLF-CRYPT}', '')), true);
  const root = await fs.stat(process.env.MAILBOX_VMAIL_ROOT);
  for (const suffix of ['', 'cur', 'new', 'tmp']) {
    const stat = await fs.stat(`${box.maildir}/${suffix}`);
    assert.equal(stat.uid, root.uid);
    assert.equal(stat.gid, root.gid);
    assert.equal(stat.mode & 0o777, 0o700);
  }
  assert.equal((await provisionMailbox({ userId: user.id })).status, 'skipped');
  const defaultRerun = spawnSync('node', ['run-migrations.mjs'], { encoding: 'utf8' });
  assert.equal(defaultRerun.status, 0, defaultRerun.stdout + defaultRerun.stderr);
  assert.deepEqual(await db('selfhost_migrations').select('*'), ledger);
  assert.equal((await db('_app_settings').where('key', 'mailbox_provisioning_enabled').first()).value, true);
  await db('space_connectors').where('id', created.connectorId).delete();
  const repaired = await provisionMailbox({ userId: user.id });
  assert.equal(repaired.status, 'repaired');
  assert.equal(repaired.mailboxId, created.mailboxId);
  assert.notEqual((await db('mail_boxes').where('id', box.id).first()).password_hash, box.password_hash);
  assert.equal(Number((await db('mail_boxes').where('user_id', user.id).count('* AS n').first()).n), 1);
  process.stdout.write('PASS: schema, honest ledger, rerun, provisioning, vault, Maildir, repair\n');
} finally {
  await db.destroy();
  // The real service's shared adapter owns a separate pool.
  const { destroyAdapter } = await import('../../backend/database/connection.js');
  await destroyAdapter();
}
