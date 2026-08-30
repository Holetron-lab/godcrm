// @vitest-environment node
/**
 * ADR-158 §P2 — reply-token round-trip.
 *
 * Pure unit test (no network/DB): mint → embed → extract, and the survive-Re:
 * property that makes inbound auto-link work. Boot guard imported per ADR-0009.
 */

import './../../test/setup.js';
import { describe, it, expect } from 'vitest';
import {
  generateReplyToken,
  embedReplyToken,
  extractReplyToken,
} from '../../services/mail/replyToken.js';

describe('replyToken', () => {
  it('mints a URL-safe token (base64url charset, no padding)', () => {
    const t = generateReplyToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(t).not.toContain('=');
    expect(t.length).toBeGreaterThanOrEqual(6);
  });

  it('mints distinct tokens', () => {
    expect(generateReplyToken()).not.toBe(generateReplyToken());
  });

  it('round-trips embed → extract', () => {
    const t = generateReplyToken();
    const subj = embedReplyToken('Invoice #42', t);
    expect(subj).toBe(`Invoice #42 [crm:${t}]`);
    expect(extractReplyToken(subj)).toBe(t);
  });

  it('survives a Re: prefix on the reply (the whole point)', () => {
    const t = generateReplyToken();
    const sent = embedReplyToken('Your order', t);
    const reply = `Re: ${sent}`;
    expect(extractReplyToken(reply)).toBe(t);
  });

  it('embed is idempotent — no double marker', () => {
    const t = 'abc123';
    const once = embedReplyToken('Hi', t);
    expect(embedReplyToken(once, t)).toBe(once);
  });

  it('extract returns null when no marker present', () => {
    expect(extractReplyToken('plain subject')).toBeNull();
    expect(extractReplyToken('')).toBeNull();
    expect(extractReplyToken(null)).toBeNull();
  });

  it('does not treat a bare [ticket:x] as a crm token', () => {
    expect(extractReplyToken('Re: hello [ticket:99]')).toBeNull();
  });
});
