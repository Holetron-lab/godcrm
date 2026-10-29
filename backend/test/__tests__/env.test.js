import { describe, test, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

describe('committed test contour', () => {
  test.each([undefined, '0', '1'])('pins permission mode regardless of ambient %s', (ambient) => {
    const loader = resolve(dirname(fileURLToPath(import.meta.url)), '../env.js');
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
      await import(${JSON.stringify(loader)});
      process.stdout.write(process.env.AGENT_PERMS_FAIL_CLOSED ?? 'unset');
    `], {
      env: { ...process.env, AGENT_PERMS_FAIL_CLOSED: ambient },
      encoding: 'utf8',
    });
    expect(child.status, child.stderr).toBe(0);
    expect(child.stdout).toBe('0');
  });
});
