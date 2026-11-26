// @vitest-environment node
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { IsolatedVmDriver } from '../drivers/isolated-vm.js';

const supported = Number(process.versions.node.split('.')[0]) >= 24;
const tools = [
  {
    name: 'query_table_data',
    description: 'Read rows',
    parameters: { type: 'object', properties: { table_id: { type: 'number' } } },
  },
];

describe.skipIf(!supported)('IsolatedVmDriver', () => {
  let driver;

  beforeAll(async () => {
    driver = await IsolatedVmDriver.create();
  });

  async function run(code, options = {}) {
    return driver.run({
      code,
      tools,
      limits: { timeout_ms: 1_000, memory_mb: 64, max_tool_calls: 50, ...options.limits },
      callTool: options.callTool || vi.fn(async () => ({ rows: [{ id: 1 }, { id: 2 }] })),
    });
  }

  it('probes arithmetic and a host call', async () => {
    const probe = await driver.probe();
    expect(probe.ok).toBe(true);
    expect(probe.version).toBeTruthy();
    expect(probe.abi).toBe(process.versions.modules);
  });

  it('composes awaited CRM calls and returns JSON values', async () => {
    const callTool = vi.fn(async () => ({ rows: [{ id: 1 }, { id: 2 }] }));
    const outcome = await run(`
      const response = await crm.query_table_data({ table_id: 1708, limit: 2 });
      console.log('rows', response.rows.length);
      return { count: response.rows.length, schema: crm.describe('query_table_data').parameters.type };
    `, { callTool });

    expect(outcome).toMatchObject({
      ok: true,
      result: { count: 2, schema: 'object' },
      logs: ['rows 2'],
      stats: { driver: 'isolated-vm', tool_calls: 1 },
    });
    expect(callTool).toHaveBeenCalledWith('query_table_data', { table_id: 1708, limit: 2 });
  });

  it('refuses the 51st inner call without executing it', async () => {
    const callTool = vi.fn(async (_name, args) => ({ value: args.value }));
    const outcome = await run(`
      let last;
      for (let i = 0; i < 51; i += 1) last = await crm.query_table_data({ table_id: 1, value: i });
      return last;
    `, { callTool });
    expect(outcome).toMatchObject({ ok: true, result: { error: 'codemode_tool_call_limit' } });
    expect(callTool).toHaveBeenCalledTimes(50);
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

  it('supports a capped setTimeout', async () => {
    const outcome = await run('let value = 0; setTimeout(() => { value = 42; }, 1); return value;');
    expect(outcome.result).toBe(42);
  });

  it('kills an infinite loop at the deadline and remains usable', async () => {
    const timedOut = await run('while (true) {}', { limits: { timeout_ms: 50 } });
    expect(timedOut.ok).toBe(false);
    expect(timedOut.error.name).toBe('codemode_timeout');
    expect(await run('return 1 + 1;')).toMatchObject({ ok: true, result: 2 });
  });

  it('enforces the isolate memory limit', async () => {
    const outcome = await run(`
      const chunks = [];
      while (true) chunks.push(new Array(100000).fill('x'));
    `, { limits: { timeout_ms: 2_000, memory_mb: 8 } });
    expect(outcome.ok).toBe(false);
    expect(['codemode_memory', 'codemode_timeout']).toContain(outcome.error.name);
  }, 10_000);
});
