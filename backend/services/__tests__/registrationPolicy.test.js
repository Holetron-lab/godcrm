// ADR-183 Block F — resolveRegistrationPolicy unit tests (pure, no DB).
import { describe, it, expect, afterEach } from 'vitest';
import {
  resolveRegistrationPolicy,
  getInstanceDefault,
  REGISTRATION_PRESETS,
} from '../registrationPolicy.js';

const ENV_KEY = 'REGISTRATION_DEFAULT';

describe('ADR-183 Block F — registration policy resolver', () => {
  afterEach(() => {
    delete process.env[ENV_KEY];
  });

  it('unset env → standard preset (pre-ADR-183 behaviour: user / open / self-serve)', () => {
    delete process.env[ENV_KEY];
    const p = resolveRegistrationPolicy();
    expect(p.default_role).toBe('user');
    expect(p.signup_mode).toBe('open');
    expect(p.allow_self_space_create).toBe(true);
    expect(getInstanceDefault()).toEqual(REGISTRATION_PRESETS.standard);
  });

  it('REGISTRATION_DEFAULT=community → community front door (viewer / open)', () => {
    process.env[ENV_KEY] = 'community';
    const p = resolveRegistrationPolicy();
    expect(p.default_role).toBe('viewer');
    expect(p.signup_mode).toBe('open');
    expect(p.allow_self_space_create).toBe(false);
  });

  it('unknown preset name → standard (safe, boxes unchanged)', () => {
    process.env[ENV_KEY] = 'nonsense-preset';
    expect(resolveRegistrationPolicy().default_role).toBe('user');
  });

  it('preset name is case/whitespace-insensitive', () => {
    process.env[ENV_KEY] = '  Community  ';
    expect(resolveRegistrationPolicy().default_role).toBe('viewer');
  });

  it('per-space override wins over instance default', () => {
    process.env[ENV_KEY] = 'community'; // instance default = viewer
    const space = { settings: { registration: { default_role: 'editor', signup_mode: 'invite' } } };
    const p = resolveRegistrationPolicy(space);
    expect(p.default_role).toBe('editor');
    expect(p.signup_mode).toBe('invite');
    // unspecified keys fall through to the instance default
    expect(p.allow_self_space_create).toBe(false);
  });

  it('malformed / hostile override keys are ignored (trust boundary)', () => {
    const space = { settings: { registration: { default_role: 'superadmin', signup_mode: 'yolo', allow_self_space_create: 'yes' } } };
    const p = resolveRegistrationPolicy(space); // no env → standard base
    expect(p.default_role).toBe('user');        // 'superadmin' rejected
    expect(p.signup_mode).toBe('open');         // 'yolo' rejected
    expect(p.allow_self_space_create).toBe(true); // 'yes' (string) rejected
  });

  it('null / empty space context → instance default (no crash)', () => {
    expect(() => resolveRegistrationPolicy(null)).not.toThrow();
    expect(() => resolveRegistrationPolicy({})).not.toThrow();
    expect(resolveRegistrationPolicy({ settings: null }).default_role).toBe('user');
  });
});
