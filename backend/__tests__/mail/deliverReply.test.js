// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ get: vi.fn(), run: vi.fn(), send: vi.fn() }));
vi.mock('../../database/connection.js', () => ({ dbGet: mocks.get,
  withTransactionAsync: (fn) => fn({ get: mocks.get, run: mocks.run }) }));
vi.mock('../../services/SMTPService.js', () => ({ default: { createTransport: () => ({ sendMail: mocks.send }) } }));
import { deliverMail } from '../../services/mail/deliver.js';
const args = { spaceId: 11, conn: { id: 7, creds: { smtp_host: 'mail', username: 'me@example.com', password: 'test' } },
  to: ['you@example.com'], subject: 'Re', inReplyToId: 5 };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.get.mockImplementation(async (sql) => sql.includes('SELECT') ? { id: 5, message_id: '<original@example.com>' } : { id: 6 });
  mocks.send.mockResolvedValue({ messageId: '<sent@example.com>' });
});
describe('reply delivery', () => {
  it('marks the original only after SMTP accepts and carries the reply header', async () => {
    await deliverMail(args);
    expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({ inReplyTo: '<original@example.com>' }));
    expect(mocks.run).toHaveBeenCalledWith(expect.stringContaining('replied_at'), [5, 11, 7]);
    expect(mocks.send.mock.invocationCallOrder[0]).toBeLessThan(mocks.run.mock.invocationCallOrder[0]);
  });
  it('does not mark a failed send as replied', async () => {
    mocks.send.mockRejectedValue(new Error('SMTP unavailable'));
    await expect(deliverMail(args)).rejects.toThrow('SMTP unavailable');
    expect(mocks.run).not.toHaveBeenCalled();
  });
  it('rejects an original outside this mailbox before SMTP', async () => {
    mocks.get.mockResolvedValue(null);
    await expect(deliverMail(args)).rejects.toThrow(/reply/i);
    expect(mocks.send).not.toHaveBeenCalled();
  });
});
