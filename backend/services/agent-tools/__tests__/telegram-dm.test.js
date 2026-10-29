// @vitest-environment node
/**
 * send_telegram_message → private chat (`tg:<chat_id>`).
 *
 * The on-request "closed tasks" report (conversation 3724) is delivered to the
 * owner's Telegram DM, not to a channel/topic. The destination carries the
 * numeric chat_id explicitly: `tg:423753027`. The bot can only DM a user who
 * has pressed /start on it — that is a Telegram rule, surfaced as the API
 * error, not something this tool can work around.
 *
 * Pins:
 *  - `tg:<digits>` → sendMessage(chat_id, text, { parse_mode })
 *  - non-numeric id → clear error, NO send attempted
 *  - Markdown failure → one plain retry, same chat_id
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const sendMessageMock = vi.fn();
vi.mock('../../TelegramService.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, sendMessage: (...a) => sendMessageMock(...a) };
});

const { telegramToolHandlers } = await import('../telegram-tools.js');
const { send_telegram_message } = telegramToolHandlers;

beforeEach(() => {
  sendMessageMock.mockReset().mockResolvedValue({ success: true, messageId: 42 });
});

describe('send_telegram_message tg:<chat_id>', () => {
  it('sends to the private chat id with the requested parse_mode', async () => {
    const res = await send_telegram_message({ destination: 'tg:423753027', text: 'отчёт' });
    expect(res).toMatchObject({ success: true, message_id: 42, destination: 'tg:423753027' });
    expect(sendMessageMock).toHaveBeenCalledTimes(1);
    expect(sendMessageMock).toHaveBeenCalledWith('423753027', 'отчёт', { parse_mode: 'Markdown' });
  });

  it('rejects a non-numeric chat id without sending', async () => {
    const res = await send_telegram_message({ destination: 'tg:yeeeezy', text: 'x' });
    expect(res.error).toMatch(/numeric/i);
    expect(sendMessageMock).not.toHaveBeenCalled();
  });

  it('retries once as plain text when Markdown is rejected', async () => {
    sendMessageMock
      .mockResolvedValueOnce({ success: false, error: "Bad Request: can't parse entities" })
      .mockResolvedValueOnce({ success: true, messageId: 43 });
    const res = await send_telegram_message({ destination: 'tg:5', text: 'a_b' });
    expect(res).toMatchObject({ success: true, message_id: 43 });
    expect(sendMessageMock).toHaveBeenCalledTimes(2);
    expect(sendMessageMock.mock.calls[1]).toEqual(['5', 'a_b', {}]);
  });

  it('surfaces the Telegram error when the user never started the bot', async () => {
    sendMessageMock.mockResolvedValue({ success: false, error: 'Forbidden: bot was blocked by the user' });
    const res = await send_telegram_message({ destination: 'tg:5', text: 'x', parse_mode: '' });
    expect(res.error).toMatch(/Forbidden/);
  });
});
