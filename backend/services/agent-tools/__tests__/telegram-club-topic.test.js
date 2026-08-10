// @vitest-environment node
/**
 * Unit guard for the Anti-Marketing Club topic drip path (`club_<key>`).
 *
 * @marketer needs to drip Bluesky drafts into a dedicated forum topic in the
 * club staging group (chat -1003802092483). The thread_id is NOT hardcoded —
 * clubRouter learns it via a calibration marker and persists it to
 * data/club-topics.json. The tool resolves the calibrated id at send time.
 *
 * Pins:
 *  - unknown/uncalibrated topic → clear error, NO Telegram send attempted
 *  - calibrated topic → sends to CLUB_CHAT_ID + message_thread_id, plain text
 *  - getClubTopicThread reads FRESH from disk (MCP proc ≠ webhook proc — the
 *    in-memory registry cache would be stale; the file is the shared truth)
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs/promises';
import path from 'path';

const sendMessageMock = vi.fn();
vi.mock('../../TelegramService.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, sendMessage: (...a) => sendMessageMock(...a) };
});

const { telegramToolHandlers } = await import('../telegram-tools.js');
const { send_telegram_message } = telegramToolHandlers;
const { CLUB_CHAT_ID } = await import('../../../routes/v3/telegram/clubRouter.js');

const REGISTRY_PATH = path.resolve(process.cwd(), 'data', 'club-topics.json');
let savedRegistry = null;

beforeEach(async () => {
  sendMessageMock.mockReset().mockResolvedValue({ success: true, messageId: 42 });
  try { savedRegistry = await fs.readFile(REGISTRY_PATH, 'utf8'); } catch { savedRegistry = null; }
});
afterEach(async () => {
  if (savedRegistry !== null) await fs.writeFile(REGISTRY_PATH, savedRegistry);
  else await fs.rm(REGISTRY_PATH, { force: true });
});

async function writeRegistry(obj) {
  await fs.mkdir(path.dirname(REGISTRY_PATH), { recursive: true });
  await fs.writeFile(REGISTRY_PATH, JSON.stringify(obj));
}

describe('send_telegram_message → club_<key>', () => {
  it('errors with calibration guidance when the topic is not calibrated, without sending', async () => {
    await writeRegistry({ kitchen_in: 5 }); // bluesky absent
    const res = await send_telegram_message({ destination: 'club_bluesky', text: 'one db, one primitive' });
    expect(res.error).toMatch(/not calibrated/i);
    expect(res.error).toMatch(/bluesky/);
    expect(sendMessageMock).not.toHaveBeenCalled();
  });

  it('sends to the club chat + calibrated thread_id as plain text', async () => {
    await writeRegistry({ bluesky: 777 });
    const res = await send_telegram_message({ destination: 'club_bluesky', text: 'it just holds.' });
    expect(res.success).toBe(true);
    expect(res.message_id).toBe(42);
    expect(sendMessageMock).toHaveBeenCalledTimes(1);
    const [chatId, text, opts] = sendMessageMock.mock.calls[0];
    expect(String(chatId)).toBe(String(CLUB_CHAT_ID));
    expect(text).toBe('it just holds.');
    expect(opts.message_thread_id).toBe(777);
    expect(opts.parse_mode).toBeUndefined(); // plain — stray _ * ` won't crash Markdown
  });

  it('reflects a fresh calibration written after the module loaded (no stale cache)', async () => {
    await writeRegistry({ bluesky: 100 });
    await send_telegram_message({ destination: 'club_bluesky', text: 'a' });
    await writeRegistry({ bluesky: 200 }); // recalibrated out-of-band
    await send_telegram_message({ destination: 'club_bluesky', text: 'b' });
    expect(sendMessageMock.mock.calls.at(-1)[2].message_thread_id).toBe(200);
  });
});
