import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, stat } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

const run = promisify(execFile);
const script = new URL('./export-space.mjs', import.meta.url).pathname;

test('exports a private partial snapshot with a file checksum and inventory', async () => {
  const data = {
    type: 'space',
    space: { id: 7841, name: 'SMB test' },
    projects: [{
      type: 'project',
      project: { id: 1 },
      tables: [
        {
          table: { name: 'customers' },
          columns: [{ name: 'access_token', columnType: 'token' }],
          rows: [{ id: 1, access_token: 'do-not-export' }, { id: 2, access_token: 'do-not-export' }],
        },
        { table: { name: 'Secrets' }, columns: [], rows: [{ value: 'do-not-export' }] },
      ],
      documents: [{ id: 1 }],
    }],
  };
  let authorization;
  const server = http.createServer((req, res) => {
    authorization = req.headers.authorization;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ success: true, data }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const output = await mkdtemp(path.join(os.tmpdir(), 'godcrm-export-test-'));

  try {
    const address = server.address();
    const { stdout } = await run(process.execPath, [script, '7841', output], {
      env: {
        ...process.env,
        SOURCE_URL: `http://127.0.0.1:${address.port}`,
        SOURCE_TOKEN: 'test-only-token',
      },
    });
    const result = JSON.parse(stdout);
    assert.equal(authorization, 'Bearer test-only-token');
    assert.equal(result.project_count, 1);
    assert.equal(result.table_count, 1);
    assert.equal(result.row_count, 2);
    assert.equal(result.legacy_document_count, 1);
    assert.equal(result.fidelity, 'PARTIAL_NOT_A_FULL_MIGRATION');
    assert.deepEqual(result.sanitization.excludedSensitiveTables, ['Secrets']);
    assert.equal(result.sanitization.sanitizedColumns, 1);
    const serialized = await readFile(result.export, 'utf8');
    assert.equal(serialized.includes('do-not-export'), false);
    assert.equal(JSON.parse(serialized).projects[0].tables[0].rows[0].access_token, null);
    assert.equal(result.sha256, createHash('sha256').update(serialized).digest('hex'));
    assert.equal((await stat(result.export)).mode & 0o777, 0o600);
    assert.equal((await stat(result.manifest)).mode & 0o777, 0o600);
    assert.equal((await readdir(output)).length, 2);
  } finally {
    server.close();
    const { rm } = await import('node:fs/promises');
    await rm(output, { recursive: true, force: true });
  }
});
