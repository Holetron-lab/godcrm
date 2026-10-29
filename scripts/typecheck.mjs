// Keep composite TypeScript metadata out of read-only worktrees.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const compiler = require.resolve('typescript/bin/tsc');
const cacheDirectory = mkdtempSync(join(tmpdir(), 'godcrm-typecheck-'));

try {
  const result = spawnSync(process.execPath, [
    compiler,
    '--noEmit',
    '--tsBuildInfoFile', join(cacheDirectory, 'check.tsbuildinfo'),
    ...process.argv.slice(2),
  ], { stdio: 'inherit' });

  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  rmSync(cacheDirectory, { recursive: true, force: true });
}
