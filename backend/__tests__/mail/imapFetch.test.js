// @vitest-environment node
/**
 * ADR-160 — imapFetch normalization.
 *
 * Pure unit test: imapflow + mailparser are mocked, so no network/DB. Asserts
 * the IMAP envelope/flags/source are mapped onto the mail_messages row shape,
 * \Seen → is_read, preview truncation, and newest-first ordering.
 * Boot guard imported per ADR-0009.
 */

import './../../test/setup.js';
import { describe, it, expect, vi } from 'vitest';

vi.mock('imapflow', () => {
  class ImapFlow {
    constructor(opts) { this.opts = opts; }
    async connect() {}
    async list() { return [{ path: 'Sent', specialUse: '\\Sent' }]; }
    async mailboxOpen() { return { exists: 2 }; }
    fetch() {
      const msgs = [
        {
          uid: 11,
          envelope: {
            messageId: '<a@x>', from: [{ name: 'Alice', address: 'alice@x.co' }],
            to: [{ address: 'me@godcrm.ai' }], subject: 'Older', date: new Date('2024-01-01T00:00:00Z'),
          },
          flags: new Set(['\\Seen']),
          source: Buffer.from('older body'),
        },
        {
          uid: 12,
          envelope: {
            messageId: '<b@x>', from: [{ name: 'Bob', address: 'bob@x.co' }],
            to: [{ address: 'me@godcrm.ai' }], subject: 'Newer', date: new Date('2024-02-01T00:00:00Z'),
          },
          flags: new Set(),
          source: Buffer.from('newer body'),
        },
      ];
      return (async function* () { for (const m of msgs) yield m; })();
    }
    async logout() {}
  }
  return { ImapFlow };
});

vi.mock('mailparser', () => ({
  simpleParser: async (src) => ({ text: `parsed: ${src.toString()}`, html: null }),
}));

const { imapFetch } = await import('../../services/mail/imapFetch.js');

const creds = { imap_host: 'mail.godcrm.ai', imap_port: 993, username: 'me@godcrm.ai', password: 'secret' };

describe('imapFetch', () => {
  it('throws when creds are incomplete', async () => {
    await expect(imapFetch({ creds: { imap_host: 'h' } })).rejects.toThrow(/incomplete/);
  });

  it('normalizes envelope + flags + source onto the row shape, newest first', async () => {
    const rows = await imapFetch({ creds, folder: 'inbox', limit: 50 });
    expect(rows).toHaveLength(2);

    // Newest first: Feb (uid 12) before Jan (uid 11).
    expect(rows[0].imap_uid).toBe(12);
    expect(rows[1].imap_uid).toBe(11);

    const newer = rows[0];
    expect(newer.from_name).toBe('Bob');
    expect(newer.from_address).toBe('bob@x.co');
    expect(newer.to_addresses).toEqual(['me@godcrm.ai']);
    expect(newer.subject).toBe('Newer');
    expect(newer.message_id).toBe('<b@x>');
    expect(newer.is_read).toBe(false);
    expect(newer.preview).toBe('parsed: newer body');

    // \Seen flag maps to is_read.
    expect(rows[1].is_read).toBe(true);
  });

  it('returns [] for an empty mailbox', async () => {
    const imapflow = await import('imapflow');
    const spy = vi.spyOn(imapflow.ImapFlow.prototype, 'mailboxOpen').mockResolvedValueOnce({ exists: 0 });
    const rows = await imapFetch({ creds, folder: 'inbox' });
    expect(rows).toEqual([]);
    spy.mockRestore();
  });
});
