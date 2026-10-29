// @vitest-environment node
/**
 * ADR-159 §Schema — connected-account identity mapping.
 *
 * Pure-function unit tests for the OIDC-claim → identity-column mapping
 * (`deriveIdentity`). No DB / network. Boot guard imported per ADR-0009.
 */

import './../../test/setup.js';
import { describe, it, expect } from 'vitest';

const { deriveIdentity, MODULE_CONNECTOR_TYPES } = await import(
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

describe('MODULE_CONNECTOR_TYPES', () => {
  it('maps the mail module to identity-bearing providers', () => {
    expect(MODULE_CONNECTOR_TYPES.mail).toContain('google');
    expect(MODULE_CONNECTOR_TYPES.mail).toContain('imap');
  });
});
