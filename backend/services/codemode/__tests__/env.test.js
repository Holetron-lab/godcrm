// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { codemodeEnvScrubbed, scrubCodemodeEnv } from '../env.js';

const names = [
  'POSTGRES_PASSWORD', 'POSTGRES_HOST', 'JWT_SECRET', 'SESSION_SECRET',
  'SECRETS_MASTER_KEY', 'MASTER_ENCRYPTION_KEY', 'TEST_API_KEY', 'TEST_TOKEN',
  'CODEMODE_HMAC_KEY', 'PATH',
];
const snapshot = Object.fromEntries(names.map((name) => [name, process.env[name]]));

afterEach(() => {
  for (const name of names) {
    if (snapshot[name] === undefined) delete process.env[name];
    else process.env[name] = snapshot[name];
  }
});

describe('codemode environment scrub', () => {
  it('removes database credentials, secrets, API keys and tokens only', () => {
    for (const name of names) process.env[name] = name === 'PATH' ? snapshot.PATH : 'secret';
    scrubCodemodeEnv();
    expect(process.env.POSTGRES_PASSWORD).toBeUndefined();
    expect(process.env.POSTGRES_HOST).toBeUndefined();
    expect(process.env.JWT_SECRET).toBeUndefined();
    expect(process.env.SESSION_SECRET).toBeUndefined();
    expect(process.env.SECRETS_MASTER_KEY).toBeUndefined();
    expect(process.env.MASTER_ENCRYPTION_KEY).toBeUndefined();
    expect(process.env.TEST_API_KEY).toBeUndefined();
    expect(process.env.TEST_TOKEN).toBeUndefined();
    expect(process.env.CODEMODE_HMAC_KEY).toBe('secret');
    expect(process.env.PATH).toBe(snapshot.PATH);
    expect(codemodeEnvScrubbed()).toBe(true);
  });
});
