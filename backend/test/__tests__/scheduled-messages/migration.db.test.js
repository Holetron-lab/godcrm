// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { up } from '../../../database/migrations/knex/115_scheduled_messages_recurrence.js';
import { closeDb, openDb, state } from './db-testkit.js';

const expectedColumns = [
  'id', 'conversation_id', 'sender_id', 'content', 'content_type', 'mentions', 'attachments',
  'metadata', 'scheduled_at', 'status', 'sent_message_id', 'error_message', 'created_at',
  'updated_at', 'recurrence_cron', 'timezone', 'max_runs', 'runs_done', 'last_fired_at',
  'attempts', 'next_attempt_at', 'sender_type', 'agent_id', 'role', 'expect_reply_from',
  'reply_check_at', 'reply_retries',
];

beforeEach(async () => {
  await openDb();
  const schema = `adr208_${randomUUID().replaceAll('-', '')}`;
  await state.trx.raw('CREATE SCHEMA ??', [schema]);
  await state.trx.raw('SET LOCAL search_path TO ??', [schema]);
});

afterEach(closeDb);

async function expectMigratedSchema() {
  const columns = await state.trx('information_schema.columns')
    .where({ table_schema: state.trx.raw('current_schema()'), table_name: 'scheduled_messages' })
    .pluck('column_name');
  expect(columns.sort()).toEqual([...expectedColumns].sort());
  const indexes = await state.trx('pg_indexes')
    .where({ schemaname: state.trx.raw('current_schema()'), tablename: 'scheduled_messages' })
    .pluck('indexname');
  expect(indexes).toEqual(expect.arrayContaining([
    'scheduled_messages_pkey', 'idx_scheduled_messages_pending', 'idx_scheduled_messages_reply_check',
  ]));
}

describe('ADR-208 AC1 — migration 108', () => {
  it('creates a clean schema twice and matches selfhost DDL', async () => {
    await up(state.trx);
    await up(state.trx);
    await expectMigratedSchema();

    const inserted = await state.trx('scheduled_messages')
      .insert({ conversation_id: 1, sender_id: 2, content: 'clean', scheduled_at: new Date() })
      .returning(['id', 'timezone', 'runs_done', 'sender_type', 'role', 'reply_retries']);
    expect(inserted[0]).toMatchObject({
      timezone: 'Europe/Moscow', runs_done: 0, sender_type: 'human', role: 'user', reply_retries: 0,
    });
    expect(Number(inserted[0].id)).toBeGreaterThan(0);

    const schemaSql = await readFile(new URL('../../../../deploy/selfhost/schema.sql', import.meta.url), 'utf8');
    const tableDdl = schemaSql.match(/CREATE TABLE public\.scheduled_messages \(([\s\S]*?)\);/)?.[1] || '';
    for (const column of expectedColumns) expect(tableDdl).toMatch(new RegExp(`\\b${column}\\b`));
    for (const definition of [
      'recurrence_cron text',
      "timezone text DEFAULT 'Europe/Moscow'::text NOT NULL",
      'max_runs integer',
      'runs_done integer DEFAULT 0 NOT NULL',
      'last_fired_at timestamp with time zone',
      'attempts integer DEFAULT 0 NOT NULL',
      'next_attempt_at timestamp with time zone',
      "sender_type text DEFAULT 'human'::text NOT NULL",
      'agent_id integer',
      "role text DEFAULT 'user'::text NOT NULL",
      'expect_reply_from integer',
      'reply_check_at timestamp with time zone',
      'reply_retries integer DEFAULT 0 NOT NULL',
    ]) expect(tableDdl).toContain(definition);
    expect(schemaSql).toContain('CREATE INDEX idx_scheduled_messages_pending ON public.scheduled_messages');
    expect(schemaSql).toContain('CREATE INDEX idx_scheduled_messages_reply_check ON public.scheduled_messages');
  }, 20000);

  it('upgrades a legacy table idempotently without disturbing its row or sequence', async () => {
    await state.trx.raw(`
      CREATE TABLE scheduled_messages (
        id SERIAL PRIMARY KEY,
        conversation_id INTEGER NOT NULL,
        sender_id INTEGER NOT NULL,
        content TEXT NOT NULL,
        content_type TEXT DEFAULT 'text',
        mentions TEXT DEFAULT '[]',
        attachments TEXT DEFAULT '[]',
        metadata TEXT DEFAULT '{}',
        scheduled_at TIMESTAMPTZ NOT NULL,
        status TEXT DEFAULT 'pending',
        sent_message_id INTEGER,
        error_message TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    const legacy = await state.trx('scheduled_messages')
      .insert({ conversation_id: 3, sender_id: 4, content: 'legacy', scheduled_at: new Date() })
      .returning('id');

    await up(state.trx);
    await up(state.trx);
    await expectMigratedSchema();

    const preserved = await state.trx('scheduled_messages').where({ id: legacy[0].id }).first();
    expect(preserved).toMatchObject({
      content: 'legacy', timezone: 'Europe/Moscow', runs_done: 0, attempts: 0,
      sender_type: 'human', role: 'user', reply_retries: 0,
    });
    const next = await state.trx('scheduled_messages')
      .insert({ conversation_id: 3, sender_id: 4, content: 'next', scheduled_at: new Date() })
      .returning('id');
    expect(Number(next[0].id)).toBeGreaterThan(Number(legacy[0].id));
  }, 20000);
});
