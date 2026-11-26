import { randomUUID } from 'node:crypto';
import knexFactory from 'knex';
import '../../setup.js';

export const state = {
  knex: null,
  trx: null,
  failMessageInserts: false,
};

const raw = (sql, params) => state.trx.raw(sql.replace(/\$\d+/g, '?'), params);

export async function get(sql, params = []) {
  const result = await raw(sql, params);
  return result.rows[0];
}

export async function all(sql, params = []) {
  const result = await raw(sql, params);
  return result.rows;
}

export async function run(sql, params = []) {
  if (state.failMessageInserts && /^\s*INSERT\s+INTO\s+messages\b/i.test(sql)) {
    throw new Error('ADR-208 induced message insert failure');
  }
  const returning = /^\s*INSERT\s+INTO\b/i.test(sql) && !/\bRETURNING\b/i.test(sql);
  const result = await raw(returning ? `${sql} RETURNING id` : sql, params);
  return {
    changes: result.rowCount,
    lastInsertRowid: result.rows[0]?.id ?? 0,
  };
}

export const withTransactionAsync = callback => callback({ get, all, run });
export const isPostgres = () => true;
export const sqlNow = () => 'NOW()';
export const toBool = value => value ? 1 : 0;

export function safeJsonParse(value, fallback = null) {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

export async function openDb(migrate = null) {
  const knex = knexFactory({
    client: 'pg',
    connection: {
      host: process.env.POSTGRES_HOST,
      port: Number(process.env.POSTGRES_PORT),
      database: process.env.POSTGRES_DB,
      user: process.env.POSTGRES_USER,
      password: process.env.POSTGRES_PASSWORD,
    },
    pool: { min: 0, max: 1 },
  });
  const { rows: [database] } = await knex.raw('SELECT current_database() AS name');
  if (database.name !== 'godcrm_test') throw new Error(`Expected godcrm_test, got ${database.name}`);
  state.knex = knex;
  state.trx = await knex.transaction();
  if (migrate) await migrate(state.trx);
  return state.trx;
}

export async function closeDb() {
  const { trx, knex } = state;
  state.trx = null;
  state.knex = null;
  state.failMessageInserts = false;
  if (trx) await trx.rollback();
  if (knex) await knex.destroy();
}

export async function createConversation(ws, participants = null) {
  const result = await run(
    "INSERT INTO conversations (type, created_by, title, space_id) VALUES ('chat', ?, ?, ?)",
    [ws.userId, `ADR-208 ${ws.token}`, ws.spaceId],
  );
  const conversationId = result.lastInsertRowid;
  const rows = participants || [{ userId: ws.userId, role: 'admin' }];
  for (const { userId, role = 'member', userType = 'human' } of rows) {
    await run(
      'INSERT INTO conversation_participants (conversation_id, user_id, role, user_type) VALUES (?, ?, ?, ?)',
      [conversationId, userId, role, userType],
    );
  }
  return conversationId;
}

export async function createScheduled(conversationId, overrides = {}) {
  const row = {
    conversation_id: conversationId,
    sender_id: overrides.sender_id,
    content: 'ADR-208 scheduled test',
    content_type: 'text',
    mentions: '[]',
    attachments: '[]',
    metadata: '{}',
    scheduled_at: new Date(Date.now() + 60 * 60_000).toISOString(),
    status: 'pending',
    sent_message_id: null,
    error_message: null,
    recurrence_cron: null,
    timezone: 'Europe/Moscow',
    max_runs: null,
    runs_done: 0,
    attempts: 0,
    next_attempt_at: null,
    sender_type: 'human',
    agent_id: null,
    role: 'user',
    expect_reply_from: null,
    reply_check_at: null,
    reply_retries: 0,
    ...overrides,
  };
  const result = await run(
    `INSERT INTO scheduled_messages (
      conversation_id, sender_id, content, content_type, mentions, attachments, metadata,
      scheduled_at, status, sent_message_id, error_message, recurrence_cron, timezone,
      max_runs, runs_done, attempts, next_attempt_at, sender_type, agent_id, role,
      expect_reply_from, reply_check_at, reply_retries
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      row.conversation_id, row.sender_id, row.content, row.content_type, row.mentions,
      row.attachments, typeof row.metadata === 'string' ? row.metadata : JSON.stringify(row.metadata),
      row.scheduled_at, row.status, row.sent_message_id, row.error_message, row.recurrence_cron,
      row.timezone, row.max_runs, row.runs_done, row.attempts, row.next_attempt_at,
      row.sender_type, row.agent_id, row.role, row.expect_reply_from, row.reply_check_at,
      row.reply_retries,
    ],
  );
  return result.lastInsertRowid;
}

export async function createUser(label) {
  const result = await run(
    `INSERT INTO users (email, password_hash, name, encryption_key_encrypted, email_verified)
     VALUES (?, ?, ?, ?, ?)`,
    [`adr208-${label}-${randomUUID()}@test.godcrm.local`, 'test-hash', `ADR-208 ${label}`, 'test-key', 1],
  );
  return result.lastInsertRowid;
}

export async function createAgentAuthor(ws) {
  const agentRow = await run(
    'INSERT INTO table_rows (table_id, base_id, data) VALUES (?, ?, ?)',
    [ws.tableId, `adr208-agent-${randomUUID()}`, JSON.stringify({
      name: 'ADR-208 Scheduler', icon: '🔁', color: '#123456',
    })],
  );
  const agentRowId = agentRow.lastInsertRowid;
  const agentUser = await run(
    `INSERT INTO users (
      email, password_hash, name, encryption_key_encrypted, email_verified,
      user_type, managed_by_agent_table_id, managed_by_agent_row_id
    ) VALUES (?, ?, ?, ?, ?, 'agent', ?, ?)`,
    [
      `adr208-agent-${randomUUID()}@test.godcrm.local`, 'test-hash', 'ADR-208 Scheduler',
      'test-key', 1, ws.tableId, agentRowId,
    ],
  );
  return { agentRowId, agentUserId: agentUser.lastInsertRowid };
}
