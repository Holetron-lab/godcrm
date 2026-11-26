// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const executeAgentToolLoop = vi.hoisted(() => vi.fn());
const createAndDispatchJob = vi.hoisted(() => vi.fn());
const provider = vi.hoisted(() => ({ isCliAgent: true }));

vi.mock('../chatShared.js', () => ({
  dbRun: vi.fn(), dbGet: vi.fn(async () => ({ space_id: 11 })), dbAll: vi.fn(), isPostgres: () => true,
  safeJsonParse: (value, fallback = {}) => value || fallback,
  apiLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  sharedResolveAgentProvider: vi.fn(async () => ({ provider: 'openai', model: 'gpt-test' })),
  sharedBuildAgentSystemPrompt: vi.fn(async () => 'prompt'),
  fetchBoundRowContext: vi.fn(async () => null), fetchAgentSkills: vi.fn(async () => []),
  detectProvider: vi.fn(() => provider), loadConversationHistory: vi.fn(async () => []),
  executeAgentToolLoop, saveStepMessage: vi.fn(), resolveAllowedTools: vi.fn(async () => [{}]),
  createAgentStatusPlaceholder: vi.fn(async () => 10), updateAgentStatus: vi.fn(), finalizeAgentStatus: vi.fn(),
  findExistingAgentStatus: vi.fn(), resetAgentStatusForReuse: vi.fn(),
  logAgentMentioned: vi.fn(), logMessageSent: vi.fn(), logAgentError: vi.fn(), logTaskCompleted: vi.fn(),
  createAndDispatchJob, buildAIContext: vi.fn(), parseAutoSummarySettings: vi.fn(() => ({})),
  searchSimilarSummaries: vi.fn(), parseVectorSearchSettings: vi.fn(() => ({})), BASE_URL_FOR_ATTACHMENTS: '',
}));
vi.mock('../chatAgentHelpers.js', () => ({ resolveAgentSenderId: vi.fn(async () => 8) }));
vi.mock('../../../../services/agentTableResolver.js', () => ({ getAgentTableIds: vi.fn(async () => []) }));
vi.mock('../chatAgentDelegation.js', () => ({
  _triggerAutoSummary: vi.fn(), _handleDelegation: vi.fn(), _handleTicketStatusDirective: vi.fn(), callAgentAI: vi.fn(),
}));

const { executeAgentResponse, triggerAgentResponse } = await import('../chatAgentExecution.js');
const agent = { id: 8, name: 'Scheduler', managed_by_agent_row_id: 42, _agentConfig: { operator_id: 1 } };

beforeEach(() => {
  vi.clearAllMocks();
  provider.isCliAgent = true;
  createAndDispatchJob.mockResolvedValue({ id: 90, jobId: 'job-90' });
  executeAgentToolLoop.mockResolvedValue('done');
});

describe('ADR-208 D7 — triggering message context', () => {
  it('persists the triggering message id on the CLI agent-job path', async () => {
    await executeAgentResponse(42, agent, 7, { message_content: 'run', trigger_message_id: 123456 });
    expect(createAndDispatchJob).toHaveBeenCalledWith(expect.objectContaining({ triggerMessageId: 123456 }));
  });

  it('passes the triggering message id to the synchronous agent loop', async () => {
    provider.isCliAgent = false;
    await triggerAgentResponse(42, 'run', agent, 7, { statusMessageId: 10, trigger_message_id: 123456 });
    expect(executeAgentToolLoop).toHaveBeenCalledWith(expect.objectContaining({ triggerMessageId: 123456 }));
  });
});
