/**
 * AgentJobService — CLI provider dispatch (regression guard).
 *
 * processJobLocally() is fire-and-forget from createAndDispatchJob(), so a throw
 * inside it never reaches the HTTP caller: the request still answers "Async job
 * dispatched" and the failure only lands in the log. That is how a bare
 * `isClaudeCode` reference — left behind when the codex provider renamed the
 * detectProvider() destructure — took down EVERY CLI agent in production while
 * the chat UI showed nothing at all.
 *
 * These tests run a job all the way to the CLI executor and assert the job did
 * not fail, so any undefined identifier on that path fails the suite instead of
 * production.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  dbRun: vi.fn(),
  dbGet: vi.fn(),
  isPostgres: vi.fn(() => true),
  loggerError: vi.fn(),
  detectProvider: vi.fn(),
  resolveAgentProvider: vi.fn(),
  buildAgentSystemPrompt: vi.fn(() => 'system prompt'),
  executeClaudeCode: vi.fn(() => Promise.resolve({ content: 'done' })),
  executeCodexCli: vi.fn(() => Promise.resolve({ content: 'done' })),
  handleManagePlan: vi.fn(() => Promise.resolve('saved')),
  failJob: vi.fn(),
  getJob: vi.fn(() => ({ attempts: 3, max_attempts: 3 })),
}));

vi.mock('../../../database/connection.js', () => ({
  dbRun: h.dbRun,
  dbGet: h.dbGet,
  isPostgres: h.isPostgres,
  withTransactionAsync: fn => fn({ get: h.dbGet, run: h.dbRun }),
}));

vi.mock('../../../utils/logger.js', () => ({
  apiLogger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: h.loggerError },
}));

vi.mock('../../AgentLoopService.js', () => ({
  saveStepMessage: vi.fn(() => Promise.resolve(1)),
  updateAgentStatus: vi.fn(() => Promise.resolve()),
  finalizeAgentStatus: vi.fn(() => Promise.resolve()),
}));

vi.mock('../liveContextUsage.js', () => ({
  setContextUsage: vi.fn(),
  clearContextUsage: vi.fn(),
}));

vi.mock('../../chat/agent-execution-shared.js', () => ({
  resolveAgentProvider: h.resolveAgentProvider,
  detectProvider: h.detectProvider,
  buildAgentSystemPrompt: h.buildAgentSystemPrompt,
  loadConversationHistory: vi.fn(() => []),
  fetchBoundRowContext: vi.fn(() => null),
  fetchAgentSkills: vi.fn(() => []),
  setConversationProcessing: vi.fn(() => Promise.resolve()),
  handleManagePlan: h.handleManagePlan,
}));

vi.mock('../shared.js', async (importOriginal) => ({
  ...(await importOriginal()),
  updateJobStatus: vi.fn(() => Promise.resolve()),
  completeJob: vi.fn(() => Promise.resolve()),
  updateJobAttempts: vi.fn(() => Promise.resolve()),
  failJob: h.failJob,
}));

vi.mock('../../AgentActivityLogger.js', () => ({ logAgentActivity: vi.fn() }));
vi.mock('../lifecycle.js', () => ({ isShuttingDown: vi.fn(() => false) }));
vi.mock('../query.js', () => ({ getJob: h.getJob }));

vi.mock('../../labs/ai-execution-service.js', () => ({
  default: {
    executeClaudeCode: h.executeClaudeCode,
    executeCodexCli: h.executeCodexCli,
  },
}));

const { createAndDispatchJob } = await import('../create.js');

// The real detectProvider() contract — kept in one place so a mock can never
// drift into a shape the production callers no longer accept.
function flags(provider) {
  const isClaudeCode = provider === 'claude-code';
  const isCodex = provider === 'codex';
  return {
    isClaudeCode,
    isCopilot: provider === 'copilot',
    isCodex,
    isCliAgent: isClaudeCode || isCodex,
    isAnthropic: provider === 'anthropic',
  };
}

/** Poll until `cond()` is true, or give up — the worker chain awaits a dynamic import. */
async function until(cond, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (cond()) return true;
    await new Promise(r => setTimeout(r, 5));
  }
  return false;
}

/** Dispatch a job and wait for the fire-and-forget worker to settle. */
async function dispatch(provider, model) {
  h.resolveAgentProvider.mockResolvedValue({ apiKey: null, model, provider, isLocal: true });
  h.detectProvider.mockReturnValue(flags(provider));

  await createAndDispatchJob({
    conversationId: 42,
    agent: { id: 7, name: 'Agent Smith', managed_by_agent_row_id: 110507 },
    triggeredByUserId: 1,
    messageContent: 'do the thing',
  });

  // processJobLocally() is dispatched without await and awaits a dynamic import
  // of ai-execution-service before spawning — wait for it to reach the executor
  // (or for the failure path to log), not just for the microtask queue.
  await until(() =>
    h.executeClaudeCode.mock.calls.length > 0 ||
    h.executeCodexCli.mock.calls.length > 0 ||
    h.loggerError.mock.calls.length > 0
  );
  await new Promise(r => setTimeout(r, 10));
}

describe('createAndDispatchJob → processJobLocally: CLI provider dispatch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.isPostgres.mockReturnValue(true);
    h.dbRun.mockResolvedValue({ lastInsertRowid: 19099, changes: 1 });
    // job row lookup, then agent row, then conversation row
    h.dbGet.mockImplementation(async sql => sql.includes('status IN') ? null : { id: 19099, job_id: 'job-abc', space_id: 11, created_by: 1, data: '{}', status: 'processing', context: {} });
    h.buildAgentSystemPrompt.mockReturnValue('system prompt');
    h.getJob.mockReturnValue({ attempts: 3, max_attempts: 3 });
  });

  it('persists a 120-minute watchdog deadline for new CLI jobs', async () => {
    const started = Date.now();
    await dispatch('claude-code', 'claude-fable-5');
    const insert = h.dbRun.mock.calls.find(([sql]) => sql.includes('INSERT INTO agent_jobs'));
    const deadline = Date.parse(insert[1][9]);
    expect(deadline).toBeGreaterThanOrEqual(started + 120 * 60 * 1000);
    expect(deadline).toBeLessThanOrEqual(Date.now() + 120 * 60 * 1000);
  });

  it('runs a claude-code job through executeClaudeCode without failing', async () => {
    await dispatch('claude-code', 'claude-fable-5');

    expect(h.loggerError).not.toHaveBeenCalled();
    expect(h.failJob).not.toHaveBeenCalled();
    expect(h.executeClaudeCode).toHaveBeenCalledTimes(1);
    expect(h.executeCodexCli).not.toHaveBeenCalled();
  });

  it('runs a codex job through executeCodexCli without failing', async () => {
    await dispatch('codex', 'gpt-6-astra');

    expect(h.loggerError).not.toHaveBeenCalled();
    expect(h.executeCodexCli).toHaveBeenCalledTimes(1);
    expect(h.executeClaudeCode).not.toHaveBeenCalled();
  });

  it('names TodoWrite for claude-code and not for codex (ADR-113 planTool)', async () => {
    await dispatch('claude-code', 'claude-fable-5');
    expect(h.buildAgentSystemPrompt.mock.calls[0][1].isClaudeCode).toBe(true);

    vi.clearAllMocks();
    h.dbRun.mockResolvedValue({ lastInsertRowid: 19100, changes: 1 });
    h.dbGet.mockImplementation(async sql => sql.includes('status IN') ? null : { id: 19100, job_id: 'job-def', space_id: 11, created_by: 1, data: '{}', status: 'processing', context: {} });
    h.buildAgentSystemPrompt.mockReturnValue('system prompt');

    await dispatch('codex', 'gpt-6-astra');
    expect(h.buildAgentSystemPrompt.mock.calls[0][1].isClaudeCode).toBe(false);
  });

  it('rejects a non-CLI provider before spawning anything', async () => {
    await dispatch('anthropic', 'claude-sonnet-4');

    expect(h.executeClaudeCode).not.toHaveBeenCalled();
    expect(h.executeCodexCli).not.toHaveBeenCalled();
    expect(h.loggerError).toHaveBeenCalled();
  });
});

describe('plan runtime wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.dbRun.mockResolvedValue({lastInsertRowid:19099,changes:1});
    h.dbGet.mockImplementation(async sql => sql.includes('status IN') ? null : { id: 19099, job_id: 'job-abc', space_id: 11, created_by: 1, data: '{}', status: 'processing', context: {} });
  });
  it('passes the real job id to Codex and scopes prompt plan reads', async () => {
    await dispatch('codex', 'gpt-6-astra');
    expect(h.executeCodexCli.mock.lastCall[0].jobId).toBe(19099);
    expect(h.buildAgentSystemPrompt.mock.lastCall[1]).toMatchObject({planRunId:'job:19099',planAgentId:110507});
  });
  it('keeps TodoWrite working with agent row, sender user, and job scope', async () => {
    h.executeClaudeCode.mockImplementationOnce(async ({onEvent}) => {
      for (const status of ['in_progress','completed']) onEvent({type:'assistant',message:{content:[{
        type:'tool_use',name:'TodoWrite',input:{todos:[{content:'Implement',status}]},
      }]}});
      return {content:'done'};
    });
    await dispatch('claude-code','claude-fable-5');
    expect(h.handleManagePlan.mock.calls.slice(-2).map(c => c[0].tasks[0].status)).toEqual(['in_progress','completed']);
    expect(h.handleManagePlan.mock.lastCall.slice(1)).toEqual([42,'Agent Smith',{agentId:110507,senderId:7,jobId:19099,runId:'job:19099'}]);
  });
});

vi.mock('../../ChainHandoffService.js', () => ({
  default: { updateTicketStatus: vi.fn(async () => {}) },
}));
vi.mock('../../chat/invocation-dispatcher.js', () => ({
  hasInvocationTokens: vi.fn(() => true),
  dispatchInvocationsFromContent: vi.fn(async () => {}),
}));

// Exercise the real delayed retry while keeping CLI, database and dispatch hermetic.
describe('retry visibility and execution context', () => {
  it.each(['claude-code', 'codex'])('restores the same card and processing state after %s capacity failure', async (provider) => {
    vi.clearAllMocks();
    const { updateAgentStatus, finalizeAgentStatus, saveStepMessage } = await import('../../AgentLoopService.js');
    const { setConversationProcessing } = await import('../../chat/agent-execution-shared.js');
    const { default: tickets } = await import('../../ChainHandoffService.js');
    const { dispatchInvocationsFromContent } = await import('../../chat/invocation-dispatcher.js');
    const { TICKET_STATE } = await import('../shared.js');
    // Completion now runs inside finishOrContinueJob's row-locked transaction.
    const completedRuns = () => h.dbRun.mock.calls.filter(([sql]) => sql.includes("status = 'completed'")).length;
    h.dbRun.mockResolvedValue({ lastInsertRowid: 19099, changes: 1 });
    h.dbGet.mockImplementation(async sql => {
      if (sql.includes('status IN')) return null;
      if (sql.includes('SELECT status, context')) return { status: 'processing', context: {} };
      return { id: 19099, job_id: 'job-abc', space_id: 11, created_by: 99, data: '{}' };
    });
    h.resolveAgentProvider.mockResolvedValue({ provider, model: 'test-model' });
    h.detectProvider.mockReturnValue(flags(provider));
    h.getJob.mockReturnValue({ attempts: 1, max_attempts: 3 });

    let retry;
    let finish;
    const realSetTimeout = globalThis.setTimeout;
    const timer = vi.spyOn(globalThis, 'setTimeout').mockImplementation((callback, delay, ...args) => {
      if (delay === 5000) { retry = callback; return 0; }
      return realSetTimeout(callback, delay, ...args);
    });
    const executor = provider === 'codex' ? h.executeCodexCli : h.executeClaudeCode;
    executor.mockRejectedValueOnce(new Error('model overloaded')).mockImplementationOnce(({ onEvent }) => {
      onEvent({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read', input: {} }] } });
      return new Promise(resolve => { finish = resolve; });
    });
    try {
      await createAndDispatchJob({
        conversationId: 42,
        agent: { id: 7, name: 'Agent Smith', managed_by_agent_row_id: 110507 },
        triggeredByUserId: 123,
        messageContent: 'do the thing',
        ticketId: 456,
        statusMessageId: 789,
      });
      expect(await until(() => !!retry)).toBe(true);
      expect(updateAgentStatus).toHaveBeenCalledWith(789, 'error', expect.stringContaining('model overloaded'));
      expect(setConversationProcessing).toHaveBeenLastCalledWith(42, false);
      expect(tickets.updateTicketStatus).toHaveBeenCalledWith(expect.objectContaining({ ticket_id: 456, new_state: TICKET_STATE.BACKLOG }));
      vi.mocked(updateAgentStatus).mockClear();
      retry();
      expect(await until(() => !!finish)).toBe(true);
      // All assertions run after completion too, avoiding a leaked worker on failure.
      const retryStatuses = vi.mocked(updateAgentStatus).mock.calls.slice();
      const processingDuringRetry = vi.mocked(setConversationProcessing).mock.lastCall;
      finish({ content: 'completed retry' });
      expect(await until(() => completedRuns() > 0 && vi.mocked(setConversationProcessing).mock.lastCall[1] === false)).toBe(true);
      expect(await until(() => vi.mocked(dispatchInvocationsFromContent).mock.calls.length > 0)).toBe(true);
      expect.soft(retryStatuses).toContainEqual([789, 'thinking', 'Loading agent config...', { job_db_id: 19099 }]);
      expect.soft(retryStatuses).toContainEqual([789, 'tool_call', 'Using Read...', { tools_used: 1, tools_completed: 0 }]);
      expect.soft(processingDuringRetry).toEqual([42, true, 'Agent Smith', 110507]);
      expect.soft(finalizeAgentStatus).toHaveBeenCalledWith(789, null);
      expect.soft(tickets.updateTicketStatus).toHaveBeenLastCalledWith(expect.objectContaining({ ticket_id: 456, new_state: TICKET_STATE.REVIEW }));
      expect.soft(dispatchInvocationsFromContent).toHaveBeenCalledWith(expect.objectContaining({ userId: 123, conversationId: 42 }));
      expect(saveStepMessage).toHaveBeenCalledWith(42, expect.objectContaining({ contentType: 'tool_call', metadata: expect.stringContaining('19099') }));
      expect(completedRuns()).toBe(1);
      expect(h.failJob).toHaveBeenCalledTimes(1);
      expect(executor).toHaveBeenCalledTimes(2);
    } finally {
      finish?.({ content: 'completed retry' });
      timer.mockRestore();
    }
  });
});

it('does not spawn another CLI for an already processing agent in the same chat', async () => {
  h.dbGet.mockImplementation(async sql => sql.includes("status IN")
    ? { id: 99, job_id: 'active-job', status: 'processing' }
    : { id: 42, job_id: 'new-job', space_id: 11, created_by: 1 });
  const createStatusPlaceholder = vi.fn();
  const result = await createAndDispatchJob({ conversationId: 42, createStatusPlaceholder,
    agent: { id: 7, managed_by_agent_row_id: 110507 }, triggeredByUserId: 1,
    messageContent: 'follow up' });
  expect(result).toMatchObject({ skipped: true, id: 99 });
  expect(createStatusPlaceholder).not.toHaveBeenCalled();
});


it('continues an undelivered follow-up sequentially under the same job id', async () => {
  vi.clearAllMocks();
  h.dbRun.mockResolvedValue({ lastInsertRowid: 19099, changes: 1 });
  let finishes = 0;
  h.dbGet.mockImplementation(async sql => {
    if (sql.includes('status IN')) return null;
    if (sql.includes('SELECT status, context')) return { status: 'processing', context: ++finishes === 1
      ? { pending_invocations: [{ content: 'new instruction', attachments: [{ url: '/uploads/voice.webm' }] }] } : {} };
    return { id: 19099, job_id: 'job-abc', space_id: 11, created_by: 1, data: '{}' };
  });
  h.executeCodexCli.mockResolvedValue({ content: 'done' });
  await dispatch('codex', 'gpt-6-astra');
  await until(() => h.executeCodexCli.mock.calls.length === 2);
  expect(h.executeCodexCli.mock.calls.map(([params]) => params.jobId)).toEqual([19099, 19099]);
  expect(h.executeCodexCli.mock.calls[1][0].messages.at(-1).content).toContain('new instruction');
  expect(h.executeCodexCli.mock.calls[1][0].messages.at(-1).content).toContain('voice.webm');
  expect(h.dbRun.mock.calls.filter(([sql]) => sql.includes('INSERT INTO agent_jobs'))).toHaveLength(1);
  await until(() => finishes === 2);
});
