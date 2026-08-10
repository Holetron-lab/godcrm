import { describe, it, expect } from 'vitest';
import { hashToken, TOKEN_PREFIX_LEN } from '../tokenHash.js';

describe('hashToken (ADR-0069)', () => {
  it('returns 12-char prefix + sha256 hex hash for a known input', () => {
    const { prefix, hash } = hashToken('abc123def456ghi789');
    expect(prefix).toBe('abc123def456');
    expect(prefix).toHaveLength(TOKEN_PREFIX_LEN);
    expect(hash).toBe('1fc04aae4c0759fbe7e340318ff300e9e02cb92dfb6198f6468d9b9891f8b149');
  });

  it('matches a webhook-style token snapshot', () => {
    const { prefix, hash } = hashToken('wh_a1f9b2c3d4e5_token_x');
    expect(prefix).toBe('wh_a1f9b2c3d');
    expect(hash).toBe('ba498f0c8c4fd4178b4e11a51c1c76f0cbf12952bc4d2675f4e209934455fa34');
  });

  it('handles empty string (sha256 of "")', () => {
    const { prefix, hash } = hashToken('');
    expect(prefix).toBe('');
    expect(hash).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('takes the whole string as prefix when shorter than TOKEN_PREFIX_LEN', () => {
    const { prefix } = hashToken('short');
    expect(prefix).toBe('short');
  });

  it('is deterministic across calls for the same plaintext', () => {
    const a = hashToken('determinism-check');
    const b = hashToken('determinism-check');
    expect(a.prefix).toBe(b.prefix);
    expect(a.hash).toBe(b.hash);
  });

  it('produces different hashes for inputs that share a prefix', () => {
    const a = hashToken('shared-prefix-AAAA');
    const b = hashToken('shared-prefix-BBBB');
    expect(a.prefix).toBe(b.prefix);
    expect(a.hash).not.toBe(b.hash);
  });

  it('throws TypeError on non-string input', () => {
    expect(() => hashToken(null)).toThrow(TypeError);
    expect(() => hashToken(undefined)).toThrow(TypeError);
    expect(() => hashToken(123)).toThrow(TypeError);
    expect(() => hashToken({})).toThrow(TypeError);
  });
});
