/**
 * Bugs 1552/229244 (ADR-203 S1): a login started from the legacy `/login`
 * path must not bounce back to `/login` (404 "Route empty") after success.
 */
import { describe, it, expect } from 'vitest';
import { DEFAULT_POST_LOGIN_PATH, isSafeReturnPath, resolvePostLoginTarget } from '../postLoginTarget';

describe('resolvePostLoginTarget (1552/229244)', () => {
  it('returns to the in-app path the guard bounced from', () => {
    expect(resolvePostLoginTarget({ from: '/spaces/11/dashboard?tab=x#y' })).toBe('/spaces/11/dashboard?tab=x#y');
    expect(resolvePostLoginTarget({ from: '/tables/1552' })).toBe('/tables/1552');
  });

  it('falls back to /spaces when the guard bounced from an auth page', () => {
    for (const from of ['/login', '/login?redirect=%2Fx', '/register', '/auth/login', '/auth/register', '/reset-password/abc']) {
      expect(resolvePostLoginTarget({ from })).toBe(DEFAULT_POST_LOGIN_PATH);
    }
  });

  it('falls back to /spaces when there is no usable state', () => {
    expect(resolvePostLoginTarget(null)).toBe(DEFAULT_POST_LOGIN_PATH);
    expect(resolvePostLoginTarget(undefined)).toBe(DEFAULT_POST_LOGIN_PATH);
    expect(resolvePostLoginTarget({})).toBe(DEFAULT_POST_LOGIN_PATH);
    expect(resolvePostLoginTarget({ from: 42 })).toBe(DEFAULT_POST_LOGIN_PATH);
    expect(resolvePostLoginTarget({ from: '' })).toBe(DEFAULT_POST_LOGIN_PATH);
  });

  it('never redirects off-site', () => {
    expect(isSafeReturnPath('https://evil.example/phish')).toBe(false);
    expect(isSafeReturnPath('//evil.example/phish')).toBe(false);
    expect(isSafeReturnPath('javascript:alert(1)')).toBe(false);
    expect(isSafeReturnPath('spaces')).toBe(false);
  });

  it('does not confuse app paths that merely start with an auth word', () => {
    expect(isSafeReturnPath('/loginsights')).toBe(true);
    expect(isSafeReturnPath('/authors/1')).toBe(true);
  });

  it.each([
    '/\\evil.example', '/\t/evil.example', '/\n/evil.example', '/\r/evil.example',
    '/spaces\u0000', '/spaces\u007f', '/spaces?x=\\evil',
    '/%2f%2fevil.example', '/%5cevil.example', '/%09/evil.example',
    '/%61uth/login', '/AUTH/login', '/spaces/../login', '/spaces/%2e%2e/auth/login',
    '/spaces%2f..%2fauth/login', '/spaces/..//evil.example',
    '/spaces%3f/../auth/login', '/spaces%23/../auth/login',
    '/%E0%A4%A', '/bad%escape',
  ])('rejects browser-normalized, malformed or hostile return path %j', (from) => {
    expect(isSafeReturnPath(from)).toBe(false);
    expect(resolvePostLoginTarget({ from })).toBe(DEFAULT_POST_LOGIN_PATH);
  });

  it('preserves nested authorize parameters and opaque query encoding byte-for-byte', () => {
    const query = new URLSearchParams({
      redirect_uri: 'https://godcrm.ai/git/user/oauth2/GOD%20CRM/callback',
      state: 'a+b&extra=c%25', nonce: 'n+with&extra=c%',
    });
    for (const from of [`/oauth/authorize?${query}`, '/spaces?opaque=%E0%A4%A#%']) {
      expect(isSafeReturnPath(from)).toBe(true);
      expect(resolvePostLoginTarget({ from })).toBe(from);
    }
  });
});
