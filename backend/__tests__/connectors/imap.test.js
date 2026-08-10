// @vitest-environment node
/**
 * ADR-160 §1 — IMAP/SMTP connector type.
 *
 * Pure-function unit tests: catalogue registration + body validation. No
 * network / DB (test() opens a real IMAP socket and is covered separately).
 * Boot guard imported per ADR-0009.
 */

import './../../test/setup.js';
import { describe, it, expect } from 'vitest';

const { getConnectorType, validateConnectorTypeBody, listConnectorTypes } = await import(
  '../../services/connectors/catalogue/index.js'
);

describe('imap connector — catalogue registration', () => {
  it('is registered and is an api_key kind', () => {
    const t = getConnectorType('imap');
    expect(t).toBeTruthy();
    expect(t.slug).toBe('imap');
    expect(t.auth_kind).toBe('api_key');
    expect(t.refresh_supported).toBe(false);
  });

  it('exposes the host/port/user/pass fields the connect form needs', () => {
    const t = getConnectorType('imap');
    const keys = t.fields.map((f) => f.key);
    expect(keys).toEqual(
      expect.arrayContaining(['imap_host', 'imap_port', 'smtp_host', 'smtp_port', 'username', 'password', 'use_tls'])
    );
  });

  it('appears in the JSON-safe catalogue listing', () => {
    const slugs = listConnectorTypes().map((t) => t.slug);
    expect(slugs).toContain('imap');
  });
});

describe('imap connector — validateBody', () => {
  const ok = { fields: { imap_host: 'mail.godcrm.ai', smtp_host: 'mail.godcrm.ai', username: 'geratron@godcrm.ai', password: 'secret' } };

  it('accepts a complete fields object', () => {
    expect(validateConnectorTypeBody('imap', ok)).toEqual({ ok: true });
  });

  it.each(['imap_host', 'smtp_host', 'username', 'password'])('rejects a missing %s', (missing) => {
    const fields = { ...ok.fields };
    delete fields[missing];
    const r = validateConnectorTypeBody('imap', { fields });
    expect(r.ok).toBe(false);
    expect(r.error).toContain(missing);
  });

  it('rejects a non-numeric port', () => {
    const r = validateConnectorTypeBody('imap', { fields: { ...ok.fields, imap_port: 'abc' } });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('imap_port');
  });

  it('accepts a numeric-string port (form sends strings)', () => {
    expect(validateConnectorTypeBody('imap', { fields: { ...ok.fields, imap_port: '993', smtp_port: '587' } })).toEqual({ ok: true });
  });

  it('rejects an empty body', () => {
    expect(validateConnectorTypeBody('imap', {}).ok).toBe(false);
  });
});
