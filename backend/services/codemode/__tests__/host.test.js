// @vitest-environment node
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createEnvelope, verifyEnvelope } from '../protocol.js';
import { startSandboxServer } from '../host.js';
import { QuickJsDriver } from '../drivers/quickjs.js';

const key = 'b'.repeat(64);
const active = [];

async function fixture(driver = new QuickJsDriver(), options = {}) {
  fs.mkdirSync(path.join(process.cwd(), '.tmp'), { recursive: true });
  const directory = fs.mkdtempSync(path.join(process.cwd(), '.tmp', 'codemode-host-'));
  const socketPath = path.join(directory, 'sandbox.sock');
  const server = await startSandboxServer({ socketPath, key, driver, ...options });
  const handle = { server, directory, socketPath };
  active.push(handle);
  return handle;
}

function connect({ socketPath, run, onToolCall }) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath);
    let buffer = '';
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error('host test timed out'));
    }, 5_000);
    socket.setEncoding('utf8');
    socket.on('connect', () => socket.write(`${JSON.stringify(createEnvelope(key, run))}\n`));
    socket.on('data', (chunk) => {
      buffer += chunk;
      let newline;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        const body = verifyEnvelope(key, JSON.parse(line));
        if (body.type === 'tool_call') {
          const result = onToolCall(body);
          socket.write(`${JSON.stringify(createEnvelope(key, {
            type: 'tool_result', run_id: body.run_id, call_id: body.call_id, result,
          }))}\n`);
        } else if (body.type === 'done') {
          clearTimeout(timer);
          socket.end();
          resolve(body);
        }
      }
    });
    socket.on('error', reject);
  });
}

afterEach(async () => {
  while (active.length) {
    const { server, directory } = active.pop();
    await server.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('codemode sandbox host', () => {
  it('runs QuickJS and marshals a tool call over the signed socket', async () => {
    const current = await fixture();
    const done = await connect({
      ...current,
      run: {
        type: 'run', run_id: 'run-1', code: 'const out = await crm.echo({ value: 21 }); return out.value * 2;',
        limits: { timeout_ms: 1_000, memory_mb: 64, max_tool_calls: 5 },
        tools: [{ name: 'echo', description: 'Echo', parameters: { type: 'object' } }],
      },
      onToolCall: (call) => {
        expect(call).toMatchObject({ name: 'echo', args: { value: 21 }, run_id: 'run-1' });
        return { value: call.args.value };
      },
    });
    expect(done).toMatchObject({ ok: true, result: 42, run_id: 'run-1' });
    expect(done.stats.driver).toBe('quickjs');
    expect(fs.statSync(current.socketPath).mode & 0o777).toBe(0o660);
  });

  it('times out queued work instead of exceeding the concurrency bound', async () => {
    const driver = {
      name: 'fake',
      run: async ({ code }) => {
        await new Promise((resolve) => setTimeout(resolve, 100));
        return { ok: true, result: code, logs: [], stats: { driver: 'fake', tool_calls: 0 } };
      },
    };
    const current = await fixture(driver, { maxConcurrentRuns: 1, queueTimeoutMs: 20 });
    const run = (id) => ({
      type: 'run', run_id: id, code: id,
      limits: { timeout_ms: 1_000, memory_mb: 64, max_tool_calls: 1 }, tools: [],
    });
    const [first, second] = await Promise.all([
      connect({ ...current, run: run('first') }),
      connect({ ...current, run: run('second') }),
    ]);
    expect(first.ok).toBe(true);
    expect(second).toMatchObject({ ok: false, error: { name: 'codemode_busy' } });
  });
});
