// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { codemodeToolHandlers } from '../codemode-tools.js';

const original = process.env.CODEMODE_ENABLED;
afterEach(() => {
  if (original === undefined) delete process.env.CODEMODE_ENABLED;
  else process.env.CODEMODE_ENABLED = original;
});

describe('run_crm_script handler', () => {
  it('is disabled by default', async () => {
    delete process.env.CODEMODE_ENABLED;
    expect(await codemodeToolHandlers.run_crm_script({ code: 'return 1;' }, 1, {})).toEqual({ error: 'codemode_disabled' });
  });

  it('refuses nested execution', async () => {
    process.env.CODEMODE_ENABLED = 'true';
    expect(await codemodeToolHandlers.run_crm_script(
      { code: 'return 1;' }, 1, { codemode: { depth: 1 } },
    )).toEqual({ error: 'codemode_nested_forbidden' });
  });

  it('validates input at the tool boundary', async () => {
    process.env.CODEMODE_ENABLED = 'true';
    const result = await codemodeToolHandlers.run_crm_script({ code: '', timeout_ms: 90_000 }, 1, {});
    expect(result.error).toBe('invalid_arguments');
  });
});
