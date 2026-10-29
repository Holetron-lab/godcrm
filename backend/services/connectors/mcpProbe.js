/**
 * Real connection check for a stdio MCP server.
 *
 * Spawns the launcher, runs the MCP handshake (initialize → notifications/
 * initialized → tools/list) over newline-delimited JSON-RPC and reports what
 * came back. No SDK: two requests and a line reader are the whole protocol
 * surface we need, and the result must be honest about *why* it failed —
 * a timeout, a launcher that died, or a reply that was not MCP at all.
 *
 * The child is always killed at the end; a probe never leaves a session open.
 */

import { spawn } from 'node:child_process';
import readline from 'node:readline';

const PROTOCOL_VERSION = '2024-11-05';

/**
 * @param {object} opts
 * @param {string} opts.command      launcher path (stdio MCP server)
 * @param {string[]} [opts.args]
 * @param {Record<string,string>} [opts.env]  merged over process.env
 * @param {number} [opts.timeoutMs=15000]
 * @returns {Promise<{ok:boolean, latency_ms:number, tool_count?:number,
 *   server_name?:string, server_version?:string, server_info?:object,
 *   error?:string, error_code?:'spawn'|'timeout'|'exit'|'protocol'}>}
 */
export function probeStdioMcp({ command, args = [], env = {}, timeoutMs = 15_000 }) {
  const startedAt = Date.now();
  return new Promise((resolve) => {
    let settled = false;
    let child;
    let stderr = '';
    const pending = new Map(); // id → handler

    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (child && child.exitCode === null && !child.killed) {
        child.kill('SIGTERM');
        setTimeout(() => {
          if (child.exitCode === null) child.kill('SIGKILL');
        }, 2000).unref();
      }
      resolve({ latency_ms: Date.now() - startedAt, ...result });
    };

    const timer = setTimeout(
      () => finish({ ok: false, error_code: 'timeout', error: `No MCP response within ${timeoutMs} ms` }),
      timeoutMs
    );

    try {
      child = spawn(command, args, {
        env: { ...process.env, ...env },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (err) {
      return finish({ ok: false, error_code: 'spawn', error: `spawn failed: ${err.message}` });
    }

    child.on('error', (err) =>
      finish({ ok: false, error_code: 'spawn', error: `spawn failed: ${err.message}` })
    );
    child.stderr.on('data', (d) => {
      stderr = (stderr + d.toString()).slice(-2000);
    });
    child.on('exit', (code, signal) => {
      if (!settled) {
        finish({
          ok: false,
          error_code: 'exit',
          error: `MCP launcher exited (${signal || `code ${code}`}) before answering` +
            (stderr.trim() ? `: ${stderr.trim().split('\n').pop()}` : ''),
        });
      }
    });

    let nextId = 0;
    const send = (method, params, onResult) => {
      const msg = { jsonrpc: '2.0', method };
      if (params !== undefined) msg.params = params;
      if (onResult) {
        msg.id = ++nextId;
        pending.set(msg.id, onResult);
      }
      child.stdin.write(JSON.stringify(msg) + '\n');
    };

    readline.createInterface({ input: child.stdout }).on('line', (line) => {
      if (settled || !line.trim()) return;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        return finish({ ok: false, error_code: 'protocol', error: `Non-JSON output from MCP: ${line.slice(0, 200)}` });
      }
      const handler = msg && msg.id != null ? pending.get(msg.id) : null;
      if (!handler) return; // notification or unrelated id
      pending.delete(msg.id);
      if (msg.error) {
        return finish({ ok: false, error_code: 'protocol', error: `MCP error: ${msg.error.message || JSON.stringify(msg.error)}` });
      }
      handler(msg.result || {});
    });

    send(
      'initialize',
      {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 'godcrm-connector-check', version: '1' },
      },
      (init) => {
        const info = init.serverInfo || {};
        send('notifications/initialized', {});
        send('tools/list', {}, (list) => {
          const tools = Array.isArray(list.tools) ? list.tools : [];
          finish({
            ok: true,
            tool_count: tools.length,
            server_name: info.name || null,
            server_version: info.version || null,
            server_info: info,
          });
        });
      }
    );
  });
}
