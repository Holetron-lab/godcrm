// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { validateArchive, projectHistoricalMessage } from '../historical-import.js';

const source = () => ({
  source: { domain: 'crm.hltrn.cc', conversation_id: 3496, db_timezone: 'Europe/Moscow' },
  conversation: { id: 3496, title: 'Archive', created_at: '2026-10-01T12:00:00.123456' },
  authors: [{ id: 17, name: 'Joel', email: 'joel@example.org', email_verified: 1, user_type: 'human' }],
  messages: [{ id: 100, conversation_id: 3496, sender_id: 17, sender_type: 'human', role: 'user', content_type: 'text', content: 'hello', created_at: '2026-10-01T12:00:00.123456', updated_at: null, parent_id: null, attachments: '[]' }],
});

describe('historical import projection', () => {
  it('keeps exact timestamps and original records, but makes old invocations and local row ids inert', () => {
    const archive = source();
    archive.messages[0].content = '<<@some-agent>> [[row:1708/12]] /uploads/a.mp4';
    const plan = validateArchive(archive);
    const m = projectHistoricalMessage(plan.messages[0], plan.authors, new Map([['/uploads/a.mp4', '/uploads/historical-imports/new.mp4']]));
    expect(m.created_at).toBe('2026-10-01T12:00:00.123456');
    expect(m.metadata.historical_import.original).toEqual(archive.messages[0]);
    expect(m.content).not.toContain('<<@');
    expect(m.content).not.toContain('[[row:');
    expect(m.content).toContain('/uploads/historical-imports/new.mp4');
  });
  it('rejects duplicates, dangling parents, foreign conversations and unknown authors', () => {
    for (const mutate of [a => a.messages.push(a.messages[0]), a => a.messages[0].parent_id = 999, a => a.messages[0].conversation_id = 2068, a => a.messages[0].sender_id = 99]) {
      const archive = source(); mutate(archive);
      expect(() => validateArchive(archive)).toThrow();
    }
  });
  it('keeps unavailable uploads at the source and strips live widget/row attachments', () => {
    const archive = source();
    archive.messages[0].attachments = JSON.stringify([{type: 'row_reference', name: 'Ticket', rowReference: {table_id: 1708, row_id: 12}}, {type: 'video', url: '/uploads/missing.mp4', name: 'missing'}]);
    const m = projectHistoricalMessage(archive.messages[0], archive.authors, new Map());
    expect(m.attachments).toEqual([]);
    expect(m.content).toContain('Отсутствует');
    expect(m.content).toContain('https://crm.hltrn.cc/uploads/missing.mp4');
    expect(m.metadata.historical_import.original.attachments).toBe(archive.messages[0].attachments);
  });
  it('never rewrites a different host merely because its pathname matches a source upload', () => {
    const archive = source();
    archive.messages[0].content = 'https://external.example/uploads/a.mp4 https://crm.hltrn.cc/uploads/a.mp4';
    const m = projectHistoricalMessage(archive.messages[0],archive.authors,new Map([['/uploads/a.mp4','/uploads/historical-imports/a.mp4']]));
    expect(m.content).toContain('https://external.example/uploads/a.mp4');
    expect(m.content).toContain(' /uploads/historical-imports/a.mp4');
  });
});
