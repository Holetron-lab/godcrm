// ADR-0009 §Phase 7 — the boot guard guards itself.
//
// The guard is the one thing standing between a stray POSTGRES_DB and a
// combat master, and until now nothing tested it. These cases pin the two
// Phase 7 rules: the DB allowlist (fails closed on a renamed master) and the
// production-host rule (loopback only).

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { assertSafeTestDb } from '../setup.js';

const KEYS = ['POSTGRES_HOST', 'POSTGRES_DB', 'BUSINESS_CRM_IS_PROD'];

/** Run the guard with a synthetic env; returns the exit code, or null if it allowed the run. */
function guardWith(env) {
  const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const key of KEYS) delete process.env[key];
  Object.assign(process.env, env);

  let exitCode = null;
  const exit = vi.spyOn(process, 'exit').mockImplementation((code) => {
    exitCode = code;
    throw new Error('__guard_exit__'); // stop execution the way exit() would
  });
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

  try {
    assertSafeTestDb();
  } catch (err) {
    if (err.message !== '__guard_exit__') throw err;
  } finally {
    exit.mockRestore();
    error.mockRestore();
    warn.mockRestore();
    for (const key of KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }

  return exitCode;
}

describe('ADR-0009 boot guard', () => {
  test('allows a local test database', () => {
    expect(guardWith({ POSTGRES_HOST: '127.0.0.1', POSTGRES_DB: 'godcrm_test' })).toBeNull();
  });

  test('refuses the combat database by name', () => {
    expect(guardWith({ POSTGRES_HOST: '127.0.0.1', POSTGRES_DB: 'godcrm_prod' })).toBe(2);
  });

  test('refuses a RENAMED combat database — the Phase 6 blocklist hole', () => {
    expect(guardWith({ POSTGRES_HOST: 'localhost', POSTGRES_DB: 'godcrm_master_a' })).toBe(2);
  });

  test('refuses an unset database', () => {
    expect(guardWith({ POSTGRES_HOST: '127.0.0.1' })).toBe(2);
  });

  test.each(['crm.hltrn.cc', 'app.godcrm.ai', '<RING1_IP>', '<LEGACY_IP>'])(
    'refuses combat host %s even with a _test database name',
    (host) => {
      expect(guardWith({ POSTGRES_HOST: host, POSTGRES_DB: 'godcrm_test' })).toBe(2);
    }
  );

  test('a production host may reach its own loopback test database', () => {
    expect(
      guardWith({
        POSTGRES_HOST: '127.0.0.1',
        POSTGRES_DB: 'godcrm_test',
        BUSINESS_CRM_IS_PROD: '1'
      })
    ).toBeNull();
  });

  test('a production host may NOT reach a remote test database', () => {
    expect(
      guardWith({
        POSTGRES_HOST: '<DEV_IP>',
        POSTGRES_DB: 'godcrm_test',
        BUSINESS_CRM_IS_PROD: '1'
      })
    ).toBe(2);
  });
});
