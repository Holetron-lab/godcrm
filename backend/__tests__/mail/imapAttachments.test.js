// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ fetch: vi.fn(), parse: vi.fn(), open: vi.fn() }));
vi.mock('imapflow', () => ({ ImapFlow: class {
  async connect() {}
  async list() { return [{ path: 'Junk', specialUse: '\\Junk' }]; }
  mailboxOpen(...args) { return mock.open(...args); }
  fetch(...args) { return mock.fetch(...args); }
  async logout() {}
} }));
vi.mock('mailparser', () => ({ simpleParser: mock.parse }));
import { imapFetch } from '../../services/mail/imapFetch.js';
const creds = { imap_host: 'mail', username: 'u', password: 'p' };
beforeEach(() => {
  vi.resetAllMocks();
  mock.open.mockResolvedValue({ exists: 1, uidValidity: 123n });
  mock.fetch.mockImplementation(() => (async function* () { yield { uid: 42, source: Buffer.from('source') }; })());
  mock.parse.mockResolvedValue({ attachments: [{ filename: 'quote.pdf', contentType: 'application/pdf', content: Buffer.from('pdf') }] });
});
it('retains bytes only when explicitly requested for storage', async () => {
  const [row] = await imapFetch({ creds, includeAttachmentContent: true });
  expect(row.attachments[0].content).toEqual(Buffer.from('pdf'));
  expect(row.imap_uid_validity).toBe('123');
  expect((await imapFetch({ creds }))[0].attachments[0].content).toBeUndefined();
});
it('fetches a requested UID, not a sequence number or recent window', async () => {
  await imapFetch({ creds, uid: 42 });
  expect(mock.fetch).toHaveBeenCalledWith('42', expect.any(Object), { uid: true });
});
it('resolves Spam through the IMAP Junk special-use flag', async () => {
  await imapFetch({ creds, folder: 'spam' });
  expect(mock.open).toHaveBeenCalledWith('Junk');
});

it('does not replace stored attachments with an empty list after a MIME parse failure', async () => {
  mock.parse.mockRejectedValue(new Error('Invalid MIME'));
  await expect(imapFetch({ creds, includeAttachmentContent: true })).rejects.toThrow('Invalid MIME');
});
