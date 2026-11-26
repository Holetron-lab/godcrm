import crypto from 'node:crypto';
import net from 'node:net';
import { z } from 'zod';
import { AGENT_TOOLS } from '../agent-tools/tool-definitions/index.js';
import { normalizeLimits, truncateResult } from './limits.js';
import { createEnvelope, verifyEnvelope } from './protocol.js';

export const CODEMODE_EXCLUDED = new Set([
  'run_crm_script', 'run_code', 'validate_code', 'run_code_loop', 'manage_plan',
  'dispatch_task', 'supervisor_decide', 'read_file', 'write_file', 'edit_file',
  'list_directory', 'search_files',
]);

const toolCallSchema = z.object({
  type: z.literal('tool_call'),
  run_id: z.string(),
  call_id: z.string(),
  name: z.string(),
  args: z.unknown(),
  issued_at: z.number().int(),
});

function failure(name, message, toolCalls = 0) {
  return {
    ok: false,
    result: null,
    logs: [],
    stats: { driver: null, tool_calls: toolCalls, wall_ms: 0, cpu_ms: 0, memory_peak_mb: 0 },
    error: { name, message, stack_head: '' },
  };
}

export function resolveScriptTools() {
  return AGENT_TOOLS.map((definition) => {
    const fn = definition?.function || definition;
    return {
      name: fn?.name,
      description: fn?.description || '',
      parameters: fn?.parameters || { type: 'object', properties: {} },
    };
  }).filter((tool) => tool.name && !CODEMODE_EXCLUDED.has(tool.name));
}

export async function runCrmScript({
  code,
  limits: requestedLimits,
  context = {},
  userId,
  socketPath = process.env.CODEMODE_SOCKET || '/run/godcrm/sandbox.sock',
  hmacKey = process.env.CODEMODE_HMAC_KEY,
  executeTool: injectedExecuteTool,
}) {
  const limits = normalizeLimits(requestedLimits);
  if (!hmacKey || hmacKey.length < 32) return failure('codemode_not_configured', 'CODEMODE_HMAC_KEY is missing or too short');
  const tools = resolveScriptTools(context);
  const toolNames = new Set(tools.map((tool) => tool.name));
  const runId = crypto.randomUUID();
  let executeTool = injectedExecuteTool;
  if (!executeTool) ({ executeTool } = await import('../agent-tools/executor.js'));

  return new Promise((resolve) => {
    const socket = net.createConnection(socketPath);
    let buffer = '';
    let settled = false;
    let toolCalls = 0;
    const timer = setTimeout(() => {
      finish(failure('codemode_timeout', `Code Mode exceeded ${limits.timeout_ms} ms`, toolCalls));
    }, limits.timeout_ms + 2_000);

    const finish = (outcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      if (!outcome.ok) {
        resolve(outcome);
        return;
      }
      const truncated = truncateResult(outcome.result);
      resolve({ ...outcome, result: truncated.result, truncated: truncated.truncated });
    };

    const send = (body) => {
      if (!socket.destroyed && socket.writable) socket.write(`${JSON.stringify(createEnvelope(hmacKey, body))}\n`);
    };

    const handleToolCall = async (body) => {
      const parsed = toolCallSchema.safeParse(body);
      if (!parsed.success || parsed.data.run_id !== runId) return;
      const { call_id: callId, name, args } = parsed.data;
      let result;
      let thrown;
      if (name === 'run_crm_script') {
        result = { error: 'codemode_nested_forbidden' };
      } else if (!toolNames.has(name)) {
        result = { error: 'tool_not_permitted', tool: name };
      } else if (toolCalls >= limits.max_tool_calls) {
        result = { error: 'codemode_tool_call_limit' };
      } else {
        toolCalls += 1;
        try {
          result = await executeTool(name, args, userId, {
            ...context,
            codemode: { run_id: runId, call_id: callId, depth: 1 },
          });
          if (context.counters && typeof context.counters === 'object') {
            context.counters.tool_calls = (Number(context.counters.tool_calls) || 0) + 1;
          }
        } catch (error) {
          thrown = { name: String(error?.name || 'Error'), message: String(error?.message || error) };
        }
      }
      send({ type: 'tool_result', run_id: runId, call_id: callId, ...(thrown ? { error: thrown } : { result }) });
    };

    socket.setEncoding('utf8');
    socket.on('connect', () => send({
      type: 'run', run_id: runId, code, limits, tools,
    }));
    socket.on('data', (chunk) => {
      buffer += chunk;
      if (Buffer.byteLength(buffer, 'utf8') > 1024 * 1024) {
        finish(failure('codemode_protocol_error', 'Sandbox message exceeded 1 MB', toolCalls));
        return;
      }
      let newline;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (!line) continue;
        let body;
        try {
          body = verifyEnvelope(hmacKey, JSON.parse(line));
        } catch {
          finish(failure('codemode_protocol_error', 'Invalid sandbox JSON', toolCalls));
          return;
        }
        if (!body || body.run_id !== runId) {
          finish(failure('codemode_protocol_error', 'Invalid sandbox envelope', toolCalls));
          return;
        }
        if (body.type === 'tool_call') {
          void handleToolCall(body);
        } else if (body.type === 'done') {
          finish({ ...body, truncated: false });
          return;
        }
      }
    });
    socket.on('error', (error) => {
      finish(failure('codemode_host_unavailable', error.message, toolCalls));
    });
    socket.on('close', () => {
      finish(failure('codemode_host_unavailable', 'Sandbox host closed the connection', toolCalls));
    });
  });
}
