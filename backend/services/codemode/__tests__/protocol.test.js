// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createEnvelope, verifyEnvelope } from '../protocol.js';

const key = 'a'.repeat(64);

describe('codemode protocol', () => {
  it('round-trips a signed envelope', () => {
    const envelope = createEnvelope(key, { type: 'run', run_id: 'run-1', code: 'return 1;' });
    expect(verifyEnvelope(key, envelope)).toMatchObject({ type: 'run', run_id: 'run-1' });
  });

  it('rejects a tampered body', () => {
    const envelope = createEnvelope(key, { type: 'run', run_id: 'run-1', code: 'return 1;' });
    envelope.body.code = 'return 2;';
    expect(verifyEnvelope(key, envelope)).toBeNull();
  });

  it('rejects a stale envelope', () => {
    const envelope = createEnvelope(key, {
      type: 'run',
      run_id: 'run-1',
      issued_at: Math.floor(Date.now() / 1000) - 301,
    });
    expect(verifyEnvelope(key, envelope)).toBeNull();
  });

  it('verifies dates and omitted undefined values after JSON transport', () => {
    const envelope = createEnvelope(key, {
      type: 'tool_result',
      run_id: 'run-1',
      result: { created_at: new Date('2026-11-07T10:00:00.000Z'), omitted: undefined },
    });
    const transported = JSON.parse(JSON.stringify(envelope));
    expect(verifyEnvelope(key, transported)).toEqual({
      type: 'tool_result',
      run_id: 'run-1',
      result: { created_at: '2026-11-07T10:00:00.000Z' },
      issued_at: envelope.body.issued_at,
    });
  });
});
