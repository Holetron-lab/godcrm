// ADR-188 F1 — runtime registration policy layer unit tests.
// Pure/injected fetcher — no DB (ADR-0009): the `_app_settings` read is swapped
// via __setRuntimeFetcher so these run against no combat master.
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import {
  sanitizeRuntimeConfig,
  getEffectiveRegistrationPolicy,
  invalidateRegistrationCache,
  __setRuntimeFetcher,
  __resetRuntimeFetcher,
} from '../registrationPolicy.js';

const ENV_KEY = 'REGISTRATION_DEFAULT';

afterEach(() => {
  delete process.env[ENV_KEY];
  __resetRuntimeFetcher();
  invalidateRegistrationCache();
});

describe('ADR-188 F1 — sanitizeRuntimeConfig (trust boundary)', () => {
  it('keeps only valid signup_mode / default_role', () => {
    const c = sanitizeRuntimeConfig({ signup_mode: 'invite', default_role: 'viewer' });
    expect(c.signup_mode).toBe('invite');
    expect(c.default_role).toBe('viewer');
  });

  it('rejects hostile / out-of-contract scalars', () => {
    const c = sanitizeRuntimeConfig({ signup_mode: 'yolo', default_role: 'owner' });
    expect(c.signup_mode).toBeUndefined();   // 'yolo' dropped
    expect(c.default_role).toBeUndefined();  // 'owner' not a front-door role
  });

  it('filters, coerces and de-dupes auto_join entries', () => {
    const c = sanitizeRuntimeConfig({
      auto_join: [
        { space_id: 11, access_level: 'editor' },
        { space_id: '11', access_level: 'admin' },   // dup id → dropped
        { space_id: 12, access_level: 'root' },       // bad level → dropped
        { space_id: 0, access_level: 'viewer' },      // non-positive → dropped
        { space_id: 13, access_level: 'viewer' },
      ],
    });
    expect(c.auto_join).toEqual([
      { space_id: 11, access_level: 'editor' },
      { space_id: 13, access_level: 'viewer' },
    ]);
  });

  it('garbage / non-object → empty fail-closed shape', () => {
    expect(sanitizeRuntimeConfig(null).auto_join).toEqual([]);
    expect(sanitizeRuntimeConfig('nope').signup_mode).toBeUndefined();
    expect(sanitizeRuntimeConfig([1, 2]).default_role).toBeUndefined();
  });
});

describe('ADR-188 F1 — getEffectiveRegistrationPolicy (runtime layering)', () => {
  beforeEach(() => invalidateRegistrationCache());

  it('runtime blob overrides the env preset', async () => {
    process.env[ENV_KEY] = 'community'; // env default: viewer / open
    __setRuntimeFetcher(async () => ({ signup_mode: 'closed', default_role: 'user', auto_join: [] }));
    const p = await getEffectiveRegistrationPolicy(null);
    expect(p.default_role).toBe('user');    // runtime wins over env 'viewer'
    expect(p.signup_mode).toBe('closed');   // runtime wins over env 'open'
  });

  it('no runtime blob → falls through to the env preset', async () => {
    process.env[ENV_KEY] = 'community';
    __setRuntimeFetcher(async () => null);
    const p = await getEffectiveRegistrationPolicy(null);
    expect(p.default_role).toBe('viewer');
    expect(p.signup_mode).toBe('open');
    expect(p.auto_join).toEqual([]);
  });

  it('per-space override beats the runtime blob (most specific wins)', async () => {
    __setRuntimeFetcher(async () => ({ default_role: 'viewer', signup_mode: 'closed' }));
    const space = { settings: { registration: { default_role: 'editor' } } };
    const p = await getEffectiveRegistrationPolicy(space);
    expect(p.default_role).toBe('editor');  // per-space wins
    expect(p.signup_mode).toBe('closed');   // undeclared per-space → runtime
  });

  it('auto_join from the runtime blob is carried through', async () => {
    __setRuntimeFetcher(async () => ({ auto_join: [{ space_id: 11, access_level: 'editor' }] }));
    const p = await getEffectiveRegistrationPolicy(null);
    expect(p.auto_join).toEqual([{ space_id: 11, access_level: 'editor' }]);
  });

  it('fetcher throwing → fail-safe to env preset, never crashes', async () => {
    process.env[ENV_KEY] = 'community';
    __setRuntimeFetcher(async () => { throw new Error('DB down'); });
    const p = await getEffectiveRegistrationPolicy(null);
    expect(p.default_role).toBe('viewer'); // degraded to env preset
  });
});
