// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';
vi.mock('node:os', async original => ({ ...await original(),
  networkInterfaces: () => ({ eth0: [{ address: '<RING1_IP>' }] }) }));
import { assertDatabaseIdentity, databaseCommand, databaseProgram } from './ring1-database.mjs';
import { fingerprintCommand } from './ring1-release.mjs';
const roots = [];
const saved = { ...process.env };
afterEach(() => {
  roots.splice(0).forEach(root => fs.rmSync(root, { recursive: true, force: true }));
  for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
  Object.assign(process.env, saved);
  vi.restoreAllMocks();
});
const identity = () => ({ database: 'godcrm_prod', systemIdentifier: '7654321000000000000',
  serverAddress: '127.0.0.1', serverPort: 5432, recovery: false,
  machineIdSha256: crypto.createHash('sha256').update(fs.readFileSync('/etc/machine-id')).digest('hex') });
function root() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ring1-identity-')); roots.push(dir); return dir;
}
it('distinguishes A and B with identical database names and rejects endpoint/host changes', () => {
  const good = identity(); expect(assertDatabaseIdentity(good, good)).toBe(good);
  for (const change of [{ systemIdentifier: '123' }, { machineIdSha256: 'a'.repeat(64) },
    { serverAddress: '127.0.0.1/32' }, { serverAddress: '<PROD_IP>' }, { serverPort: 5433 }, { database: 'godcrm_test' }, { recovery: true }]) {
    expect(() => assertDatabaseIdentity({ ...good, ...change }, good)).toThrow();
  }
  expect(() => assertDatabaseIdentity({})).toThrow();
});
it('fingerprints JSON, module manifests and env changes without outputting contents', () => {
  const dir = root(); fs.mkdirSync(`${dir}/backend/modules/music`, { recursive: true });
  fs.writeFileSync(`${dir}/package.json`, '{}');
  const fingerprint = () => execSync(fingerprintCommand(dir), { encoding: 'utf8' }).trim();
  let previous = fingerprint(); expect(previous).toMatch(/^[a-f0-9]{64}$/);
  for (const file of ['backend/local-tokens.json', 'backend/modules/music/module.manifest.yaml', '.env.edit']) {
    fs.writeFileSync(`${dir}/${file}`, 'private-fixture-value');
    const next = fingerprint(); expect(next).not.toBe(previous); expect(next).not.toContain('private-fixture'); previous = next;
  }
  fs.symlinkSync('/tmp', `${dir}/backend/unsafe`);
  expect(fingerprint).toThrow();
});
it('shell-quotes database commands and rejects arbitrary actions', async () => {
  expect(databaseCommand({ action: 'identity', tree: "/tmp/it's-safe" })).toContain("'\\''");
  await expect(databaseProgram({ action: 'unexpected' })).rejects.toThrow('Unknown database action');
});
it.each(['identity', 'latest'])('runs %s against a guarded pool and clears inherited connection overrides', async action => {
  const dir = root(); const good = identity();
  fs.mkdirSync(`${dir}/node_modules/knex`, { recursive: true });
  fs.mkdirSync(`${dir}/node_modules/dotenv`, { recursive: true });
  fs.writeFileSync(`${dir}/package.json`, '{"type":"module"}');
  fs.writeFileSync(`${dir}/.env`, 'POSTGRES_DB=godcrm_prod');
  fs.writeFileSync(`${dir}/node_modules/dotenv/index.js`, "exports.parse=()=>({POSTGRES_DB:'godcrm_prod'})");
  fs.writeFileSync(`${dir}/config.mjs`, `export default { production: {client:'pg',connection:{database:process.env.POSTGRES_DB,host:process.env.POSTGRES_HOST||'localhost'}}}`);
  // Fake client/Knex only. No connection to PostgreSQL is possible in this test.
  fs.writeFileSync(`${dir}/node_modules/knex/index.js`, `const fs=require('fs');module.exports=cfg=>({
    raw:()=>new Promise((resolve,reject)=>{if(cfg.connection.host!=='localhost')return reject(Error('Inherited host'));
      cfg.pool.afterCreate({query:(sql,cb)=>cb(null,{rows:[JSON.parse(process.env.FIXTURE_DB_IDENTITY)]})},e=>e?reject(e):resolve());}),
    migrate:{latest:async()=>{fs.writeFileSync(${JSON.stringify(dir + '/migrated')},'yes');return [];}},destroy:async()=>{}
  });`);
  process.env.POSTGRES_HOST = '<PROD_IP>'; process.env.PGHOST = '<PROD_IP>';
  process.env.FIXTURE_DB_IDENTITY = JSON.stringify({ ...good, systemIdentifier: '123' });
  const options = { tree: dir, envFile: `${dir}/.env`, knexfile: 'config.mjs', expected: good, action };
  const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  await expect(databaseProgram(options)).rejects.toThrow('identity mismatch');
  expect(fs.existsSync(`${dir}/migrated`)).toBe(false);
  process.env.FIXTURE_DB_IDENTITY = JSON.stringify(good);
  await databaseProgram(options);
  expect(fs.existsSync(`${dir}/migrated`)).toBe(action === 'latest');
  expect(process.env.PGHOST).toBeUndefined(); expect(process.env.POSTGRES_HOST).toBeUndefined();
  expect(output).toHaveBeenCalledWith(expect.stringContaining('databaseIdentity'));
});
