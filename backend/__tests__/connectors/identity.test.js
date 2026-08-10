// @vitest-environment node
/**
 * ADR-159 §Schema — connected-account identity mapping.
 *
 * Pure-function unit tests for the OIDC-claim → identity-column mapping
 * (`deriveIdentity`) and the UserInfo-shaped switcher projection
 * (`toSwitcherShape`). No DB / network. Boot guard imported per ADR-0009.
 */

import './../../test/setup.js';
import { describe, it, expect } from 'vitest';

const { deriveIdentity, toSwitcherShape, MODULE_CONNECTOR_TYPES } = await import(
  '../../routes/v3/connectors.js'
);

describe('deriveIdentity', () => {
  it('returns all-null when no identity present', () => {
    expect(deriveIdentity(undefined)).toEqual({
      account_sub: null,
      email: null,
      account_name: null,
      avatar_url: null,
      profile: null,
    });
    expect(deriveIdentity({})).toEqual({
      account_sub: null,
      email: null,
      account_name: null,
      avatar_url: null,
      profile: null,
    });
    expect(deriveIdentity({ identity: 'nope' })).toEqual({
      account_sub: null,
      email: null,
      account_name: null,
      avatar_url: null,
      profile: null,
    });
  });

  it('maps Google UserInfo claims 1:1 onto identity columns', () => {
    const userinfo = {
      sub: '110248495921238986420',
      email: 'nikita@hltrn.cc',
      email_verified: true,
      name: 'Nikita Holetron',
      picture: 'https://lh3.googleusercontent.com/a/ACg8',
      locale: 'ru',
      hd: 'hltrn.cc',
    };
    // shape produced by google.extractAccountInfo()
    const info = {
      account_label: 'nikita@hltrn.cc',
      identity: {
        sub: userinfo.sub,
        email: userinfo.email,
        name: userinfo.name,
        picture: userinfo.picture,
        profile: userinfo,
      },
    };
    expect(deriveIdentity(info)).toEqual({
      account_sub: '110248495921238986420',
      email: 'nikita@hltrn.cc',
      account_name: 'Nikita Holetron',
      avatar_url: 'https://lh3.googleusercontent.com/a/ACg8',
      profile: userinfo,
    });
  });

  it('coerces a numeric sub (GitHub `id`) to string', () => {
    const out = deriveIdentity({ identity: { sub: 12345, email: 'x@y.z' } });
    expect(out.account_sub).toBe('12345');
    expect(typeof out.account_sub).toBe('string');
  });

  it('drops a non-object profile', () => {
    const out = deriveIdentity({ identity: { sub: 'a', profile: 'not-an-object' } });
    expect(out.profile).toBeNull();
  });
});

describe('toSwitcherShape', () => {
  const baseRow = {
    id: 4821,
    type_slug: 'google',
    status: 'active',
    scopes_granted: ['openid', 'email', 'https://mail.google.com/'],
    account_sub: '110248495921238986420',
    email: 'nikita@hltrn.cc',
    account_name: 'Nikita Holetron',
    avatar_url: 'https://lh3.googleusercontent.com/a/ACg8',
    expires_at: '2026-06-27T09:59:00Z',
  };

  it('projects a row to the UserInfo-shaped switcher payload (profile as object)', () => {
    const row = {
      ...baseRow,
      profile: { email_verified: true, locale: 'ru', hd: 'hltrn.cc' },
    };
    expect(toSwitcherShape(row)).toEqual({
      id: 4821,
      provider: 'google',
      sub: '110248495921238986420',
      email: 'nikita@hltrn.cc',
      email_verified: true,
      name: 'Nikita Holetron',
      picture: 'https://lh3.googleusercontent.com/a/ACg8',
      locale: 'ru',
      hosted_domain: 'hltrn.cc',
      status: 'active',
      expires_at: '2026-06-27T09:59:00Z',
      scopes: ['openid', 'email', 'https://mail.google.com/'],
    });
  });

  it('parses a JSON-string profile (pg jsonb returned as text)', () => {
    const row = { ...baseRow, profile: JSON.stringify({ locale: 'en', hd: 'acme.io' }) };
    const out = toSwitcherShape(row);
    expect(out.locale).toBe('en');
    expect(out.hosted_domain).toBe('acme.io');
  });

  it('tolerates a null/absent profile and identity columns', () => {
    const out = toSwitcherShape({
      id: 9,
      type_slug: 'imap',
      status: 'active',
      scopes_granted: null,
      account_sub: null,
      email: null,
      account_name: null,
      avatar_url: null,
      profile: null,
      expires_at: null,
    });
    expect(out).toEqual({
      id: 9,
      provider: 'imap',
      sub: null,
      email: null,
      email_verified: null,
      name: null,
      picture: null,
      locale: null,
      hosted_domain: null,
      status: 'active',
      expires_at: null,
      scopes: [],
    });
  });
});

describe('MODULE_CONNECTOR_TYPES', () => {
  it('maps the mail module to identity-bearing providers', () => {
    expect(MODULE_CONNECTOR_TYPES.mail).toContain('google');
    expect(MODULE_CONNECTOR_TYPES.mail).toContain('imap');
  });
});
