// ADR-0059 AMEND-3 §4.9 — limits helper.
//
// Verifies defaults, env override, clamp, and the LIVEKIT_URL → http(s)
// transform used for Twirp calls.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  getCallsLimits,
  livekitTwirpHost,
  DEFAULT_CALLS_MAX_CONCURRENT,
  DEFAULT_CALLS_MAX_PARTICIPANTS_PER_ROOM,
} from '../callsLimits.js';

const ENV_KEYS = ['CALLS_MAX_CONCURRENT', 'CALLS_MAX_PARTICIPANTS_PER_ROOM', 'LIVEKIT_URL'];
const saved = {};

describe('callsLimits', () => {
  beforeEach(() => {
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });
  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it('returns defaults when env unset', () => {
    const l = getCallsLimits();
    expect(l.maxConcurrent).toBe(DEFAULT_CALLS_MAX_CONCURRENT);
    expect(l.maxParticipantsPerRoom).toBe(DEFAULT_CALLS_MAX_PARTICIPANTS_PER_ROOM);
    expect(l.maxDurationMinutes).toBeNull();
    expect(l.retentionDays).toBeNull();
  });

  it('overrides from env', () => {
    process.env.CALLS_MAX_CONCURRENT = '25';
    process.env.CALLS_MAX_PARTICIPANTS_PER_ROOM = '50';
    const l = getCallsLimits();
    expect(l.maxConcurrent).toBe(25);
    expect(l.maxParticipantsPerRoom).toBe(50);
  });

  it('falls back to defaults on garbage env', () => {
    process.env.CALLS_MAX_CONCURRENT = 'abc';
    process.env.CALLS_MAX_PARTICIPANTS_PER_ROOM = '-5';
    const l = getCallsLimits();
    expect(l.maxConcurrent).toBe(DEFAULT_CALLS_MAX_CONCURRENT);
    expect(l.maxParticipantsPerRoom).toBe(DEFAULT_CALLS_MAX_PARTICIPANTS_PER_ROOM);
  });

  it('clamps absurd values to absolute max', () => {
    process.env.CALLS_MAX_CONCURRENT = '9999';
    const l = getCallsLimits();
    expect(l.maxConcurrent).toBe(200);
  });

  it('livekitTwirpHost flips ws/wss → http/https', () => {
    process.env.LIVEKIT_URL = 'wss://crm.hltrn.cc/livekit';
    expect(livekitTwirpHost()).toBe('https://crm.hltrn.cc/livekit');
    process.env.LIVEKIT_URL = 'ws://127.0.0.1:7880';
    expect(livekitTwirpHost()).toBe('http://127.0.0.1:7880');
  });
});
