/** Transport only. No shell, Docker socket, browser or agent-selected paths. */
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import crypto from 'node:crypto';
import { z } from 'zod';
import { signBody } from './stagingExecutionBroker.js';
import { OpsDenied } from './opsBroker.js';
import { browserPinsSchema } from './stagingBrowserContract.js';

const ROOT = '/opt/godcrm-staging-browser';
const KEY = '/etc/godcrm-staging-browser/channel.key';
const SOCKET = '/run/godcrm-staging-browser/worker.sock';

// All ancestors must be root-owned, non-symlink and not writable by group/other.
function trustedPath(file, privateFile = false) {
  for (let part = file; part !== '/'; part = path.dirname(part)) {
    const st = fs.lstatSync(part);
    if (st.isSymbolicLink() || st.uid !== 0 || (st.mode & (part === file && privateFile ? 0o077 : 0o022))) {
      throw new OpsDenied('installation_untrusted', 503);
    }
  }
}

export function browserInstallation() {
  try {
    const manifest = `${ROOT}/manifest.json`;
    trustedPath(manifest); trustedPath(KEY, true); trustedPath(SOCKET);
    if (!fs.statSync(SOCKET).isSocket() || fs.statSync(manifest).size > 16384 || fs.statSync(KEY).size > 256) throw new Error('shape');
    const pins = browserPinsSchema.parse(JSON.parse(fs.readFileSync(manifest, 'utf8')));
    const key = fs.readFileSync(KEY, 'utf8').trim();
    if (!/^[a-f0-9]{64}$/.test(key)) throw new Error('key');
    return { pins, key, socket: SOCKET };
  } catch {
    throw new OpsDenied('browser_profile_unavailable', 503);
  }
}

/** One bounded signed exchange. Worker treats EOF as revocation for run RPCs. */
export function browserExchange(installation, payload, { signal, timeoutMs = 5000 } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new OpsDenied('cancelled', 409));
    const body = { v: 1, nonce: crypto.randomUUID(), issued_at: Date.now(), ...payload };
    const socket = net.createConnection(installation.socket);
    let buffer = Buffer.alloc(0);
    let settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer); signal?.removeEventListener('abort', abort);
      socket.destroy();
      if (error) reject(new OpsDenied(error, 503)); else resolve(result);
    };
    const abort = () => finish('cancelled');
    const timer = setTimeout(() => finish('worker_deadline'), Math.max(1, timeoutMs));
    signal?.addEventListener('abort', abort, { once: true });
    socket.on('connect', () => socket.write(JSON.stringify({ body, sig: signBody(installation.key, body) }) + '\n'));
    socket.on('error', () => finish('worker_unavailable'));
    socket.on('close', () => finish('worker_disconnected'));
    socket.on('data', chunk => {
      if (buffer.length + chunk.length > 65536) return finish('worker_output_limit');
      buffer = Buffer.concat([buffer, chunk]);
      const nl = buffer.indexOf(10);
      if (nl < 0) return;
      try {
        const reply = z.object({ body: z.object({
          v: z.literal(1), nonce: z.literal(body.nonce), op: z.literal(body.op),
          result: z.unknown(),
        }).strict(), sig: z.string().regex(/^[a-f0-9]{64}$/) }).strict().parse(JSON.parse(buffer.subarray(0, nl).toString()));
        if (!crypto.timingSafeEqual(Buffer.from(reply.sig, 'hex'), Buffer.from(signBody(installation.key, reply.body), 'hex'))) {
          return finish('worker_signature');
        }
        finish(null, reply.body.result);
      } catch { finish('worker_protocol'); }
    });
  });
}
