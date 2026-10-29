import { beforeEach, describe, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ get: vi.fn(), run: vi.fn() }));
vi.mock('../../../database/connection.js', () => ({
  withTransactionAsync: fn => fn(h),
}));
const { reserveAgentJob, takeJobMessages, finishOrContinueJob } = await import('../single-active.js');
const input = { conversationId: 42, agentRowId: 21, agentUserId: 7,
  message: { content: 'new instruction', attachments: [{ url: '/uploads/a.png' }], userId: 1 } };
beforeEach(() => { vi.resetAllMocks(); h.run.mockResolvedValue({ changes: 1 }); });
describe('one active CLI job per conversation and agent', () => {
  it.each(['pending', 'processing'])('queues to the %s job without creating another', async status => {
    h.get.mockResolvedValueOnce({ id: 42 }).mockResolvedValueOnce({ id: 99, job_id: 'existing', status });
    const create = vi.fn();
    expect(await reserveAgentJob(input, create)).toEqual({ id: 99, jobId: 'existing', skipped: true, reason: 'active_job' });
    expect(create).not.toHaveBeenCalled();
    expect(h.run.mock.calls[0][1]).toEqual([JSON.stringify([input.message]), 99]);
    expect(h.get.mock.calls[1][1]).toEqual([42, 21, 7]);
  });
  it('creates under the transaction when the pair has no active job', async () => {
    h.get.mockResolvedValueOnce({ id: 42 }).mockResolvedValueOnce(null);
    const create = vi.fn(async tx => { expect(tx).toBe(h); return { id: 100 }; });
    expect(await reserveAgentJob(input, create)).toEqual({ id: 100 });
  });
  it('fails closed when agent identity is missing', async () => {
    await expect(reserveAgentJob({ ...input, agentRowId: null, agentUserId: null }, vi.fn())).rejects.toThrow('identity');
  });
  it('delivers queued text and attachments only to the bound job', async () => {
    h.get.mockResolvedValue({ context: { pending_invocations: [input.message] }, status: 'processing' });
    expect(await takeJobMessages(99)).toEqual([input.message]);
    expect(h.get.mock.calls[0][1]).toEqual([99]);
    expect(h.run.mock.calls[0][1]).toEqual([99]);
  });
  it('does not touch jobs without a runtime job id', async () => {
    expect(await takeJobMessages(null)).toEqual([]);
    expect(h.get).not.toHaveBeenCalled();
  });
  it('continues the same job if messages arrived before completion', async () => {
    h.get.mockResolvedValue({ status: 'processing', context: { pending_invocations: [input.message] } });
    expect(await finishOrContinueJob(99, 'done', {})).toEqual([input.message]);
    expect(h.run.mock.calls.some(([sql]) => sql.includes("status = 'completed'"))).toBe(false);
  });
  it('completes under the same row lock when the inbox is empty', async () => {
    h.get.mockResolvedValue({ status: 'processing', context: {} });
    expect(await finishOrContinueJob(99, 'done', { tokens: 1 })).toEqual([]);
    expect(h.run.mock.calls[0][1]).toEqual(['done', '{"tokens":1}', 99]);
  });
  it('does not revive cancelled jobs or deliver their mailbox', async () => {
    h.get.mockResolvedValue({ status: 'cancelled', context: { pending_invocations: [input.message] } });
    expect(await takeJobMessages(99)).toEqual([]);
    expect(await finishOrContinueJob(99, 'done', {})).toEqual([]);
    expect(h.run).not.toHaveBeenCalled();
  });
});

it('does not replay the original prompt when recovery encounters an already active job', async () => {
  h.get.mockResolvedValueOnce({ id: 42 }).mockResolvedValueOnce({ id: 99, job_id: 'existing' });
  const result = await reserveAgentJob({ ...input, message: null }, vi.fn());
  expect(result.skipped).toBe(true); expect(h.run).not.toHaveBeenCalled();
});
