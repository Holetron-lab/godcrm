const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { tmpdir } = require('node:os');
const { trusted, durableJson, admit, previousRuns, needsVerify } = require('./history3496.cjs');
const { validateReadiness, classifyExit, GUARDS } = require('./history3496-runner.cjs');
const sha = 'a'.repeat(40), hash = 'b'.repeat(64), now = Date.now();
const proof = { path: '/root/backups/temp/proof.json', sha256: hash };
const ready = { operator: 'Geramon', authorization: 'ticket 246779', checked_at: new Date(now).toISOString(),
  deployed_sha: sha, channel_sha: sha, http_acl_verified: true, uploads_acl_verified: true,
  backup: proof, backup_at: new Date(now).toISOString(), restored_backup_sha256: hash, restore_verified_at: new Date(now).toISOString(),
  gate1: proof, staging_smoke: proof, test_cycle: proof, http_acl: proof, uploads_acl: proof, restore: proof,
  guards: Object.fromEntries(GUARDS.map(file => [file, hash])) };
test('readiness requires current matching deployment, backup/restore and actual receipt references', () => {
  assert.equal(validateReadiness(ready, { deployed_app_sha: sha, channel_commit_sha: sha }, now).operator, 'Geramon');
  for (const patch of [{ gate1: undefined }, { backup: undefined }, { http_acl_verified: false }, { channel_sha: 'c'.repeat(40) },
    { deployed_sha: 'c'.repeat(40) }, { restored_backup_sha256: 'd'.repeat(64) }, { checked_at: '2020-01-01T00:00:00.000Z' },
    { restore_verified_at: '2020-01-01T00:00:00.000Z' }, { guards: {} }]) {
    assert.throws(() => validateReadiness({ ...ready, ...patch }, { deployed_app_sha: sha, channel_commit_sha: sha }, now));
  }
});
test('durable dedup survives another process; uncertain writes require verification', () => {
  const dir = fs.mkdtempSync(`${tmpdir()}/history3496-test-`);
  try {
    fs.mkdirSync(`${dir}/runs`, { mode: 0o700 });
    const m = { channel_commit_sha: sha, deployed_app_sha: sha };
    const first = admit({ message_id: 9 }, 'apply', m, dir);
    assert.ok(first);
    assert.equal(admit({ message_id: 9 }, 'apply', m, dir), null);
    const child = require('node:child_process').execFileSync('/usr/bin/node', ['-e',
      `const {admit}=require(${JSON.stringify(require.resolve('./history3496.cjs'))}); process.stdout.write(JSON.stringify(admit({message_id:9},'apply',${JSON.stringify(m)},${JSON.stringify(dir)})));`], { env: { PATH: '/usr/bin:/bin' }, encoding: 'utf8' });
    assert.equal(child, 'null');
    assert.equal(needsVerify(previousRuns(dir), 'other'), true);
    const second = admit({ message_id: 10 }, 'verify', m, dir);
    durableJson(`${second.run}/result.json`, { status: 'SUCCEEDED', finished_at: Date.now() + 1 });
    assert.equal(needsVerify(previousRuns(dir), 'other'), false);
    assert.throws(() => durableJson(`${second.run}/result.json`, {}), /EEXIST/);
    fs.symlinkSync(`${second.run}/result.json`, `${dir}/link`);
    assert.throws(() => trusted(`${dir}/link`), /PERMISSIONS/);
    fs.chmodSync(`${second.run}/result.json`, 0o666);
    assert.throws(() => trusted(`${second.run}/result.json`), /PERMISSIONS/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test('post-spawn failures are conservative and never expose child errors', () => {
  assert.equal(classifyExit('apply', 1, 'password SECRET'), 'OUTCOME_UNKNOWN');
  assert.equal(classifyExit('verify', 1, 'Install scripts/historical-chat-parent-index.sql'), 'PRECONDITION_INDEX');
  assert.equal(classifyExit('rollback', 1, 'Import messages changed; review required'), 'BLOCKED_CHANGED');
});
test('rollback accepts the existing CLI rollback report and never returns a deleted URL', () => {
  const { summarizeReport } = require('./history3496-runner.cjs');
  const base = { messages: 6061, files: 334, missing: Array(21).fill('/uploads/missing'), source_sha256: require('./history3496.cjs').DIGEST, related_sha256:require('./history3496.cjs').RELATED, related:{rows:50},destination:{id:44,name:'Играемся'} };
  const rolled = summarizeReport('rollback', { ...base, rolled_back: true, private_files_retained_for_review: [] });
  assert.equal(rolled.url, undefined);
  assert.equal(rolled.missing, 21);
  assert.throws(() => summarizeReport('apply', base));
});
test('OS lock survives the locking helper and excludes another process', async () => {
  const { spawn, spawnSync } = require('node:child_process');
  const { once } = require('node:events');
  const dir = fs.mkdtempSync(`${tmpdir()}/history3496-flock-`);
  const fd = fs.openSync(`${dir}/lock`, 'wx', 0o600);
  try {
    const helper = spawn('/usr/bin/node', ['-e', `const {runChild}=require(${JSON.stringify(require.resolve('./history3496-runner.cjs'))}); runChild('/usr/bin/flock',['-n','3'],{env:{PATH:'/usr/bin:/bin'}}).then(r=>{if(r.code)process.exit(1);process.stdout.write('locked');setTimeout(()=>{},350);});`], { env: { PATH: '/usr/bin:/bin' }, stdio: ['ignore', 'pipe', 'pipe', fd] });
    await once(helper.stdout, 'data');
    fs.closeSync(fd);
    assert.equal(spawnSync('/usr/bin/flock', ['-n', `${dir}/lock`, '/usr/bin/true']).status, 1);
    await once(helper, 'close');
    assert.equal(spawnSync('/usr/bin/flock', ['-n', `${dir}/lock`, '/usr/bin/true']).status, 0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test('installer detects dependency drift and seals an inventory without symlinks', async () => {
  const { dependencyVersions, inventory } = require('./history3496-install.cjs');
  const dir = fs.mkdtempSync(`${tmpdir()}/history3496-inventory-`);
  try {
    fs.mkdirSync(`${dir}/node_modules/pkg`, { recursive: true });
    fs.writeFileSync(`${dir}/node_modules/pkg/package.json`, JSON.stringify({ version: '1.0.0' }));
    const lock = { packages: { 'node_modules/pkg': { version: '1.0.0' } } };
    dependencyVersions(dir, lock);
    assert.throws(() => dependencyVersions(dir, { packages: { 'node_modules/pkg': { version: '2.0.0' } } }), /mismatch/);
    const files = await inventory(dir);
    assert.match(files['node_modules/pkg/package.json'], /^[a-f0-9]{64}$/);
    assert.equal(fs.statSync(`${dir}/node_modules/pkg/package.json`).mode & 0o777, 0o400);
    fs.symlinkSync('/etc/passwd', `${dir}/bad-link`);
    await assert.rejects(inventory(dir), /Untrusted/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// Run the actual worker through fake OS/database boundaries. No production CLI
// is executed; argv, preconditions and durable receipts remain the real code.
async function workerFixture(overrides = {}) {
  const vm = require('node:vm');
  const { EventEmitter } = require('node:events');
  const core = require('./history3496.cjs');
  const dir = fs.mkdtempSync(`${tmpdir()}/history3496-worker-`);
  fs.mkdirSync(`${dir}/runs`, { mode: 0o700 });
  const action = overrides.action || 'apply';
  const manifest = { channel_commit_sha: sha, deployed_app_sha: sha, artifact: `${dir}/artifact` };
  const admitted = core.admit({ message_id: 999 }, action, manifest, dir);
  const calls = [];
  const credentials = { POSTGRES_HOST: '127.0.0.1', POSTGRES_PORT: '5432', POSTGRES_DB: 'godcrm_prod', POSTGRES_USER: 'operator', POSTGRES_PASSWORD: 'SECRET' };
  const fakeFs = { ...fs,
    fstatSync: () => ({ ino: 1, dev: 1 }),
    lstatSync: file => file === core.LOCK ? { ino: 1, dev: 1 } : fs.lstatSync(file),
    statfsSync: () => ({ bavail: 16 * 1024 ** 3, bsize: 1 }),
    readFileSync: (file, ...rest) => file === '/srv/godcrm/live/.promoted-sha' ? sha : fs.readFileSync(file, ...rest),
  };
  const fakeCore = { ...core, STATE: dir,
    installation: () => manifest,
    checkInventory: async () => { if (overrides.pinFailure) throw Error('PRECONDITION_DIGEST'); },
    trusted: (file, options) => [core.LOCK, core.UPLOADS, '/srv/godcrm/live/.promoted-sha'].includes(file) ? file : core.trusted(file, options),
    digest: async () => hash,
    previousRuns: () => core.previousRuns(dir),
    readJson: file => file.endsWith('history3496-db.json') ? { ...credentials, ...overrides.credentials }
      : file.endsWith('history3496-readiness.json') ? { ...ready, ...overrides.readiness } : core.readJson(file),
    durableJson: (file, data) => { if (overrides.reportFailure && file.endsWith('report-write-probe.json')) throw Error('ENOSPC'); core.durableJson(file, data); },
  };
  const context = { require: name => name === './history3496.cjs' ? fakeCore : name === 'node:fs' ? fakeFs
    : name === 'node:os' ? { networkInterfaces: () => ({ eth0: [{ address: overrides.host || '<PROD_IP>' }] }) }
    : name === 'node:child_process' ? { spawn(executable, argv, options) {
      calls.push({ executable, argv, options });
      const child = new EventEmitter(); child.stderr = new EventEmitter();
      process.nextTick(() => {
        if (executable === '/usr/bin/node' && !overrides.exitCode) core.durableJson(`${admitted.run}/report.json`, {
          messages: 6061, files: 334, missing: Array(21).fill('/uploads/missing'), source_sha256: core.DIGEST, related_sha256:core.RELATED, related:{rows:50},destination:{id:44,name:"Играемся"},
          verified: true, conversation_id: 777, space_id: 44, url: 'https://app.godcrm.ai/spaces/44?chat=777',
        });
        if (overrides.stderr) child.stderr.emit('data', Buffer.from(overrides.stderr));
        child.emit('close', executable === '/usr/bin/flock' ? (overrides.busy ? 75 : 0) : overrides.exitCode || 0);
      });
      return child;
    } } : require(name), module: { exports: {} }, __dirname: `${manifest.artifact}/deploy-bot`, process, Date };
  vm.runInNewContext(fs.readFileSync(require.resolve('./history3496-runner.cjs'), 'utf8'), context);
  try {
    await context.module.exports.runHistory3496(admitted.runId);
    return { calls, result: core.readJson(`${admitted.run}/result.json`), journal: fs.readFileSync(`${admitted.run}/intent.json`, 'utf8') + fs.readFileSync(`${admitted.run}/result.json`, 'utf8') };
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
test('worker passes fixed argv with shell:false and clean env, then returns only a redacted receipt', async () => {
  const f = await workerFixture();
  assert.equal(f.result.status, 'SUCCEEDED');
  const cli = f.calls.find(c => c.executable === '/usr/bin/node');
  assert.equal(cli.options.shell, false);
  assert.equal(cli.options.env.POSTGRES_DB, 'godcrm_prod');
  assert.equal(cli.options.env.NODE_OPTIONS, undefined);
  assert.equal(cli.options.timeout, undefined);
  assert.equal(cli.options.stdio[3], 3);
  assert.ok(cli.argv.includes('--operator-evidence'));
  assert.equal(f.journal.includes('SECRET'), false);
});
test('worker stops before CLI for wrong pins, host, DB, owner receipts, report storage, lock', async () => {
  for (const options of [{ pinFailure: true }, { host: '<RING1_IP>' }, { credentials: { POSTGRES_DB: 'wrong' } },
    { credentials: { POSTGRES_PASSWORD: '' } }, { readiness: { gate1: undefined } }, { readiness: { operator: '' } },
    { reportFailure: true }, { busy: true }]) {
    const f = await workerFixture(options);
    assert.equal(f.calls.some(c => c.executable === '/usr/bin/node'), false);
    assert.notEqual(f.result.status, 'SUCCEEDED');
  }
});
test('worker records missing index, owner mismatch, ambiguous commit and continued rollback without leaking errors', async () => {
  for (const [options, expected] of [
    [{ exitCode: 1, stderr: 'Install scripts/historical-chat-parent-index.sql' }, 'PRECONDITION_INDEX'],
    [{ exitCode: 1, stderr: 'Owner identity not verified' }, 'PRECONDITION_OWNER'],
    [{ exitCode: 1, stderr: 'SECRET after possible commit' }, 'OUTCOME_UNKNOWN'],
    [{ action: 'rollback', exitCode: 1, stderr: 'Import messages changed; review required' }, 'BLOCKED_CHANGED'],
  ]) {
    const f = await workerFixture(options);
    assert.equal(f.result.status, expected);
    assert.equal(f.journal.includes('SECRET'), false);
  }
});
test('dependency copy skips the installed root self-link and refuses other directory links', () => {
  const { copyInstalledDependencies } = require('./history3496-install.cjs');
  const dir = fs.mkdtempSync(`${tmpdir()}/history3496-copy-`);
  try {
    fs.mkdirSync(`${dir}/source`);
    fs.writeFileSync(`${dir}/source/package.json`, '{}');
    fs.symlinkSync(`${dir}/source`, `${dir}/source/node_modules`);
    copyInstalledDependencies(`${dir}/source`, `${dir}/copy`);
    assert.equal(fs.existsSync(`${dir}/copy/node_modules`), false);
    assert.equal(fs.readFileSync(`${dir}/copy/package.json`, 'utf8'), '{}');
    fs.symlinkSync('/tmp', `${dir}/source/foreign`);
    assert.throws(() => copyInstalledDependencies(`${dir}/source`, `${dir}/copy2`), /directory link/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test('inventory seals git-archive directory modes before hashing their children', async () => {
  const { inventory } = require('./history3496-install.cjs');
  const dir = fs.mkdtempSync(`${tmpdir()}/history3496-modes-`);
  try {
    fs.mkdirSync(`${dir}/source`); fs.chmodSync(`${dir}/source`, 0o775);
    fs.writeFileSync(`${dir}/source/file`, 'committed');
    assert.ok((await inventory(dir))['source/file']);
    assert.equal(fs.statSync(`${dir}/source`).mode & 0o777, 0o500);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// Exercise prepare ordering with synthetic OS inputs; trust/digest/inventory and
// RUNBOOK copy use real files. The separate namespace smoke uses no mocks.
test('prepare seals archive 0775/0664 before trusted RUNBOOK copy', async () => {
  const vm = require('node:vm');
  const core = require('./history3496.cjs');
  const dir = fs.mkdtempSync(`${tmpdir()}/history3496-prepare-`);
  const root = `${dir}/channel`, artifact = `${root}/releases/${sha}`;
  const source = `${dir}/input`;
  const lock = JSON.stringify({ packages: {} });
  fs.mkdirSync(source);
  for (const name of ['.env', 'bot.js', 'conversation-3496.json', 'file-map.json', 'related-data.json', 'archived-only-messages.json', 'files.tar']) fs.writeFileSync(`${source}/${name}`, '{}');
  const mapped = file => {
    if (file.startsWith(dir)) return file;
    if (file === '/etc/godcrm') return `${dir}/etc`;
    if (file.startsWith('/root/backups/temp/history3496-install-')) return file.replace('/root/backups/temp', dir);
    if (file.endsWith('/package-lock.json')) return `${source}/package-lock.json`;
    if (file.startsWith('/root/production/business-crm/deploy-bot/')) return `${source}/${file.split('/').pop()}`;
    if (file.endsWith('/conversation-3496.json') || file.endsWith('/file-map.json') || file.endsWith('/related-data.json') || file.endsWith('/archived-only-messages.json') || file.endsWith('/files.tar') && !file.startsWith(root)) return `${source}/${file.split('/').pop()}`;
    return file;
  };
  fs.writeFileSync(`${source}/package-lock.json`, lock);
  const fakeFs = { ...fs,
    existsSync: file => file === core.MANIFEST ? false : fs.existsSync(mapped(file)),
    mkdirSync: (file, opts) => fs.mkdirSync(mapped(file), opts),
    readFileSync: (file, ...args) => file === '/srv/godcrm/live/.promoted-sha' ? sha : fs.readFileSync(mapped(file), ...args),
    copyFileSync: (from, to, flags) => fs.copyFileSync(mapped(from), mapped(to), flags),
    statfsSync: () => ({ bavail: 16 * 1024 ** 3, bsize: 1 }),
    chmodSync: (file, mode) => fs.chmodSync(mapped(file), mode),
    unlinkSync: file => fs.unlinkSync(mapped(file)),
    cpSync: () => {},
    // Stop after the RUNBOOK copy; full final-SHA preparation is tested separately.
    linkSync: () => { throw Error('RUNBOOK_COPIED'); },
  };
  const fakeCore = { ...core, ROOT: root, STATE: `${dir}/state`,
    trusted: (file, opts) => core.trusted(mapped(file), opts),
    digest: file => file.endsWith('/package-lock.json') ? Promise.resolve(core.LOCKFILE) : core.digest(mapped(file)),
  };
  const context = { module: { exports: {} }, process, require: name => name === 'node:fs' ? fakeFs
    : name === './history3496.cjs' ? fakeCore
    : name === 'node:os' ? { networkInterfaces: () => ({ eth0: [{ address: '<PROD_IP>' }] }) }
    : name === 'node:child_process' ? { execFileSync(exe, args) {
      if (args.includes('rev-parse')) return sha;
      if (args.includes('show')) return Buffer.from('identical importer');
      if (exe === '/usr/bin/tar') {
        fs.mkdirSync(`${artifact}/scripts`, { mode: 0o775 }); fs.chmodSync(`${artifact}/scripts`, 0o775);
        fs.writeFileSync(`${artifact}/scripts/HISTORICAL-CHAT-IMPORT.md`, 'reviewed runbook');
        fs.chmodSync(`${artifact}/scripts/HISTORICAL-CHAT-IMPORT.md`, 0o664);
        fs.writeFileSync(`${artifact}/package-lock.json`, lock);
        for (const pkg of ['zod', 'tar', 'pg', 'pino']) {
          fs.mkdirSync(`${artifact}/node_modules/${pkg}`, { recursive: true });
          fs.writeFileSync(`${artifact}/node_modules/${pkg}/package.json`, '{}');
        }
      }
      return Buffer.alloc(0);
    } } : require(name) };
  vm.runInNewContext(fs.readFileSync(require.resolve('./history3496-install.cjs'), 'utf8'), context);
  try {
    await assert.rejects(context.module.exports.installHistory3496('prepare', sha), /RUNBOOK_COPIED/);
    assert.equal(fs.readFileSync(`${root}/inputs/RUNBOOK.md`, 'utf8'), 'reviewed runbook');
    assert.equal(fs.statSync(`${artifact}/scripts`).mode & 0o777, 0o500);
    assert.equal(fs.statSync(`${artifact}/scripts/HISTORICAL-CHAT-IMPORT.md`).mode & 0o777, 0o400);
    assert.equal(fs.statSync(`${root}/inputs/RUNBOOK.md`).mode & 0o777, 0o400);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
