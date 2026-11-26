import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import crypto from 'node:crypto';
import { z } from 'zod';
import { createEnvelope, verifyEnvelope } from './protocol.js';
import { normalizeLimits } from './limits.js';

const MAX_MESSAGE_BYTES = 1024 * 1024;

const runSchema = z.object({
  type: z.literal('run'),
  run_id: z.string().min(1).max(64),
  code: z.string().min(1).max(100_000),
  limits: z.object({
    timeout_ms: z.number().optional(),
    memory_mb: z.number().optional(),
    max_tool_calls: z.number().optional(),
  }).optional(),
  tools: z.array(z.object({
    name: z.string().min(1).max(128),
    description: z.string().optional(),
    parameters: z.record(z.string(), z.unknown()).optional(),
  })).max(128),
  issued_at: z.number().int(),
});

const toolResultSchema = z.object({
  type: z.literal('tool_result'),
  run_id: z.string().min(1).max(64),
  call_id: z.string().min(1).max(64),
  result: z.unknown().optional(),
  error: z.unknown().optional(),
  issued_at: z.number().int(),
});

function createRunQueue(maximum, queueTimeoutMs) {
  let active = 0;
  const waiting = [];

  function launch(item) {
    active += 1;
    item.task().then(item.resolve, item.reject).finally(() => {
      active -= 1;
      const next = waiting.shift();
      if (next) {
        clearTimeout(next.timer);
        launch(next);
      }
    });
  }

  return (task) => new Promise((resolve, reject) => {
    const item = { task, resolve, reject, timer: null };
    if (active < maximum) {
      launch(item);
      return;
    }
    item.timer = setTimeout(() => {
      const index = waiting.indexOf(item);
      if (index >= 0) waiting.splice(index, 1);
      reject(Object.assign(new Error('Sandbox queue wait exceeded 30 seconds'), { name: 'codemode_busy' }));
    }, queueTimeoutMs);
    waiting.push(item);
  });
}

function normalizeError(error) {
  return {
    name: String(error?.name || 'codemode_host_error'),
    message: String(error?.message || error),
    stack_head: String(error?.stack || '').split('\n').slice(0, 5).join('\n'),
  };
}

export async function startSandboxServer({
  socketPath,
  key,
  driver,
  maxConcurrentRuns = 4,
  queueTimeoutMs = 30_000,
}) {
  if (typeof key !== 'string' || key.length < 32) throw new Error('CODEMODE_HMAC_KEY must contain at least 32 characters');
  fs.mkdirSync(path.dirname(socketPath), { recursive: true });
  if (fs.existsSync(socketPath)) {
    if (!fs.statSync(socketPath).isSocket()) throw new Error(`Refusing to replace non-socket path: ${socketPath}`);
    fs.unlinkSync(socketPath);
  }

  const queue = createRunQueue(maxConcurrentRuns, queueTimeoutMs);
  const connections = new Set();
  const startedAt = Date.now();
  let runsTotal = 0;
  let runsFailed = 0;

  const server = net.createServer((socket) => {
    connections.add(socket);
    socket.setEncoding('utf8');
    let buffer = '';
    let runId = null;
    const pending = new Map();

    const send = (body) => {
      if (!socket.destroyed && socket.writable) socket.write(`${JSON.stringify(createEnvelope(key, body))}\n`);
    };

    const callTool = (name, args) => new Promise((resolve, reject) => {
      const callId = crypto.randomUUID();
      pending.set(callId, { resolve, reject });
      send({ type: 'tool_call', run_id: runId, call_id: callId, name, args });
    });

    const execute = async (request) => {
      try {
        const outcome = await queue(async () => {
          runsTotal += 1;
          return driver.run({
            code: request.code,
            limits: normalizeLimits(request.limits),
            tools: request.tools,
            callTool,
          });
        });
        if (!outcome.ok) runsFailed += 1;
        send({ type: 'done', run_id: runId, ...outcome });
      } catch (error) {
        runsFailed += 1;
        send({
          type: 'done', run_id: runId, ok: false, result: null, logs: [],
          stats: { driver: driver.name, tool_calls: 0, wall_ms: 0, cpu_ms: 0, memory_peak_mb: 0 },
          error: normalizeError(error),
        });
      } finally {
        socket.end();
      }
    };

    socket.on('data', (chunk) => {
      buffer += chunk;
      if (Buffer.byteLength(buffer, 'utf8') > MAX_MESSAGE_BYTES) {
        socket.destroy();
        return;
      }
      let newline;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (!line) continue;
        let body;
        try {
          body = verifyEnvelope(key, JSON.parse(line));
        } catch {
          continue;
        }
        if (!body) continue;

        if (body.type === 'tool_result' && runId) {
          const parsed = toolResultSchema.safeParse(body);
          if (!parsed.success || parsed.data.run_id !== runId) continue;
          const call = pending.get(parsed.data.call_id);
          if (!call) continue;
          pending.delete(parsed.data.call_id);
          if (parsed.data.error !== undefined) {
            const error = new Error(String(parsed.data.error?.message || parsed.data.error));
            error.name = String(parsed.data.error?.name || 'codemode_tool_error');
            call.reject(error);
          } else {
            call.resolve(parsed.data.result);
          }
          continue;
        }

        if (body.type === 'run' && !runId) {
          const parsed = runSchema.safeParse(body);
          if (!parsed.success) continue;
          runId = parsed.data.run_id;
          void execute(parsed.data);
        }
      }
    });

    socket.on('error', () => {});
    socket.on('close', () => {
      connections.delete(socket);
      for (const call of pending.values()) call.reject(new Error('codemode_host_unavailable'));
      pending.clear();
    });
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(socketPath, resolve);
  });
  fs.chmodSync(socketPath, 0o660);

  return {
    stats: () => ({
      pid: process.pid,
      uptime: Math.floor((Date.now() - startedAt) / 1000),
      runs_total: runsTotal,
      runs_failed: runsFailed,
    }),
    close: () => new Promise((resolve) => {
      for (const socket of connections) socket.destroy();
      server.close(() => {
        if (fs.existsSync(socketPath) && fs.statSync(socketPath).isSocket()) fs.unlinkSync(socketPath);
        resolve();
      });
    }),
  };
}
