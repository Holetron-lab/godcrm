// resolveChatPrefs.test.js — ADR-0064 WP-A.
//
// Covers the 4-layer hierarchy resolver:
//   - Pure-merge correctness (declared-keys-win) — 16-combination matrix
//     of (per-chat × personal × space × global) declared y/n.
//   - DB-fetch wiring via injectable fetchers.
//   - Cache TTL + scope-based invalidation.
//   - pg_notify shape (mocked dbRun).

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock dbGet/dbRun BEFORE importing the module under test so the injected
// fetchers don't accidentally hit a real database.
const mockDbGet = vi.fn();
const mockDbRun = vi.fn();
vi.mock('../../../database/connection.js', () => ({
  dbGet: (...args) => mockDbGet(...args),
  dbRun: (...args) => mockDbRun(...args),
  safeJsonParse: (value, defaultValue = null) => {
    if (value === null || value === undefined) return defaultValue;
    if (typeof value === 'object') return value;
    try { return JSON.parse(value); } catch { return defaultValue; }
  },
}));

import {
  mergeDeclared,
  resolveChatPrefs,
  invalidateCache,
  notifyInvalidate,
  CHAT_PREFS_DEFAULTS,
  __setFetchers,
  __resetFetchers,
  __cacheSize,
  __cacheClear,
} from '../resolveChatPrefs.js';

beforeEach(() => {
  __resetFetchers();
  __cacheClear();
  mockDbGet.mockReset();
  mockDbRun.mockReset();
});

// ─── Pure merge ─────────────────────────────────────────────────────────────

describe('mergeDeclared — declared-keys-win semantics', () => {
  it('innermost layer wins for declared keys', () => {
    const perChat = { enabled: false };
    const personal = { enabled: true, sound_enabled: true };
    const space = { sound_enabled: false };
    const global = { sound_volume: 0.6 };
    const out = mergeDeclared(perChat, personal, space, global, CHAT_PREFS_DEFAULTS);
    expect(out.enabled).toBe(false);          // per-chat declared, wins
    expect(out.sound_enabled).toBe(true);     // personal declared, wins over space
    expect(out.sound_volume).toBe(0.6);       // only global declared
  });

  it('undeclared keys fall through; nested per-key independence', () => {
    const personal = { humans: { sound: false } };  // declares humans.sound only
    const space    = { humans: { sound: true, popup: false } }; // declares humans.popup
    const out = mergeDeclared(null, personal, space, null, CHAT_PREFS_DEFAULTS);
    expect(out.humans.sound).toBe(false);   // personal wins
    expect(out.humans.popup).toBe(false);   // space wins (personal didn't declare)
    expect(out.humans.badge).toBe(true);    // default
  });

  it('returns full defaults when all layers null', () => {
    const out = mergeDeclared(null, null, null, null, CHAT_PREFS_DEFAULTS);
    expect(out).toEqual(CHAT_PREFS_DEFAULTS);
  });

  it('null values within a layer count as undeclared (fall through)', () => {
    const personal = { enabled: null };       // explicit null → undeclared
    const space    = { enabled: false };
    const out = mergeDeclared(null, personal, space, null, CHAT_PREFS_DEFAULTS);
    expect(out.enabled).toBe(false); // falls through to space layer
  });
});

// ─── 16-combination matrix ─────────────────────────────────────────────────
// Each layer either DECLARES the marker key (`enabled`) with its own distinct
// value or stays absent. We expect the resolver to surface the value of the
// innermost declaring layer — or, if no layer declares it, the baked default.

describe('mergeDeclared — 16 declared y/n combinations for `enabled`', () => {
  const PER_CHAT = { enabled: 'per_chat' };
  const PERSONAL = { enabled: 'personal' };
  const SPACE    = { enabled: 'space' };
  const GLOBAL   = { enabled: 'global' };

  // 16 rows = 2^4 — every subset of layers declares `enabled`.
  const cases = [];
  for (let mask = 0; mask < 16; mask++) {
    const a = (mask & 0b1000) ? PER_CHAT : null;
    const b = (mask & 0b0100) ? PERSONAL : null;
    const c = (mask & 0b0010) ? SPACE    : null;
    const d = (mask & 0b0001) ? GLOBAL   : null;
    let expected;
    if (a) expected = 'per_chat';
    else if (b) expected = 'personal';
    else if (c) expected = 'space';
    else if (d) expected = 'global';
    else expected = CHAT_PREFS_DEFAULTS.enabled; // true (baked)
    cases.push({ mask, perChat: a, personal: b, space: c, global: d, expected });
  }

  it.each(cases)('mask=$mask → enabled=$expected', ({ perChat, personal, space, global, expected }) => {
    const out = mergeDeclared(perChat, personal, space, global, CHAT_PREFS_DEFAULTS);
    expect(out.enabled).toBe(expected);
  });

  it('matrix is exhaustive', () => {
    expect(cases).toHaveLength(16);
  });
});

// ─── Resolver with injected fetchers ───────────────────────────────────────

describe('resolveChatPrefs — DB integration via injected fetchers', () => {
  it('walks all 4 layers and applies defaults', async () => {
    __setFetchers({
      perChat:  vi.fn().mockResolvedValue({ enabled: false }),
      personal: vi.fn().mockResolvedValue(null),
      space:    vi.fn().mockResolvedValue({ sound_volume: 0.3 }),
      global:   vi.fn().mockResolvedValue({ humans: { sound: false } }),
    });
    const out = await resolveChatPrefs({ userId: 7, conversationId: 42 });
    expect(out.enabled).toBe(false);          // per-chat
    expect(out.sound_enabled).toBe(true);     // default
    expect(out.sound_volume).toBe(0.3);       // space
    expect(out.humans.sound).toBe(false);     // global
    expect(out.humans.popup).toBe(true);      // default
    expect(out.agents.sound).toBe(true);      // default
  });

  it('caches on second call', async () => {
    const perChat = vi.fn().mockResolvedValue(null);
    const personal = vi.fn().mockResolvedValue({ enabled: true });
    const space = vi.fn().mockResolvedValue(null);
    const global = vi.fn().mockResolvedValue(null);
    __setFetchers({ perChat, personal, space, global });

    const a = await resolveChatPrefs({ userId: 1, conversationId: 10 });
    const b = await resolveChatPrefs({ userId: 1, conversationId: 10 });
    expect(a).toBe(b); // identity — same cached object
    expect(personal).toHaveBeenCalledTimes(1);
    expect(__cacheSize()).toBe(1);
  });
});

// ─── Cache invalidation scopes ─────────────────────────────────────────────

describe('invalidateCache — scope-based eviction', () => {
  async function seedCache() {
    __setFetchers({
      perChat: vi.fn().mockResolvedValue(null),
      personal: vi.fn().mockResolvedValue(null),
      space: vi.fn().mockResolvedValue(null),
      global: vi.fn().mockResolvedValue(null),
    });
    await resolveChatPrefs({ userId: 1, conversationId: 100 });
    await resolveChatPrefs({ userId: 1, conversationId: 200 });
    await resolveChatPrefs({ userId: 2, conversationId: 100 });
    await resolveChatPrefs({ userId: 2, conversationId: 300 });
  }

  it('user_id evicts all entries for that user', async () => {
    await seedCache();
    expect(__cacheSize()).toBe(4);
    invalidateCache({ user_id: 1 });
    expect(__cacheSize()).toBe(2);
  });

  it('conversation_id evicts all entries for that conv', async () => {
    await seedCache();
    invalidateCache({ conversation_id: 100 });
    expect(__cacheSize()).toBe(2); // (1,200) and (2,300) survive
  });

  it('space_id clears the entire cache (no in-process userId→space map)', async () => {
    await seedCache();
    invalidateCache({ space_id: 11 });
    expect(__cacheSize()).toBe(0);
  });

  it('empty scope clears everything', async () => {
    await seedCache();
    invalidateCache({});
    expect(__cacheSize()).toBe(0);
  });
});

// ─── pg_notify wrapper ─────────────────────────────────────────────────────

describe('notifyInvalidate — fires pg_notify with stringified scope', () => {
  it('writes the right channel + payload', async () => {
    mockDbRun.mockResolvedValue();
    await notifyInvalidate({ user_id: 9, conversation_id: 123 });
    expect(mockDbRun).toHaveBeenCalledTimes(1);
    const [sql, params] = mockDbRun.mock.calls[0];
    expect(sql).toMatch(/pg_notify/);
    expect(params[0]).toBe('chat_prefs_invalidate');
    expect(JSON.parse(params[1])).toEqual({ user_id: 9, conversation_id: 123 });
  });

  it('falls back to local cache eviction on dbRun failure', async () => {
    __setFetchers({
      perChat: vi.fn().mockResolvedValue(null),
      personal: vi.fn().mockResolvedValue(null),
      space: vi.fn().mockResolvedValue(null),
      global: vi.fn().mockResolvedValue(null),
    });
    await resolveChatPrefs({ userId: 5, conversationId: 50 });
    expect(__cacheSize()).toBe(1);

    mockDbRun.mockRejectedValue(new Error('db down'));
    await notifyInvalidate({ user_id: 5 });
    expect(__cacheSize()).toBe(0);
  });
});
