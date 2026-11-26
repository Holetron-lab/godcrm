// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { QuickJsDriver } from '../drivers/quickjs.js';

const tools = [
  {
    name: 'query_table_data',
    description: 'Read rows',
    parameters: { type: 'object', properties: { table_id: { type: 'number' } } },
  },
];

async function run(code, options = {}) {
  const driver = new QuickJsDriver();
  return driver.run({
    code,
    tools,
    limits: { timeout_ms: 1_000, memory_mb: 64, max_tool_calls: 50, ...options.limits },
    callTool: options.callTool || vi.fn(async () => ({ rows: [{ id: 1 }, { id: 2 }] })),
  });
}

describe('QuickJsDriver', () => {
  it('probes arithmetic and a host call', async () => {
    const probe = await new QuickJsDriver().probe();
    expect(probe.ok).toBe(true);
    expect(probe.version).toBeTruthy();
  });

  it('composes awaited CRM calls and returns JSON values', async () => {
    const callTool = vi.fn(async () => ({ rows: [{ id: 1 }, { id: 2 }] }));
    const outcome = await run(`
      const response = await crm.query_table_data({ table_id: 1708, limit: 2 });
      console.log('rows', response.rows.length);
      return { count: response.rows.length, schema: crm.describe('query_table_data').parameters.type };
    `, { callTool });

    expect(outcome.ok).toBe(true);
    expect(outcome.result).toEqual({ count: 2, schema: 'object' });
    expect(outcome.logs).toEqual(['rows 2']);
    expect(callTool).toHaveBeenCalledWith('query_table_data', { table_id: 1708, limit: 2 });
    expect(outcome.stats).toMatchObject({ driver: 'quickjs', tool_calls: 1 });
  });

  it('passes structured tool errors back to the script', async () => {
    const outcome = await run('return await crm.query_table_data({ table_id: 1 });', {
      callTool: async () => ({ error: 'tool_not_permitted' }),
    });
    expect(outcome.ok).toBe(true);
    expect(outcome.result).toEqual({ error: 'tool_not_permitted' });
  });

  it('refuses nested execution without advertising the nested tool', async () => {
    const outcome = await run(`
      return {
        nested: await crm.run_crm_script({ code: 'return 1;' }),
        advertised: crm.tools().some((tool) => tool.name === 'run_crm_script'),
      };
    `);
    expect(outcome).toMatchObject({
      ok: true,
      result: { nested: { error: 'codemode_nested_forbidden' }, advertised: false },
    });
  });

  it('exposes no Node or network globals', async () => {
    const outcome = await run('return [typeof process, typeof require, typeof fetch];');
    expect(outcome.result).toEqual(['undefined', 'undefined', 'undefined']);
  });

  it('supports a capped setTimeout without host timers in the guest', async () => {
    const outcome = await run(`
      let value = 0;
      await new Promise((resolve) => setTimeout(() => { value = 42; resolve(); }, 1));
      return value;
    `);
    expect(outcome.result).toBe(42);
  });

  it('kills an infinite loop at the deadline and remains usable', async () => {
    const driver = new QuickJsDriver();
    const timedOut = await driver.run({
      code: 'while (true) {}',
      tools,
      limits: { timeout_ms: 50, memory_mb: 64, max_tool_calls: 50 },
      callTool: vi.fn(),
    });
    expect(timedOut.ok).toBe(false);
    expect(timedOut.error.name).toBe('codemode_timeout');

    const next = await driver.run({
      code: 'return 1 + 1;',
      tools,
      limits: { timeout_ms: 1_000, memory_mb: 64, max_tool_calls: 50 },
      callTool: vi.fn(),
    });
    expect(next).toMatchObject({ ok: true, result: 2 });
  });

  it('enforces the runtime memory limit', async () => {
    const outcome = await run(`
      const chunks = [];
      while (true) chunks.push(new Array(100000).fill('x'));
    `, { limits: { timeout_ms: 2_000, memory_mb: 8 } });
    expect(outcome.ok).toBe(false);
    expect(['codemode_memory', 'codemode_timeout']).toContain(outcome.error.name);
  }, 10_000);
});
