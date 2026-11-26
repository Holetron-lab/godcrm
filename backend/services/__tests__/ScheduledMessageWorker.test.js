import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const h = vi.hoisted(() => ({
  dbRun: vi.fn(),
  dbGet: vi.fn(),
  dbAll: vi.fn(),
  trx: { get: vi.fn(), run: vi.fn() },
  dispatch: vi.fn(),
  executeAgent: vi.fn(),
  autoAgents: vi.fn(),
  shouldAuto: vi.fn(),
  defaultAgent: vi.fn(),
  resolveMentioned: vi.fn(),
  resolveAgent: vi.fn(),
  lock: { withLock: vi.fn() },
}));

vi.mock('../../database/connection.js', () => ({
  dbRun: h.dbRun,
  dbGet: h.dbGet,
  dbAll: h.dbAll,
  safeJsonParse: (value, fallback) => {
    if (value === null || value === undefined) return fallback;
    if (typeof value === 'object') return value;
    try { return JSON.parse(value); } catch { return fallback; }
  },
  withTransactionAsync: (callback) => callback(h.trx),
}));
vi.mock('../../utils/logger.js', () => ({
  apiLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../routes/v3/chat/chatAgentExecution.js', () => ({ executeAgentResponse: h.executeAgent }));
vi.mock('../../routes/v3/chat/chatAgentAutoRespond.js', () => ({
  getAutoRespondAgents: h.autoAgents,
  shouldAutoRespondWithAI: h.shouldAuto,
  getDefaultAgentForConversation: h.defaultAgent,
}));
vi.mock('../../routes/v3/chat/chatShared.js', () => ({
  conversationLock: h.lock,
  parseInvocationMentions: (content) => [...String(content).matchAll(/<<@([a-z0-9_-]+)>>/gi)].map((m) => m[1]),
}));
vi.mock('../../routes/v3/chat/chatAgentHelpers.js', () => ({
  resolveMentionedUser: h.resolveMentioned,
  resolveAgentUser: h.resolveAgent,
}));
vi.mock('../chat/invocation-dispatcher.js', () => ({
  dispatchInvocationsFromContent: h.dispatch,
  hasInvocationTokens: (content) => /<<@[a-z0-9_-]+>>|<<\/[a-z][a-z0-9_-]*(?:\/\d+)?>>/i.test(content || ''),
}));

import { sendScheduledMessage, tick } from '../ScheduledMessageWorker.js';

function makeRow(overrides = {}) {
  return {
    id: 1,
    conversation_id: 2,
    sender_id: 3,
    content: 'hello',
    content_type: 'text',
    mentions: '[]',
    attachments: '[]',
    metadata: '{}',
    scheduled_at: '2026-11-07T11:59:00.000Z',
    status: 'pending',
    sender_type: 'human',
    role: 'user',
    agent_id: null,
    runs_done: 0,
    max_runs: null,
    attempts: 0,
    reply_retries: 0,
    timezone: 'Europe/Moscow',
    ...overrides,
  };
}

function primeDelivery(row, messageId = 100) {
  h.trx.get.mockResolvedValue(row);
  h.trx.run.mockImplementation(async (sql) => ({
    changes: 1,
    lastInsertRowid: sql.includes('INSERT INTO messages') ? messageId : 0,
  }));
}

function queueTick(due, replies = []) {
  h.dbAll.mockResolvedValueOnce(due).mockResolvedValueOnce(replies);
}

function messageInsertCall() {
  return h.trx.run.mock.calls.find(([sql]) => sql.includes('INSERT INTO messages'));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-07T12:00:00.000Z'));
  h.dbRun.mockResolvedValue({ changes: 1 });
  h.dbAll.mockResolvedValue([]);
  h.dbGet.mockResolvedValue({ space_id: 11 });
  h.dispatch.mockResolvedValue({ triggered: 1, skipped: 0 });
  h.autoAgents.mockResolvedValue([]);
  h.shouldAuto.mockResolvedValue(false);
  h.defaultAgent.mockResolvedValue(null);
  h.resolveMentioned.mockResolvedValue({ isAgent: true, user: { managed_by_agent_row_id: 77 } });
  h.resolveAgent.mockResolvedValue(null);
  h.lock.withLock.mockImplementation(async (_id, callback) => callback());
});

afterEach(() => {
  vi.useRealTimers();
});

describe('ScheduledMessageWorker delivery', () => {
  it('keeps one-shot WP-17 delivery and marks it sent', async () => {
    const row = makeRow();
    primeDelivery(row);

    await expect(sendScheduledMessage(row)).resolves.toBe(100);

    const insert = messageInsertCall();
    expect(insert[1].slice(0, 6)).toEqual([2, 3, 'human', 'user', null, 'hello']);
    expect(JSON.parse(insert[1][9])).toMatchObject({ scheduled_message_id: 1, run_index: 1 });
    expect(h.trx.run.mock.calls.some(([sql]) => sql.includes("SET status = 'sent'"))).toBe(true);
    expect(h.autoAgents).toHaveBeenCalledWith(2, 3, 'hello');
  });

  it('preserves agent authorship and schedules an agent-reply check', async () => {
    const row = makeRow({
      content: '<<@architect>> daily summary',
      sender_type: 'agent',
      role: 'assistant',
      agent_id: 42,
      metadata: JSON.stringify({ agent_name: 'Ralph', agent_row_id: 42 }),
    });
    primeDelivery(row);

    await sendScheduledMessage(row);

    const insert = messageInsertCall();
    expect(insert[1][2]).toBe('agent');
    expect(insert[1][3]).toBe('assistant');
    expect(insert[1][4]).toBe(42);
    expect(JSON.parse(insert[1][9])).toMatchObject({ agent_name: 'Ralph', agent_row_id: 42 });
    expect(h.dispatch).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: 2,
      sourceMessageId: 100,
      sourceAgentId: 42,
      sourceLabel: 'scheduled_message',
    }));
    const replyUpdate = h.dbRun.mock.calls.find(([sql]) => sql.includes('expect_reply_from = ?'));
    expect(replyUpdate[1][0]).toBe(77);
    expect(replyUpdate[1][2]).toBe(10);
  });

  it('advances a series and completes it at max_runs', async () => {
    const row = makeRow({ recurrence_cron: '*/15 * * * *', runs_done: 2, max_runs: 3 });
    primeDelivery(row);

    await sendScheduledMessage(row);

    expect(JSON.parse(messageInsertCall()[1][9]).run_index).toBe(3);
    const update = h.trx.run.mock.calls.find(([sql]) => sql.includes('runs_done = ?'));
    expect(update[1][0]).toBe('sent');
    expect(update[1][1]).toBe(3);
    expect(update[1][3]).toBe('2026-11-07T12:15:00.000Z');
  });

  it('keeps a series pending after an ordinary run', async () => {
    const row = makeRow({ recurrence_cron: '*/15 * * * *' });
    primeDelivery(row);

    await sendScheduledMessage(row);

    const update = h.trx.run.mock.calls.find(([sql]) => sql.includes('runs_done = ?'));
    expect(update[1][0]).toBe('pending');
    expect(update[1][1]).toBe(1);
    expect(update[1][3]).toBe('2026-11-07T12:15:00.000Z');
  });
});

describe('ScheduledMessageWorker recovery', () => {
  it('skips an expired recurring run without inserting a message', async () => {
    const row = makeRow({ recurrence_cron: '0 9 * * *', scheduled_at: '2026-11-06T06:00:00.000Z' });
    queueTick([row]);

    await tick();

    expect(h.trx.run).not.toHaveBeenCalled();
    const skip = h.dbRun.mock.calls.find(([sql]) => sql.includes("skipped: missed window"));
    expect(skip[1][0]).toBe('2026-11-08T06:00:00.000Z');
    expect(skip[1][1]).toBe('pending');
  });

  it('retries a one-shot failure twice and then marks it failed', async () => {
    for (const attempts of [0, 1, 2]) queueTick([makeRow({ attempts })]);
    h.trx.get.mockRejectedValue(new Error('database unavailable'));

    await tick();
    await tick();
    await tick();

    const backoff = h.dbRun.mock.calls.filter(([sql]) => sql.includes('next_attempt_at = NOW() +'));
    expect(backoff.map((call) => call[1][0])).toEqual([1, 2]);
    expect(backoff.map((call) => call[1][1])).toEqual([1, 5]);
    expect(h.dbRun.mock.calls.some(([sql, params]) => sql.includes("SET status = 'failed'") && params[0] === 3)).toBe(true);
  });

  it('continues a recurring series after its third delivery failure', async () => {
    for (const attempts of [0, 1, 2]) queueTick([makeRow({ attempts, recurrence_cron: '*/15 * * * *' })]);
    h.trx.get.mockRejectedValue(new Error('database unavailable'));

    await tick();
    await tick();
    await tick();

    const update = h.dbRun.mock.calls.find(([, params]) => params[2] === 'run failed: database unavailable');
    expect(update[1][0]).toBe('pending');
    expect(update[1][1]).toBe('2026-11-07T12:15:00.000Z');
    expect(update[1][2]).toBe('run failed: database unavailable');
  });
});

describe('ScheduledMessageWorker agent-reply guarantee', () => {
  function primeReplyLookup({ processing = false, reply = null } = {}) {
    h.dbGet.mockImplementation(async (sql) => {
      if (sql.includes('SELECT id FROM messages')) return reply;
      if (sql.includes('is_processing, processing_agent_id')) {
        return { is_processing: processing, processing_agent_id: processing ? 77 : null };
      }
      if (sql.includes('space_id')) return { space_id: 11 };
      return null;
    });
  }

  it('clears the check when the expected agent has replied', async () => {
    const row = makeRow({ status: 'sent', sent_message_id: 100, expect_reply_from: 77, reply_check_at: '2026-11-07T11:50:00Z' });
    queueTick([], [row]);
    primeReplyLookup({ reply: { id: 101 } });

    await tick();

    expect(h.trx.run).not.toHaveBeenCalled();
    expect(h.dbRun.mock.calls.some(([sql]) => sql.includes('reply_check_at = NULL, reply_retries = 0'))).toBe(true);
  });

  it('extends the check once while the expected agent is processing', async () => {
    const row = makeRow({ status: 'sent', sent_message_id: 100, expect_reply_from: 77, reply_check_at: '2026-11-07T11:50:00Z' });
    queueTick([], [row]);
    primeReplyLookup({ processing: true });

    await tick();

    expect(h.trx.run).not.toHaveBeenCalled();
    const update = h.dbRun.mock.calls.find(([sql]) => sql.includes('reply_check_at = NOW() +'));
    expect(update[1][0]).toBe(5);
    expect(JSON.parse(update[1][1])).toMatchObject({ reply_wait_extended: true });
  });

  it('sends exactly one retry and then stops checking', async () => {
    let current = makeRow({
      status: 'sent', sent_message_id: 100, expect_reply_from: 77,
      reply_check_at: '2026-11-07T11:50:00Z', content: '<<@architect>> summary',
    });
    queueTick([], [current]);
    queueTick([], [{ ...current, sent_message_id: 101, reply_retries: 1 }]);
    primeReplyLookup();
    h.trx.get.mockImplementation(async () => current);
    h.trx.run.mockImplementation(async (sql) => ({
      changes: 1,
      lastInsertRowid: sql.includes('INSERT INTO messages') ? 101 : 0,
    }));

    await tick();
    current = { ...current, sent_message_id: 101, reply_retries: 1 };
    await tick();

    const inserts = h.trx.run.mock.calls.filter(([sql]) => sql.includes('INSERT INTO messages'));
    expect(inserts).toHaveLength(1);
    expect(JSON.parse(inserts[0][1][9])).toMatchObject({ scheduled_message_id: 1, retry_of: 100 });
    expect(h.dbRun.mock.calls.some(([sql]) => sql.includes('reply_retries = reply_retries + 1'))).toBe(true);
    expect(h.dbRun.mock.calls.some(([sql]) => sql.includes("error_message = 'no agent reply after retry'"))).toBe(true);
  });
});
