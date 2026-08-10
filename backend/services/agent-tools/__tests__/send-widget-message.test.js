// @vitest-environment node
/**
 * ADR-0031 WP-23 — send_widget_message MCP wrapper tests.
 *
 * Validates the contract: the wrapper resolves table/row metadata, builds a
 * row_reference attachment, and delegates to send_chat_message. Heavy DB
 * dependencies are mocked so the suite runs without a fixture.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock the database connection module BEFORE importing the SUT.
const dbGet = vi.fn();
const dbRun = vi.fn();
const dbAll = vi.fn();
const isPostgres = vi.fn(() => false);
const sqlNow = vi.fn(() => "datetime('now')");

vi.mock('../../../database/connection.js', () => ({
  dbGet: (...args) => dbGet(...args),
  dbRun: (...args) => dbRun(...args),
  dbAll: (...args) => dbAll(...args),
  isPostgres: (...args) => isPostgres(...args),
  sqlNow: (...args) => sqlNow(...args),
}));

vi.mock('../../../utils/logger.js', () => ({
  apiLogger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../chat/invocation-dispatcher.js', () => ({
  dispatchInvocationsFromContent: vi.fn(),
  hasInvocationTokens: vi.fn(() => false),
}));

const { chatToolHandlers } = await import('../chat-tools.js');

beforeEach(() => {
  dbGet.mockReset();
  dbRun.mockReset();
});

describe('send_widget_message — input validation', () => {
  it('rejects missing conversation_id', async () => {
    const res = await chatToolHandlers.send_widget_message({ table_id: 1, row_id: 1 }, 1);
    expect(res).toEqual({ error: expect.stringContaining('conversation_id') });
    expect(dbGet).not.toHaveBeenCalled();
  });

  it('rejects missing table_id', async () => {
    const res = await chatToolHandlers.send_widget_message({ conversation_id: 1, row_id: 1 }, 1);
    expect(res).toEqual({ error: expect.stringContaining('table_id') });
  });

  it('rejects missing row_id', async () => {
    const res = await chatToolHandlers.send_widget_message({ conversation_id: 1, table_id: 1 }, 1);
    expect(res).toEqual({ error: expect.stringContaining('row_id') });
  });

  it('rejects invalid style', async () => {
    const res = await chatToolHandlers.send_widget_message(
      { conversation_id: 1, table_id: 1, row_id: 1, style: 'banner' }, 1
    );
    expect(res).toEqual({ error: expect.stringContaining('style') });
  });

  it('errors when table is missing', async () => {
    dbGet.mockResolvedValueOnce(null); // universal_tables lookup → not found
    const res = await chatToolHandlers.send_widget_message(
      { conversation_id: 1, table_id: 999, row_id: 1 }, 1
    );
    expect(res).toEqual({ error: expect.stringMatching(/Table 999 not found/) });
  });

  it('errors when row is missing', async () => {
    dbGet
      .mockResolvedValueOnce({ id: 2197, name: 'Реестр документов', display_name: 'ADRs', icon: '📡' })
      .mockResolvedValueOnce(null); // table_rows lookup → not found
    const res = await chatToolHandlers.send_widget_message(
      { conversation_id: 1, table_id: 2197, row_id: 99999 }, 1
    );
    expect(res).toEqual({ error: expect.stringMatching(/Row 99999 not found/) });
  });
});

describe('send_widget_message — happy path', () => {
  it('resolves metadata, builds row_reference attachment, and posts via INSERT', async () => {
    dbGet
      // 1. universal_tables lookup
      .mockResolvedValueOnce({ id: 2197, name: '_registry', display_name: 'ADRs', icon: '📡' })
      // 2. table_rows lookup
      .mockResolvedValueOnce({
        id: 139259,
        data: JSON.stringify({ name: 'ADR-0031 — Row-Mutation Events', slug: 'adr-0031', icon: '📡' }),
      })
      // 3. send_chat_message — conversations lookup
      .mockResolvedValueOnce({ id: 42, space_id: 11 });

    dbRun
      // 4. INSERT INTO messages
      .mockResolvedValueOnce({ lastInsertRowid: 555 })
      // 5. UPDATE conversations
      .mockResolvedValueOnce({});

    const result = await chatToolHandlers.send_widget_message(
      { conversation_id: 42, table_id: 2197, row_id: 139259, style: 'card', note: 'doc ready' },
      1
    );

    expect(result).toEqual({ success: true, message_id: 555, message: 'Message sent' });

    // Verify the INSERT was called with row_reference attachment carrying resolved metadata.
    const insertCall = dbRun.mock.calls.find(([sql]) => /INSERT INTO messages/.test(sql));
    expect(insertCall).toBeTruthy();
    const params = insertCall[1];
    // params order: [conversation_id, role, content, content_type, sender_id, attachmentsJson]
    expect(params[0]).toBe(42);
    expect(params[2]).toBe('doc ready');     // content = note
    expect(params[3]).toBe('text');          // content_type = 'text' (chips ride on text msgs)
    const atts = JSON.parse(params[5]);
    expect(atts).toHaveLength(1);
    expect(atts[0]).toMatchObject({
      type: 'row_reference',
      rowReference: {
        table_id: 2197,
        row_id: 139259,
        table_name: 'ADRs',
        table_icon: '📡',
        row_title: 'ADR-0031 — Row-Mutation Events',
        style: 'card',
      },
    });
  });

  it('falls back to "Row #N" when no display column matches', async () => {
    dbGet
      .mockResolvedValueOnce({ id: 100, name: 'misc', display_name: null, icon: null })
      .mockResolvedValueOnce({ id: 7, data: JSON.stringify({ foo: 'bar' }) })
      .mockResolvedValueOnce({ id: 1, space_id: null });
    dbRun
      .mockResolvedValueOnce({ lastInsertRowid: 1 })
      .mockResolvedValueOnce({});

    await chatToolHandlers.send_widget_message(
      { conversation_id: 1, table_id: 100, row_id: 7 }, 1
    );

    const insertCall = dbRun.mock.calls.find(([sql]) => /INSERT INTO messages/.test(sql));
    const atts = JSON.parse(insertCall[1][5]);
    expect(atts[0].rowReference.row_title).toBe('Row #7');
    expect(atts[0].rowReference.table_name).toBe('misc');
    // No table_icon when icon is null.
    expect(atts[0].rowReference.table_icon).toBeUndefined();
    // Default style = 'chip'.
    expect(atts[0].rowReference.style).toBe('chip');
  });
});

describe('create_document return shape (ADR-0031 WP-23)', () => {
  it('exposes registry_table_id alongside document_id (compile-time check)', async () => {
    // We intentionally avoid running the full create_document path here (too
    // many DB dependencies). The shape is asserted by inspecting the source —
    // this test is a guard against future refactors that drop the field.
    const fs = await import('node:fs');
    const path = await import('node:path');
    const src = fs.readFileSync(
      path.resolve(__dirname, '../document-tools.js'),
      'utf8'
    );
    // Find the create_document return object and verify registry_table_id is present.
    const match = src.match(/async create_document[\s\S]*?return \{[\s\S]*?\};/);
    expect(match).toBeTruthy();
    expect(match[0]).toMatch(/registry_table_id/);
  });
});
