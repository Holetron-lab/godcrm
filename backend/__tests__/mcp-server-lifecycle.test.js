// @vitest-environment node
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');

function waitForStart(child) {
  return new Promise((resolve, reject) => {
    let stderr = '';
    const timer = setTimeout(() => reject(new Error(`MCP server did not start:\n${stderr}`)), 15000);
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
      if (stderr.includes('Server started.')) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`MCP server exited before startup (${code}):\n${stderr}`));
    });
  });
}

test('MCP server exits when the parent closes stdin', { timeout: 20000 }, async () => {
  const child = spawn(process.execPath, [
    '--input-type=module',
    '--eval',
    "setInterval(() => {}, 1000); import('./backend/mcp-server.js');",
  ], {
    cwd: repoRoot,
    env: { ...process.env, NODE_ENV: 'test', LOG_LEVEL: 'silent' },
    stdio: ['pipe', 'ignore', 'pipe'],
  });

  try {
    await waitForStart(child);
    const exited = once(child, 'exit');
    child.stdin.end();
    await Promise.race([
      exited,
      new Promise((_, reject) => setTimeout(() => reject(new Error('MCP server stayed alive after stdin closed')), 2000)),
    ]);
    expect(child.exitCode).toBe(0);
  } finally {
    if (child.exitCode === null) {
      child.kill('SIGKILL');
      await once(child, 'exit');
    }
  }
});
