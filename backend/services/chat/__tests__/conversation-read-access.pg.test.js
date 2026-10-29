// @vitest-environment node
import { beforeAll, beforeEach, afterAll, expect, it } from 'vitest';
import { dbGet, dbRun, destroyAdapter } from '../../../database/connection.js';
import { createEphemeralWorkspace } from '../../../tests/helpers/workspace-fixture.js';
import { canReadConversation } from '../conversation-read-access.js';

let ws, reader, rowId, conversationId;
beforeAll(async () => {
  expect((await dbGet('SELECT current_database() AS db')).db).toBe('godcrm_test');
  ws = await createEphemeralWorkspace({ label: 'chat-read-acl' });
  reader = await createEphemeralWorkspace({ label: 'chat-reader', dashboard: false, table: false });
  rowId = (await dbRun('INSERT INTO table_rows (table_id, base_id, data) VALUES (?, ?, ?)', [ws.tableId, `test-acl-${ws.token}`, '{}'])).lastInsertRowid;
  conversationId = (await dbRun(
    'INSERT INTO conversations (title, type, space_id, created_by, bound_table_id, bound_row_id) VALUES (?, ?, ?, ?, ?, ?)',
    ['ACL fixture', 'chat', ws.spaceId, ws.userId, ws.tableId, rowId]
  )).lastInsertRowid;
});
beforeEach(async () => {
  await dbRun('DELETE FROM conversation_participants WHERE conversation_id = ?', [conversationId]);
  await dbRun('DELETE FROM user_access_permissions WHERE user_id = ?', [reader.userId]);
  await dbRun('UPDATE conversations SET space_id = ?, bound_row_id = ? WHERE id = ?', [ws.spaceId, rowId, conversationId]);
});
afterAll(async () => {
  if (conversationId) {
    await dbRun('DELETE FROM conversation_participants WHERE conversation_id = ?', [conversationId]);
    await dbRun('DELETE FROM conversations WHERE id = ?', [conversationId]);
  }
  if (reader) await dbRun('DELETE FROM user_access_permissions WHERE user_id = ?', [reader.userId]);
  await reader?.cleanup();
  await ws?.cleanup();
  await destroyAdapter();
});

it.each(['editor', 'admin', 'owner', 'viewer', 'denied'])('real SQL resolves row role %s without enrolling the caller', async role => {
  await dbRun('INSERT INTO user_access_permissions (user_id, table_id, access_level) VALUES (?, ?, ?)', [reader.userId, ws.tableId, role]);
  expect(await canReadConversation({ id: reader.userId }, conversationId)).toBe(['editor', 'admin', 'owner'].includes(role));
  expect(await dbGet('SELECT user_id FROM conversation_participants WHERE conversation_id = ?', [conversationId])).toBeNull();
});
it('permits a participant without any row grant', async () => {
  await dbRun('INSERT INTO conversation_participants (conversation_id, user_id, role) VALUES (?, ?, ?)', [conversationId, reader.userId, 'member']);
  expect(await canReadConversation({ id: reader.userId }, conversationId)).toBe(true);
});
it('does not grant access from ownership of another space', async () => {
  expect(await canReadConversation({ id: reader.userId, role: 'admin' }, conversationId)).toBe(false);
  await dbRun('UPDATE conversations SET space_id = ? WHERE id = ?', [reader.spaceId, conversationId]);
  expect(await canReadConversation({ id: reader.userId }, conversationId)).toBe(false);
});
it('requires an existing bound row even for the space owner', async () => {
  expect(await canReadConversation({ id: ws.userId }, conversationId)).toBe(true);
  await dbRun('UPDATE conversations SET bound_row_id = NULL WHERE id = ?', [conversationId]);
  expect(await canReadConversation({ id: ws.userId }, conversationId)).toBe(false);
});
