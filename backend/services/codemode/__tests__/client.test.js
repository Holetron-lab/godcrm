// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runCrmScript, resolveScriptTools } from '../client.js';
import { startSandboxServer } from '../host.js';
import { QuickJsDriver } from '../drivers/quickjs.js';

const key = 'c'.repeat(64);
const active = [];
const queryTool = {
  type: 'function',
  function: {
    name: 'query_table_data',
    description: 'Read rows',
    parameters: { type: 'object', properties: { table_id: { type: 'number' } } },
  },
};

async function fixture() {
  fs.mkdirSync(path.join(process.cwd(), '.tmp'), { recursive: true });
  const directory = fs.mkdtempSync(path.join(process.cwd(), '.tmp', 'codemode-client-'));
  const socketPath = path.join(directory, 'sandbox.sock');
  const server = await startSandboxServer({ socketPath, key, driver: new QuickJsDriver() });
  active.push({ server, directory });
  return { socketPath };
}

afterEach(async () => {
  while (active.length) {
    const { server, directory } = active.pop();
    await server.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('resolveScriptTools', () => {
  it('exposes the catalog while execution remains subject to the caller allowlist', () => {
    const tools = resolveScriptTools({ allowedTools: [queryTool, {
      type: 'function', function: { name: 'run_crm_script', parameters: { type: 'object' } },
    }] });
    expect(tools.map((tool) => tool.name)).toContain('query_table_data');
    expect(tools.map((tool) => tool.name)).toContain('delete_table');
    expect(tools.map((tool) => tool.name)).not.toContain('run_crm_script');
  });

  it('excludes nested execution when the feature flag is enabled', () => {
    const script = `
      const { resolveScriptTools } = await import('./backend/services/codemode/client.js');
      console.log(JSON.stringify(resolveScriptTools().map((tool) => tool.name)));
    `;
    const output = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
      cwd: process.cwd(),
      env: { ...process.env, CODEMODE_ENABLED: 'true' },
      encoding: 'utf8',
    });
    const names = JSON.parse(output);
    expect(names).toContain('query_table_data');
    expect(names).not.toContain('run_crm_script');
  });
});

describe('runCrmScript', () => {
  it('executes inner tools with caller context and codemode audit correlation', async () => {
    const { socketPath } = await fixture();
    const executeTool = vi.fn(async () => ({ rows: [{ id: 1 }, { id: 2 }, { id: 3 }] }));
    const counters = { tool_calls: 1 };
    const outcome = await runCrmScript({
      code: 'return (await crm.query_table_data({ table_id: 1708, limit: 3 })).rows.length;',
      context: { allowedTools: [queryTool], source: 'test', principal: { kind: 'agent' }, counters },
      userId: 7,
      socketPath,
      hmacKey: key,
      executeTool,
    });

    expect(outcome).toMatchObject({ ok: true, result: 3, truncated: false });
    expect(executeTool).toHaveBeenCalledWith('query_table_data', { table_id: 1708, limit: 3 }, 7, expect.objectContaining({
      source: 'test',
      principal: { kind: 'agent' },
      codemode: expect.objectContaining({ depth: 1, run_id: expect.any(String), call_id: expect.any(String) }),
    }));
    expect(counters.tool_calls).toBe(2);
  });

  it('routes an allowlist refusal through executeTool for gated auditing', async () => {
    const { socketPath } = await fixture();
    const executeTool = vi.fn(async () => ({ error: 'tool_not_permitted' }));
    const outcome = await runCrmScript({
      code: 'return await crm.delete_table({ table_id: 1 });',
      context: { allowedTools: [queryTool], source: 'test' },
      userId: 7,
      socketPath,
      hmacKey: key,
      executeTool,
    });
    expect(outcome).toMatchObject({ ok: true, result: { error: 'tool_not_permitted' } });
    expect(executeTool).toHaveBeenCalledWith('delete_table', { table_id: 1 }, 7, expect.objectContaining({
      allowedTools: [queryTool],
      codemode: expect.objectContaining({ depth: 1 }),
    }));
  });

  it('refuses the 51st inner call without executing it', async () => {
    const { socketPath } = await fixture();
    const executeTool = vi.fn(async (_name, args) => ({ value: args.value }));
    const outcome = await runCrmScript({
      code: `
        let last;
        for (let i = 0; i < 51; i += 1) last = await crm.query_table_data({ table_id: 1, value: i });
        return last;
      `,
      context: { allowedTools: [queryTool] },
      userId: 7,
      socketPath,
      hmacKey: key,
      executeTool,
    });
    expect(outcome).toMatchObject({ ok: true, result: { error: 'codemode_tool_call_limit' } });
    expect(executeTool).toHaveBeenCalledTimes(50);
  });

  it('truncates results at the client boundary', async () => {
    const { socketPath } = await fixture();
    const outcome = await runCrmScript({
      code: "return 'x'.repeat(70000);",
      context: { allowedTools: [queryTool] },
      userId: 7,
      socketPath,
      hmacKey: key,
      executeTool: vi.fn(),
    });
    expect(outcome.ok).toBe(true);
    expect(outcome.truncated).toBe(true);
    expect(Buffer.byteLength(outcome.result, 'utf8')).toBeLessThanOrEqual(64 * 1024);
  });

  it('returns codemode_nested_forbidden for a nested script call', () => {
    const script = `
      const fs = await import('node:fs');
      const { runCrmScript } = await import('./backend/services/codemode/client.js');
      const { startSandboxServer } = await import('./backend/services/codemode/host.js');
      const { QuickJsDriver } = await import('./backend/services/codemode/drivers/quickjs.js');
      const directory = fs.mkdtempSync('.tmp/codemode-nested-');
      const socketPath = directory + '/sandbox.sock';
      const hmacKey = 'c'.repeat(64);
      const server = await startSandboxServer({ socketPath, key: hmacKey, driver: new QuickJsDriver() });
      try {
        const outcome = await runCrmScript({
          code: "return await crm.run_crm_script({ code: 'return 1;' });",
          context: {}, userId: 1, socketPath, hmacKey,
          executeTool: async () => { throw new Error('nested script executed'); },
        });
        console.log(JSON.stringify(outcome));
      } finally {
        await server.close();
        fs.rmSync(directory, { recursive: true, force: true });
      }
    `;
    const output = execFileSync(process.execPath, ['--no-node-snapshot', '--input-type=module', '-e', script], {
      cwd: process.cwd(),
      env: { ...process.env, CODEMODE_ENABLED: 'true' },
      encoding: 'utf8',
    });
    expect(JSON.parse(output)).toMatchObject({ ok: true, result: { error: 'codemode_nested_forbidden' } });
  });
});
