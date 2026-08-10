// @vitest-environment node
/**
 * Guard for the Telegram 4096-char split path.
 *
 * Telegram's sendMessage REJECTS (does not truncate) any text over 4096 chars.
 * Long kitchen/voice EN dubs were silently dropped because of this. sendMessage
 * now splits oversized text on line boundaries and sends the parts in order,
 * while keeping the {success, messageId} contract and leaving the within-limit
 * path byte-identical.
 *
 * Pins:
 *  - within-limit text → exactly one send, unchanged
 *  - oversized text → split on line boundaries, every part <= 4096
 *  - a single oversized line → hard-sliced, never dropped
 *  - sendMessage splits into N fetch calls, returns the FIRST part's messageId
 *  - a failed part surfaces immediately and stops the drip
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../secrets/getSecret.js', () => ({
  getSecret: vi.fn().mockResolvedValue('TESTTOKEN'),
}));

const { splitTelegramText, sendMessage, TG_MAX_LEN } = await import('../TelegramService.js');

describe('splitTelegramText', () => {
  it('returns within-limit text as a single unchanged chunk', () => {
    const t = 'a'.repeat(TG_MAX_LEN);
    expect(splitTelegramText(t)).toEqual([t]);
  });

  it('splits oversized text into parts that are each <= limit, losing no content', () => {
    // No trailing newline and no oversized line → join('\n') reconstructs exactly,
    // because each chunk boundary drops exactly one '\n' that join re-adds.
    const para = Array(500).fill('line of kitchen prose').join('\n'); // ~11k chars
    const parts = splitTelegramText(para);
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(TG_MAX_LEN);
    expect(parts.join('\n')).toBe(para);
  });

  it('breaks on line boundaries, not mid-line, when lines fit', () => {
    const line = 'x'.repeat(100);
    const text = Array(60).fill(line).join('\n'); // 60 lines, ~6k chars
    const parts = splitTelegramText(text, 1000);
    for (const p of parts) {
      for (const l of p.split('\n')) expect(l).toBe(line); // every line intact
    }
  });

  it('hard-slices a single line longer than the limit', () => {
    const huge = 'y'.repeat(10000); // one line, no newlines
    const parts = splitTelegramText(huge, 4096);
    expect(parts.length).toBe(3);
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(4096);
    expect(parts.join('')).toBe(huge);
  });
});

describe('sendMessage chunking', () => {
  beforeEach(() => { vi.unstubAllGlobals(); });

  const okFetch = (idStart = 10) => {
    let id = idStart;
    return vi.fn().mockImplementation(async () => ({
      json: async () => ({ ok: true, result: { message_id: id++ } }),
    }));
  };

  it('sends within-limit text in exactly one call', async () => {
    const f = okFetch();
    vi.stubGlobal('fetch', f);
    const res = await sendMessage('@chan', 'short', { parse_mode: undefined });
    expect(res).toEqual({ success: true, messageId: 10 });
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('splits oversized text into multiple sends and returns the first messageId', async () => {
    const f = okFetch(100);
    vi.stubGlobal('fetch', f);
    const big = 'paragraph\n'.repeat(900); // ~9k chars → >1 part
    const res = await sendMessage('@chan', big);
    expect(res.success).toBe(true);
    expect(res.messageId).toBe(100); // first part
    expect(f.mock.calls.length).toBeGreaterThan(1);
    // every part body is within the limit
    for (const call of f.mock.calls) {
      const body = JSON.parse(call[1].body);
      expect(body.text.length).toBeLessThanOrEqual(TG_MAX_LEN);
    }
  });

  it('surfaces the first failed part and stops sending the rest', async () => {
    let n = 0;
    const f = vi.fn().mockImplementation(async () => {
      n++;
      if (n === 1) return { json: async () => ({ ok: true, result: { message_id: 1 } }) };
      return { json: async () => ({ ok: false, description: 'message is too long' }) };
    });
    vi.stubGlobal('fetch', f);
    const big = 'paragraph\n'.repeat(900);
    const res = await sendMessage('@chan', big);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/too long/);
    expect(f).toHaveBeenCalledTimes(2); // first ok, second failed → stop
  });
});
