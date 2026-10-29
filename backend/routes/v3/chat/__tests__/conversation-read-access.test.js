import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Router } from 'express';

const state = vi.hoisted(() => ({ participant: false, role: 'editor', row: true, space: 11, deleted: false }));
const db = vi.hoisted(() => ({ get: vi.fn(), all: vi.fn(), run: vi.fn() }));
vi.mock('../../../../database/connection.js', () => ({
  dbGet: db.get, dbAll: db.all, dbRun: db.run, isPostgres: () => true,
  safeJsonParse: (v, fallback = null) => typeof v === 'string' ? JSON.parse(v) : v ?? fallback,
}));
vi.mock('../chatShared.js', async () => ({
  ...await import('../../../../database/connection.js'),
  ...await import('../../../../utils/response.js'),
  apiLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  requireAuth: (_req, _res, next) => next(),
}));
vi.mock('../chatAgentHelpers.js', () => ({
  resolveAgentInfoForMessages: async rows => rows, enrichSubAgents: async () => [],
  resolveAgentUser: vi.fn(), validateSubAgentRowIds: vi.fn(), autoJoinAgentToConversation: vi.fn(),
  resolveMentionedUser: vi.fn(), findAiAgentByCommand: vi.fn(),
}));
vi.mock('../chatAgentExecution.js', () => ({ executeAgentResponse: vi.fn() }));
vi.mock('../chatAgentAutoRespond.js', () => ({ getAutoRespondAgents: vi.fn(), shouldAutoRespondWithAI: vi.fn(), getDefaultAgentForConversation: vi.fn() }));
vi.mock('../../../../services/messageMoveService.js', () => ({ moveMessages: vi.fn(), MoveValidationError: Error, MoveAuthError: Error }));
vi.mock('../../../../services/criterionTicketSpawnService.js', () => ({ spawnTicketFromCriterion: vi.fn(), SpawnValidationError: Error }));
vi.mock('../../../../services/inflight/queryActive.js', () => ({ queryActiveInflight: async () => [] }));
vi.mock('../../../../services/translate/translateMessage.js', () => ({ translateMessageText: vi.fn(), isSupportedTargetLang: vi.fn() }));
vi.mock('../../ai-agents/shared.js', () => ({ safeParseJSON: (v, fallback) => v ? JSON.parse(v) : fallback }));

const { default: ai } = await import('../../ai-agents/conversationsController.js');
const { default: registerCrud } = await import('../conversationCrudController.js');
const { default: registerSummary } = await import('../conversationSummaryController.js');
const { default: registerMessages } = await import('../messageController.js');
const chat = Router();
registerCrud(chat); registerSummary(chat); registerMessages(chat);

const paths = [
  [ai, '/conversations/:conversationId'], [chat, '/conversations/:id'],
  [chat, '/conversations/:id/summary'], [chat, '/conversations/:id/messages'],
  [chat, '/conversations/:id/messages/by-ids'], [chat, '/messages/:messageId/full'],
];
async function read(router, path, user = { id: 7, userId: 7 }) {
  const handler = router.stack.find(layer => layer.route?.path === path && layer.route.methods.get).route.stack.at(-1).handle;
  const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  await handler({ user, params: { id: '50', conversationId: '50', messageId: '99' }, query: { ids: '99' } }, res);
  return res;
}

beforeEach(() => {
  Object.assign(state, { participant: false, role: 'editor', row: true, space: 11, deleted: false, bound: true, owner: 1, projectRole: null, access: null, permissionsError: false, historical: false, projectType: 'normal' });
  vi.clearAllMocks();
  db.get.mockImplementation(async (sql, params) => {
    if (sql.includes('conversation_participants') && sql.includes('user_id =')) return state.participant ? { user_id: 7 } : null;
    if (sql.includes('FROM conversations')) return { id: 50, title: 'Private title', space_id: 11, bound_table_id: state.bound ? 1708 : null, bound_row_id: state.bound ? 90 : null, settings: { deleted: state.deleted, historical_import: state.historical ? { key: 'import' } : null } };
    if (sql.includes('FROM table_rows') && sql.includes('JOIN universal_tables')) {
      expect(params).toEqual([1708, 90]);
      return state.row ? { project_id: 3, space_id: state.space, owner_id: state.owner, access_control: state.access, project_type: state.projectType } : null;
    }
    if (sql.includes('FROM user_access_permissions')) {
      if (state.permissionsError) throw new Error('permission lookup failed');
      const role = sql.includes('table_id =') ? state.role : sql.includes('project_id =') ? state.projectRole : null;
      return role ? { access_level: role } : null;
    }
    if (sql.includes('FROM spaces')) return { owner_id: state.owner, access_control: state.access, visibility: 'internal' };
    if (sql.includes('FROM projects')) return { space_id: state.space, owner_id: 1 };
    if (sql.includes('FROM universal_tables')) return { project_id: 3 };
    if (sql.includes('FROM users')) return { id: 7, email: 'reader@example.test' };
    if (sql.includes('FROM messages') && sql.includes('WHERE id =')) return { id: 99, conversation_id: 50, content: 'Private body', content_type: 'text' };
    return null;
  });
  db.all.mockImplementation(async sql => {
    if (sql.includes('FROM table_columns')) return state.access?.columns ?? [];
    if (sql.includes('FROM table_rows WHERE table_id')) return state.access ? [{ data: { system_user_id: 7, role: 'editor', ...state.access.userData } }] : [];
    return [];
  });
});

describe.each(paths.map(([router, path]) => ({ router, path, api: router === ai ? 'ai' : 'chat' })))('$api $path', ({ router, path }) => {
  it('permits a participant even without a bound row', async () => {
    state.participant = true; state.bound = false;
    expect((await read(router, path)).statusCode).toBe(200);
    expect(db.run).not.toHaveBeenCalled();
  });
  it.each(['editor', 'admin', 'owner'])('permits a linked-row %s without enrolling them', async role => {
    state.role = role;
    expect((await read(router, path)).statusCode).toBe(200);
    expect(db.run).not.toHaveBeenCalled();
  });
  it.each(['viewer', 'denied', null])('denies a nonparticipant with role %s without leaking content', async role => {
    state.role = role;
    const res = await read(router, path);
    expect([403, 404]).toContain(res.statusCode);
    expect(JSON.stringify(res.body)).not.toMatch(/Private title|Private body/);
    expect(db.all).not.toHaveBeenCalled();
  });
  it.each(['unbound', 'missing row', 'wrong space', 'explicit project deny'])('denies %s', async reason => {
    if (reason === 'unbound') state.bound = false;
    if (reason === 'missing row') state.row = false;
    if (reason === 'wrong space') state.space = 12;
    if (reason === 'explicit project deny') state.projectRole = 'denied';
    expect([403, 404]).toContain((await read(router, path)).statusCode);
  });
  it('does not grant a global admin unrelated row access', async () => {
    state.role = null;
    expect([403, 404]).toContain((await read(router, path, { id: 7, userId: 7, role: 'admin' })).statusCode);
  });
  it('honors a project-scoped credential restriction', async () => {
    expect([403, 404]).toContain((await read(router, path, { id: 7, userId: 7, projectId: 4 })).statusCode);
  });
  it('fails closed when permission lookup fails', async () => {
    state.permissionsError = true;
    expect((await read(router, path)).statusCode).toBe(500);
  });
  it('permits a space owner without an explicit grant', async () => {
    state.role = null; state.owner = 7;
    expect((await read(router, path)).statusCode).toBe(200);
  });
  it('permits an inherited project editor', async () => {
    state.role = null; state.projectRole = 'editor';
    expect((await read(router, path)).statusCode).toBe(200);
  });
  it('permits the configured users-table editor', async () => {
    state.role = null;
    state.access = { enabled: true, users_table_id: 1783, role_mappings: [{ columnValue: 'editor', accessLevel: 'editor' }] };
    expect((await read(router, path)).statusCode).toBe(200);
  });
  it.each(['active', 'denied_tables', 'denied_projects', 'denied_spaces', 'allowed_tables'])('honors granular %s restrictions', async field => {
    const values = { active: false, denied_tables: ['1708'], denied_projects: ['3'], denied_spaces: ['11'], allowed_tables: ['999'] };
    state.access = { enabled: true, users_table_id: 1783, role_mappings: [{ columnValue: 'editor', accessLevel: 'editor' }], userData: { [field]: values[field] } };
    expect([403, 404]).toContain((await read(router, path)).statusCode);
  });
  it('preserves historical import participant-only access', async () => {
    state.historical = true;
    expect([403, 404]).toContain((await read(router, path)).statusCode);
  });
  it.each(['column IDs', 'email', 'numeric IDs'])('honors table denial for users-table %s', async representation => {
    state.role = null;
    state.access = { enabled: true, users_table_id: 1783, role_mappings: [{ columnValue: 'editor', accessLevel: 'editor' }], userData: { denied_tables: ['1708'] } };
    if (representation === 'column IDs') {
      state.access.columns = [{ id: 101, column_name: 'system_user_id' }, { id: 102, column_name: 'role' }, { id: 103, column_name: 'denied_tables' }];
      state.access.userData = { system_user_id: undefined, role: undefined, 101: 7, 102: 'editor', 103: ['1708'] };
    }
    if (representation === 'email') state.access.userData = { system_user_id: undefined, email: 'reader@example.test', denied_tables: ['1708'] };
    if (representation === 'numeric IDs') state.access.userData.denied_tables = [1708];
    expect([403, 404]).toContain((await read(router, path)).statusCode);
  });
  it('applies system-data editor downgrade', async () => {
    state.projectType = 'system_data';
    expect([403, 404]).toContain((await read(router, path)).statusCode);
  });
});

it('does not disclose the title of a deleted conversation to a viewer', async () => {
  state.deleted = true; state.role = 'viewer';
  const res = await read(chat, '/conversations/:id/summary');
  expect(res.statusCode).toBe(403);
  expect(JSON.stringify(res.body)).not.toContain('Private title');
});

// A forward is a copy owned by the destination chat. Its source reference is
// navigation metadata, not an additional permission requirement for the copy.
describe.each(paths.filter(([, path]) => !path.endsWith('/summary'))
  .map(([router, path]) => ({ router, path, api: router === ai ? 'ai' : 'chat' })))
('$api $path — forwarded copy versus original', ({ router, path }) => {
  it.each(['viewer', 'denied', 'unbound', 'editor', 'participant'])
  ('keeps the destination copy readable with source access: %s', async sourceAccess => {
    state.role = sourceAccess === 'editor' ? 'editor' : 'viewer';
    if (sourceAccess === 'denied') state.role = 'denied';
    if (sourceAccess === 'unbound') state.bound = false;
    if (sourceAccess === 'participant') state.participant = true;
    const content = '> **Original author**\n> Forwarded body\n> _чат #50, сообщение #99_';
    const copy = { id: 100, conversation_id: 60, content, content_type: 'text', attachments: [], metadata: {} };
    const originalGet = db.get.getMockImplementation();
    const originalAll = db.all.getMockImplementation();
    db.get.mockImplementation(async (sql, params) => {
      if (sql.includes('FROM messages') && sql.includes('WHERE id =') && Number(params[0]) === 100) return copy;
      if (Number(params?.[0]) === 60) {
        if (sql.includes('conversation_participants') && sql.includes('user_id =')) return { user_id: 7 };
        if (sql.includes('FROM conversations')) return { id: 60, title: 'Destination', space_id: 11, settings: {} };
      }
      return originalGet(sql, params);
    });
    db.all.mockImplementation(async (sql, params) => {
      if (sql.includes('FROM messages') && Number(params?.[0]) === 60) return [{ ...copy }];
      return originalAll(sql, params);
    });
    const handler = router.stack.find(layer => layer.route?.path === path && layer.route.methods.get).route.stack.at(-1).handle;
    const destination = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
    await handler({ user: { id: 7, userId: 7 }, params: { id: '60', conversationId: '60', messageId: '100' }, query: { ids: '100' } }, destination);
    expect(destination.statusCode).toBe(200);
    const returnedCopy = path.endsWith('/full') ? destination.body.data : destination.body.data.messages[0];
    expect(returnedCopy).toMatchObject({ id: 100, content });
    // Rendering the copied text must not even query membership of the source.
    expect(db.get.mock.calls.filter(([sql]) => sql.includes('conversation_participants') && sql.includes('user_id ='))
      .map(([, params]) => Number(params[0]))).toEqual([60]);

    const source = await read(router, path);
    if (sourceAccess === 'editor' || sourceAccess === 'participant') {
      expect(source.statusCode).toBe(200);
    } else {
      expect([403, 404]).toContain(source.statusCode);
      expect(JSON.stringify(source.body)).not.toMatch(/Private title|Private body/);
    }
    // The same reader can still reopen the copy after attempting navigation.
    await handler({ user: { id: 7, userId: 7 }, params: { id: '60', conversationId: '60', messageId: '100' }, query: { ids: '100' } }, destination);
    expect(destination.statusCode).toBe(200);
    expect(JSON.stringify(destination.body)).toContain('Forwarded body');
    expect(db.run).not.toHaveBeenCalled();
  });
});
