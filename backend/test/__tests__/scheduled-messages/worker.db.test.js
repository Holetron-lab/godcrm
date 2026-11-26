// @vitest-environment node
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as h from './db-testkit.js';

const mocks = vi.hoisted(() => ({
  dispatch: vi.fn(),
  executeAgent: vi.fn(),
  autoAgents: vi.fn(),
  shouldAuto: vi.fn(),
  defaultAgent: vi.fn(),
  resolveMentioned: vi.fn(),
  resolveAgent: vi.fn(),
  withLock: vi.fn(),
}));

vi.mock('../../../database/connection.js', async () => ({
  dbGet: h.get, dbAll: h.all, dbRun: h.run, isPostgres: h.isPostgres,
  safeJsonParse: h.safeJsonParse, toBool: h.toBool, withTransactionAsync: h.withTransactionAsync,
}));
vi.mock('../../../utils/logger.js', () => ({
  apiLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../../routes/v3/chat/chatAgentExecution.js', () => ({ executeAgentResponse: mocks.executeAgent }));
vi.mock('../../../routes/v3/chat/chatAgentAutoRespond.js', () => ({
  getAutoRespondAgents: mocks.autoAgents,
  shouldAutoRespondWithAI: mocks.shouldAuto,
  getDefaultAgentForConversation: mocks.defaultAgent,
}));
vi.mock('../../../routes/v3/chat/chatShared.js', () => ({
  conversationLock: { withLock: mocks.withLock },
  parseInvocationMentions: content => [...String(content).matchAll(/<<@([a-z0-9_-]+)>>/gi)].map(match => match[1]),
}));
vi.mock('../../../routes/v3/chat/chatAgentHelpers.js', () => ({
  resolveMentionedUser: mocks.resolveMentioned,
  resolveAgentUser: mocks.resolveAgent,
}));
vi.mock('../../../services/chat/invocation-dispatcher.js', () => ({
  dispatchInvocationsFromContent: mocks.dispatch,
  hasInvocationTokens: content => /<<@[a-z0-9_-]+>>/i.test(content || ''),
}));

const { sendScheduledMessage, tick } = await import('../../../services/ScheduledMessageWorker.js');
const { createEphemeralWorkspace } = await import('../../../tests/helpers/workspace-fixture.js');
const { up } = await import('../../../database/migrations/knex/115_scheduled_messages_recurrence.js');

let ws;
let conversationId;

beforeAll(async () => {
  await h.openDb(up);
}, 20000);

beforeEach(async () => {
  vi.clearAllMocks();
  h.state.failMessageInserts = false;
  mocks.dispatch.mockResolvedValue({ triggered: 1, skipped: 0 });
  mocks.autoAgents.mockResolvedValue([]);
  mocks.shouldAuto.mockResolvedValue(false);
  mocks.defaultAgent.mockResolvedValue(null);
  mocks.resolveMentioned.mockResolvedValue({ isAgent: true, user: { managed_by_agent_row_id: 77 } });
  mocks.resolveAgent.mockResolvedValue(null);
  mocks.withLock.mockImplementation(async (_id, callback) => callback());
  await h.run("UPDATE scheduled_messages SET status = 'cancelled', reply_check_at = NULL");
  ws = await createEphemeralWorkspace({ label: 'scheduled-worker', dashboard: false, table: true });
  conversationId = await h.createConversation(ws);
});

afterEach(async () => {
  await ws?.cleanup();
  ws = null;
  conversationId = null;
});

afterAll(h.closeDb);

async function scheduledRow(id) {
  return h.get('SELECT * FROM scheduled_messages WHERE id = ?', [id]);
}

async function messages() {
  return h.all('SELECT * FROM messages WHERE conversation_id = ? ORDER BY id', [conversationId]);
}

async function failThreeTimes(id) {
  const snapshots = [];
  h.state.failMessageInserts = true;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await tick();
    snapshots.push(await scheduledRow(id));
    if (attempt < 2) {
      await h.run("UPDATE scheduled_messages SET next_attempt_at = NOW() - INTERVAL '1 second' WHERE id = ?", [id]);
    }
  }
  h.state.failMessageInserts = false;
  return snapshots;
}

describe('ADR-208 AC2–AC6 — worker delivery and recovery', () => {
  it('AC2 preserves one-shot WP-17 delivery and the wake-up pending contract', async () => {
    const id = await h.createScheduled(conversationId, {
      sender_id: ws.userId,
      content: 'one shot',
      scheduled_at: new Date(Date.now() - 60_000).toISOString(),
    });

    await tick();

    const row = await scheduledRow(id);
    const messageId = Number(row.sent_message_id);
    expect(messageId).toBeGreaterThan(0);
    const delivered = await h.get('SELECT * FROM messages WHERE id = ?', [messageId]);
    expect(row.status).toBe('sent');
    expect(Number(row.sent_message_id)).toBe(messageId);
    expect(delivered).toMatchObject({ sender_type: 'human', role: 'user', content: 'one shot' });
    expect(h.safeJsonParse(delivered.metadata, {})).toMatchObject({ scheduled_message_id: id, run_index: 1 });
    expect(mocks.autoAgents).toHaveBeenCalledWith(conversationId, ws.userId, 'one shot');
  });

  it('AC3 advances a */15 series and completes exactly at max_runs=3', async () => {
    const id = await h.createScheduled(conversationId, {
      sender_id: ws.userId,
      content: 'series',
      recurrence_cron: '*/15 * * * *',
      max_runs: 3,
      scheduled_at: new Date(Date.now() - 60_000).toISOString(),
    });

    await sendScheduledMessage(await scheduledRow(id));
    const first = await scheduledRow(id);
    expect(first).toMatchObject({ status: 'pending', runs_done: 1 });
    expect(new Date(first.scheduled_at).getTime()).toBeGreaterThan(Date.now());
    expect(new Date(first.scheduled_at).getUTCMinutes() % 15).toBe(0);

    await sendScheduledMessage(await scheduledRow(id));
    await sendScheduledMessage(await scheduledRow(id));
    const third = await scheduledRow(id);
    expect(third).toMatchObject({ status: 'sent', runs_done: 3 });
    const delivered = await messages();
    expect(delivered).toHaveLength(3);
    expect(delivered.map(message => h.safeJsonParse(message.metadata, {}).run_index)).toEqual([1, 2, 3]);
  });

  it('AC4 skips an expired run without delivery and moves the series into the future', async () => {
    const id = await h.createScheduled(conversationId, {
      sender_id: ws.userId,
      recurrence_cron: '0 9 * * *',
      scheduled_at: new Date(Date.now() - 26 * 60 * 60_000).toISOString(),
    });

    await tick();

    const row = await scheduledRow(id);
    expect(row.status).toBe('pending');
    expect(row.error_message).toContain('skipped');
    expect(row.runs_done).toBe(0);
    expect(new Date(row.scheduled_at).getTime()).toBeGreaterThan(Date.now());
    expect(await messages()).toHaveLength(0);
  });

  it('AC5 backs off twice and fails a one-shot on the third insert failure', async () => {
    const id = await h.createScheduled(conversationId, {
      sender_id: ws.userId,
      scheduled_at: new Date(Date.now() - 60_000).toISOString(),
    });

    const [first, second, third] = await failThreeTimes(id);

    expect([first.attempts, second.attempts, third.attempts]).toEqual([1, 2, 3]);
    expect(new Date(first.next_attempt_at) - new Date(first.updated_at)).toBe(60_000);
    expect(new Date(second.next_attempt_at) - new Date(second.updated_at)).toBe(300_000);
    expect(third.status).toBe('failed');
    expect(third.error_message).toContain('induced message insert failure');
    expect(await messages()).toHaveLength(0);
  });

  it('AC5 keeps a recurring series alive after its third insert failure', async () => {
    const id = await h.createScheduled(conversationId, {
      sender_id: ws.userId,
      recurrence_cron: '*/15 * * * *',
      scheduled_at: new Date(Date.now() - 60_000).toISOString(),
    });

    const [, , third] = await failThreeTimes(id);

    expect(third.status).toBe('pending');
    expect(third.attempts).toBe(0);
    expect(third.error_message).toContain('run failed:');
    expect(new Date(third.scheduled_at).getTime()).toBeGreaterThan(Date.now());
    expect(await messages()).toHaveLength(0);
  });

  it('AC6 persists agent role, sender type and avatar metadata', async () => {
    const { agentRowId, agentUserId } = await h.createAgentAuthor(ws);
    const metadata = {
      agent_name: 'ADR-208 Scheduler', agent_icon: '🔁', agent_color: '#123456', agent_row_id: agentRowId,
    };
    const id = await h.createScheduled(conversationId, {
      sender_id: agentUserId,
      sender_type: 'agent',
      role: 'assistant',
      agent_id: agentRowId,
      recurrence_cron: '*/15 * * * *',
      metadata,
      scheduled_at: new Date(Date.now() - 60_000).toISOString(),
    });

    const messageId = await sendScheduledMessage(await scheduledRow(id));

    const delivered = await h.get('SELECT * FROM messages WHERE id = ?', [messageId]);
    expect(delivered).toMatchObject({ sender_id: agentUserId, sender_type: 'agent', role: 'assistant', agent_id: agentRowId });
    expect(h.safeJsonParse(delivered.metadata, {})).toMatchObject(metadata);
  });
});

describe('ADR-208 AC7 — agent reply guarantee', () => {
  async function primeReplyCheck({ withReply = false } = {}) {
    const id = await h.createScheduled(conversationId, {
      sender_id: ws.userId,
      content: '<<@scheduler>> daily report',
      status: 'sent',
      expect_reply_from: 77,
    });
    const initial = await h.run(
      `INSERT INTO messages (conversation_id, sender_id, sender_type, role, content, metadata)
       VALUES (?, ?, 'human', 'user', '<<@scheduler>> daily report', ?::jsonb)`,
      [conversationId, ws.userId, JSON.stringify({ scheduled_message_id: id, run_index: 1 })],
    );
    await h.run(
      "UPDATE scheduled_messages SET sent_message_id = ?, reply_check_at = NOW() - INTERVAL '1 minute' WHERE id = ?",
      [initial.lastInsertRowid, id],
    );
    if (withReply) {
      await h.run(
        `INSERT INTO messages (conversation_id, sender_id, sender_type, role, agent_id, content, metadata)
         VALUES (?, ?, 'agent', 'assistant', 77, 'done', ?::jsonb)`,
        [conversationId, ws.userId, JSON.stringify({ agent_row_id: 77 })],
      );
    }
    return { id, initialMessageId: initial.lastInsertRowid };
  }

  it('sends exactly one retry and then stops without an agent reply', async () => {
    const { id, initialMessageId } = await primeReplyCheck();

    await tick();
    let delivered = await messages();
    expect(delivered).toHaveLength(2);
    const retry = delivered.find(message => message.id !== initialMessageId);
    expect(h.safeJsonParse(retry.metadata, {})).toMatchObject({
      scheduled_message_id: id, retry_of: initialMessageId,
    });
    expect((await scheduledRow(id)).reply_retries).toBe(1);

    await h.run("UPDATE scheduled_messages SET reply_check_at = NOW() - INTERVAL '1 minute' WHERE id = ?", [id]);
    await tick();
    delivered = await messages();
    expect(delivered).toHaveLength(2);
    const row = await scheduledRow(id);
    expect(row.reply_check_at).toBeNull();
    expect(row.error_message).toBe('no agent reply after retry');
  });

  it('clears the check without a retry when the expected agent replied', async () => {
    const { id } = await primeReplyCheck({ withReply: true });

    await tick();

    expect(await messages()).toHaveLength(2);
    const row = await scheduledRow(id);
    expect(row.reply_check_at).toBeNull();
    expect(row.reply_retries).toBe(0);
    expect(row.error_message).toBeNull();
  });
});
