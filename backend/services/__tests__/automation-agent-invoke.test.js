// @vitest-environment node
/**
 * agent_invoke action — the bridge from "a row changed" to "an agent looks at it".
 *
 * Guards the three things that are cheap to get wrong and expensive to notice
 * in production, because a broken one costs a silent agent run:
 *   1. token resolution over Cyrillic column keys (`\w+` never matches them,
 *      so the token would reach the agent verbatim);
 *   2. `{{added_files:…}}` handing a CLI agent an absolute path — a CLI agent
 *      has no vision channel for the stored `/uploads/…` URL and cannot open it;
 *   3. `require_added` bailing before an agent is spent on an empty change.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

process.env.UPLOAD_PATH = '/var/lib/business-crm-data/uploads';

const dispatchInvocationsFromContent = vi.fn();

vi.mock('../chat/invocation-dispatcher.js', () => ({
  dispatchInvocationsFromContent: (...a) => dispatchInvocationsFromContent(...a),
}));

// Trim incidental imports so the module loads in isolation.
vi.mock('../../database/connection.js', () => ({ dbGet: vi.fn(), dbRun: vi.fn(), dbAll: vi.fn() }));
vi.mock('../../utils/logger.js', () => ({ apiLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('../SkillEnrichmentService.js', () => ({ enrichSkill: vi.fn() }));
vi.mock('../TelegramService.js', () => ({ sendMessage: vi.fn(), sendAdminAlert: vi.fn() }));
vi.mock('../schedule-trigger/pipeline-executors.js', () => ({ executeTicketRouting: vi.fn() }));

const { executeAgentInvoke } = await import('../AutomationTriggerService.js');

const CONFIG = {
  agent_slug: 'developer-ralph',
  conversation_id: 3646,
  require_added: 'фото',
  prompt: 'Строка {{row_id}} таблицы {{table_id}}: {{вид_(латынь)}}. Файлы:\n{{added_files:фото}}',
};

const OLD_ROW = { 'фото': '/uploads/spaces/3/old.jpeg', 'вид_(латынь)': 'Acer' };
const NEW_ROW = {
  'фото': '/uploads/spaces/3/old.jpeg, /uploads/spaces/3/new.jpeg',
  'вид_(латынь)': 'Acer platanoides',
};

beforeEach(() => {
  dispatchInvocationsFromContent.mockReset();
  dispatchInvocationsFromContent.mockResolvedValue({ triggered: 1, skipped: 0 });
});

describe('executeAgentInvoke', () => {
  it('resolves Cyrillic tokens and hands only the newly added file to the agent as a disk path', async () => {
    const res = await executeAgentInvoke(1708, 141024, NEW_ROW, CONFIG, OLD_ROW);

    expect(res.success).toBe(true);
    expect(dispatchInvocationsFromContent).toHaveBeenCalledTimes(1);
    const call = dispatchInvocationsFromContent.mock.calls[0][0];
    expect(call.conversationId).toBe(3646);
    expect(call.sourceLabel).toBe('automation:1708:141024');
    expect(call.content).toBe(
      '<<@developer-ralph>> Строка 141024 таблицы 1708: Acer platanoides. Файлы:\n' +
      '/var/lib/business-crm-data/uploads/spaces/3/new.jpeg'
    );
    // the file that was already there must not be re-analysed
    expect(call.content).not.toContain('old.jpeg');
  });

  it('counts every item as added on row_create, where there is no previous row', async () => {
    await executeAgentInvoke(1708, 141024, NEW_ROW, CONFIG, undefined);

    const { content } = dispatchInvocationsFromContent.mock.calls[0][0];
    expect(content).toContain('/var/lib/business-crm-data/uploads/spaces/3/old.jpeg');
    expect(content).toContain('/var/lib/business-crm-data/uploads/spaces/3/new.jpeg');
  });

  it('skips without spending an agent run when require_added gained nothing', async () => {
    const res = await executeAgentInvoke(1708, 141024, { ...OLD_ROW, 'вид_(латынь)': 'Acer x' }, CONFIG, OLD_ROW);

    expect(res).toMatchObject({ success: true, skipped: true });
    expect(dispatchInvocationsFromContent).not.toHaveBeenCalled();
  });

  it('reports failure instead of silence when the dispatcher triggers nobody', async () => {
    dispatchInvocationsFromContent.mockResolvedValue({ triggered: 0, skipped: 1 });

    const res = await executeAgentInvoke(1708, 141024, NEW_ROW, CONFIG, OLD_ROW);

    expect(res.success).toBe(false);
    expect(res.error).toContain('developer-ralph');
  });

  it('refuses a misconfigured action before touching the dispatcher', async () => {
    const noSlug = await executeAgentInvoke(1708, 1, NEW_ROW, { conversation_id: 3646 }, OLD_ROW);
    const noConv = await executeAgentInvoke(1708, 1, NEW_ROW, { agent_slug: 'x', conversation_id: 'later' }, OLD_ROW);

    expect(noSlug.success).toBe(false);
    expect(noConv.success).toBe(false);
    expect(dispatchInvocationsFromContent).not.toHaveBeenCalled();
  });
});
