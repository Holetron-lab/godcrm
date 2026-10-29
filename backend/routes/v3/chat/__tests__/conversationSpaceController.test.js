// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

const mocks = vi.hoisted(() => ({ get: vi.fn(), run: vi.fn(), canAdminister: vi.fn(), transaction: vi.fn(), info: vi.fn() }));
vi.mock('../../../../database/connection.js', () => ({ withTransactionAsync: mocks.transaction }));
vi.mock('../../../../services/EffectiveRoleService.js', () => ({ canAdminister: mocks.canAdminister }));
vi.mock('../chatShared.js', () => ({
  requireAuth: (req, res, next) => {
    if (!req.headers['x-user']) return res.sendStatus(401);
    req.user = { id: Number(req.headers['x-user']), userId: Number(req.headers['x-user']) };
    next();
  },
  apiLogger: { info: mocks.info, error: vi.fn() },
  success: (res, data) => res.json({ success: true, data }),
  error: (res, code, message, status) => res.status(status).json({ error: code, message }),
}));
const { default: register } = await import('../conversationSpaceController.js');
const app = express();
app.use(express.json());
register(app);
const patch = (body = { space_id: 7819 }, user = '15', id = '3668') => request(app)
  .patch(`/conversations/${id}/space`).set('x-user', user).send(body);
let conversation;
beforeEach(() => {
  vi.resetAllMocks();
  conversation = { id: 3668, created_by: 15, type: 'chat', space_id: null, bound_table_id: null, bound_row_id: null, parent_conversation_id: null };
  mocks.transaction.mockImplementation(callback => callback({ get: mocks.get, run: mocks.run }));
  mocks.get.mockImplementation(async sql => {
    if (sql.includes('FOR UPDATE')) return conversation;
    if (sql.includes('FROM spaces')) return { id: 7819 };
    return null;
  });
  mocks.run.mockResolvedValue({ changes: 1 });
  mocks.canAdminister.mockResolvedValue(true);
});
describe('bind and change standalone conversation through PATCH /conversations/:id/space', () => {
  it('binds the existing row and leaves history and participants untouched', async () => {
    const result = await patch();
    expect(result.status).toBe(200);
    expect(result.body.data).toEqual({ id: 3668, space_id: 7819 });
    expect(mocks.canAdminister).toHaveBeenCalledWith(15, { spaceId: 7819 });
    expect(mocks.transaction).toHaveBeenCalledOnce();
    expect(mocks.get.mock.calls[0][0]).toContain('FOR UPDATE');
    expect(mocks.run).toHaveBeenCalledExactlyOnceWith(
      expect.stringMatching(/^UPDATE conversations SET space_id = \$1, updated_at = NOW\(\) WHERE id = \$2$/), [7819, 3668]);
  });
  it('changes A to B without writing files, history or participants and logs the previous space', async () => {
    conversation.space_id = 11;
    const result = await patch();
    expect(result.status).toBe(200);
    expect(result.body.data).toEqual({ id: 3668, space_id: 7819 });
    expect(mocks.run).toHaveBeenCalledExactlyOnceWith(
      'UPDATE conversations SET space_id = $1, updated_at = NOW() WHERE id = $2', [7819, 3668]);
    expect(mocks.info).toHaveBeenCalledWith(
      { conversationId: 3668, userId: 15, previousSpaceId: 11, spaceId: 7819 }, expect.any(String));
  });
  it('requires authentication', async () => {
    expect((await request(app).patch('/conversations/3668/space').send({ space_id: 7819 })).status).toBe(401);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it.each([{}, { space_id: null }, { space_id: '7819' }, { space_id: -1 }, { space_id: 1.5 }, { space_id: 7819, title: 'overwrite' }])('rejects invalid payload %j', async body => {
    expect((await patch(body)).status).toBe(400);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it.each(['abc', '0', '-1', '1.5'])('rejects invalid id %s', async id => {
    expect((await patch({ space_id: 7819 }, '15', id)).status).toBe(400);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it('rejects a missing conversation', async () => {
    conversation = null;
    expect((await patch()).status).toBe(404);
    expect(mocks.run).not.toHaveBeenCalled();
  });
  it('rejects a non-owner even with target space admin rights', async () => {
    expect((await patch({ space_id: 7819 }, '99')).status).toBe(403);
    expect(mocks.run).not.toHaveBeenCalled();
  });
  it('rejects missing target space', async () => {
    mocks.get.mockImplementation(async sql => sql.includes('FOR UPDATE') ? conversation : null);
    expect((await patch()).status).toBe(404);
    expect(mocks.run).not.toHaveBeenCalled();
  });
  it('rejects insufficient target space permissions', async () => {
    mocks.canAdminister.mockResolvedValue(false);
    expect((await patch()).status).toBe(403);
    expect(mocks.run).not.toHaveBeenCalled();
  });
  it.each([{ bound_table_id: 1708 }, { bound_row_id: 1 }, { parent_conversation_id: 1 }, { type: 'task' }])('rejects an incompatible conversation %j', async state => {
    Object.assign(conversation, state);
    expect((await patch()).status).toBe(409);
    expect(mocks.run).not.toHaveBeenCalled();
  });
  it.each([null, 11, 7819])('rejects a chat with children even when already scoped to %s', async spaceId => {
    conversation.space_id = spaceId;
    mocks.get.mockImplementation(async sql => sql.includes('FOR UPDATE') ? conversation : { id: 1 });
    expect((await patch()).status).toBe(409);
    expect(mocks.run).not.toHaveBeenCalled();
  });
  it('allows an authorized retry without writing again', async () => {
    conversation.space_id = 7819;
    expect((await patch()).status).toBe(200);
    expect(mocks.run).not.toHaveBeenCalled();
    expect(mocks.canAdminister).toHaveBeenCalled();
    expect(mocks.info).not.toHaveBeenCalled();
  });
  it('refuses to acknowledge a lost update', async () => {
    mocks.run.mockResolvedValue({ changes: 0 });
    expect((await patch()).status).toBe(500);
    expect(mocks.info).not.toHaveBeenCalled();
  });
  it('does not acknowledge success before transaction commit', async () => {
    mocks.transaction.mockImplementation(async callback => {
      await callback({ get: mocks.get, run: mocks.run });
      throw new Error('private database details');
    });
    const result = await patch();
    expect(result.status).toBe(500);
    expect(JSON.stringify(result.body)).not.toContain('private database details');
    expect(mocks.info).not.toHaveBeenCalled();
  });
});
