// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
vi.mock('./release-evidence.mjs', () => ({ createEvidence: async runner => ({ run: runner,
  finish: async () => { await runner('SEAL'); return { manifestSha256: 'f'.repeat(64) }; } }) }));
import { request, validateApproval, deployRing1, healthy } from './ring1-release.mjs';
const roots = [];
afterEach(() => roots.splice(0).forEach(root => fs.rmSync(root, { recursive: true, force: true })));
const sha = 'a'.repeat(40), tag = 'ring1-20260929-e044a419', fp = 'b'.repeat(64), digest = 'c'.repeat(64);
const databaseIdentity = { database: 'godcrm_prod', systemIdentifier: '7654321000000000000', serverAddress: '127.0.0.1', serverPort: 5432, recovery: false, machineIdSha256: 'd'.repeat(64) };
const receipt = () => ({ tag, sha, target: 'ring1-master-b', targetFingerprint: fp, lockSha256: digest,
  databaseIdentity, approvedBy: 'owner', ownerDecision: 'conversation 3660', expiresAt: '2099-01-01T00:00:00Z',
  gates: Object.fromEntries(['staging', 'ring0Smoke', 'ring0Errors', 'clientErrors', 'nlRestoreMigrations', 'rollback']
    .map(key => [key, { status: 'PASS', evidence: 'reviewed-artifact' }])),
  soak: { status: 'WAIVED_BY_OWNER', evidence: 'owner message' }, distManifestSha256: digest });
async function scenario({ dryRun = false, failure, mutateReceipt, changedTarget = false, servedMismatch = false } = {}) {
  const worktree = fs.mkdtempSync(path.join(os.tmpdir(), 'ring1-tests-')); roots.push(worktree);
  fs.mkdirSync(`${worktree}/dist/assets`, { recursive: true });
  fs.writeFileSync(`${worktree}/dist/index.html`, '<script src="/assets/index-fixture.js"></script>');
  fs.writeFileSync(`${worktree}/dist/assets/index-fixture.js`, 'fixture');
  const c = { source: '/source', worktree, host: 'fixture-host', tree: '/live', stage: '/stage',
    docroot: '/www', backups: '/backups/temp', knexfile: 'backend/database/knexfile.js', pm2: 'fixture-service',
    health: 'https://crm.hltrn.cc/api/health', url: 'https://crm.hltrn.cc/',
    evidenceRoot: '/evidence', approvalRoot: '/approvals', botFile: new URL('./bot.js', import.meta.url) };
  const calls = [], messages = [], r = receipt(); mutateReceipt?.(r);
  let fingerprints = 0;
  const runner = async command => {
    const dbAction = command.match(/RING1_DB_ACTION=(identity|dump|status|latest)/)?.[1];
    if (dbAction) command = `ring1-db:${dbAction}`;
    calls.push(command);
    if (failure && command.includes(failure)) throw Error('injected failure');
    if (command === 'ring1-db:identity') return JSON.stringify({ databaseIdentity });
    if (command.includes('refs/tags') || command.includes('rev-parse HEAD')) return sha;
    if (command.includes('Approval must be protected')) return JSON.stringify(r);
    if (command.includes('walk(dir)')) return changedTarget && ++fingerprints > 1 ? 'e'.repeat(64) : fp;
    if (command.includes('curl') && command.includes('sha256sum')) {
      if (servedMismatch) return 'd'.repeat(64);
      const file = command.includes('index-fixture.js') ? 'assets/index-fixture.js' : 'index.html';
      return crypto.createHash('sha256').update(fs.readFileSync(`${worktree}/dist/${file}`)).digest('hex');
    }
    if (command.includes('curl')) return JSON.stringify({ status: 'ok', database: { status: 'connected' } });
    if (command.includes('sha256sum')) return digest + '  file';
    return 'OK';
  };
  let error;
  try { await deployRing1({ text: `/deploy_ring1${dryRun ? '_check' : ''} ${tag} ${sha}`, dryRun,
    config: c, runLocal: runner, runRemote: runner, report: async message => messages.push(message) }); }
  catch (e) { error = e; }
  return { calls, messages, error };
}
describe('Ring 1 release contract', () => {
  it('rejects SPA HTML and degraded JSON even with HTTP 200', () => {
    expect(healthy('<html>SPA</html>')).toBe(false);
    expect(healthy('{"status":"degraded","database":{"status":"disconnected"}}')).toBe(false);
    expect(healthy('{"status":"ok","database":{"status":"connected"}}')).toBe(true);
  });
  it('requires tag plus exact SHA and rejects injection, HEAD and extra arguments', () => {
    expect(request(`/deploy_ring1 ${tag} ${sha}`, false)).toEqual({ tag, sha });
    for (const text of ['/deploy_ring1', `/deploy_ring1 main ${sha}`, `/deploy_ring1 ${tag} HEAD`, `/deploy_ring1 ${tag} ${sha} extra`, `/deploy_ring1 ${tag};id ${sha}`, `/deploy_ring1_check ${tag} ${sha}`]) expect(() => request(text, false)).toThrow('Usage');
  });
  it('permits explicit soak waiver but never substitutes it for other gates', () => {
    const r = receipt(), pins = { tag, sha, fingerprint: fp, lockSha256: digest };
    expect(validateApproval(r, pins)).toBe(r); r.gates.nlRestoreMigrations.status = 'NOT_TESTED';
    expect(() => validateApproval(r, pins)).toThrow('nlRestoreMigrations');
    expect(() => validateApproval(receipt(), { ...pins, sha: 'e'.repeat(40) })).toThrow('match');
    expect(() => validateApproval({ ...receipt(), expiresAt: '2000-01-01' }, pins)).toThrow('expired');
  });
  it('check performs no build, backup, stage write, migration or process control', async () => {
    const { calls, error, messages } = await scenario({ dryRun: true });
    expect(error).toBeUndefined(); expect(messages.join()).toContain('READ_ONLY');
    expect(calls.some(c => /mkdir|npm ci|worktree add|rsync|ring1-db:latest|pm2|ring1-db:dump|tar czf/.test(c))).toBe(false);
  });
  it('missing gates prevent even build worktree creation', async () => {
    const { calls, error } = await scenario({ mutateReceipt: r => { r.gates.rollback.status = 'NOT_TESTED'; } });
    expect(error.message).toContain('rollback'); expect(calls.some(c => c.includes('worktree add'))).toBe(false);
  });
  it('aborts before NL changes on install failure, mismatched build or target drift', async () => {
    for (const options of [{ failure: 'npm ci --include=dev' }, { mutateReceipt: r => { r.distManifestSha256 = 'f'.repeat(64); } }, { changedTarget: true }, { mutateReceipt: r => { r.databaseIdentity = { ...databaseIdentity, systemIdentifier: '1' }; } }]) {
      const { calls, error } = await scenario(options);
      expect(error).toBeDefined(); expect(calls.some(c => /ring1-db:dump|rsync|pm2/.test(c))).toBe(false); if (!options.mutateReceipt || !error.message.includes('identity mismatch')) expect(calls).toContain('SEAL');
    }
  });
  it('backs up before staging and verifies private inputs before migration; retries live install always', async () => {
    const { calls, error } = await scenario(); expect(error).toBeUndefined();
    const at = text => calls.findIndex(c => c.includes(text));
    expect(at('ring1-db:dump')).toBeLessThan(at('rsync'));
    expect(at('npm ci --omit=dev')).toBeLessThan(at('ring1-db:latest'));
    expect(calls.filter(c => c.includes('npm ci --omit=dev'))).toHaveLength(2);
    expect(at('ring1-db:latest')).toBeLessThan(at('pm2'));
    expect(calls.some(c => /ln -s|npm install|--delete|--update-env|\| tail/.test(c))).toBe(false);
    const syncs = calls.filter(c => c.includes('rsync -a') && !c.includes('/dist/') && !c.includes('/deploy-bot/build-inputs.mjs'));
    expect(syncs.length).toBeGreaterThan(1);
    for (const c of syncs) for (const preserved of ['.env*', '/.mcp.json', 'uploads/', 'backend/*tokens.json', 'deploy-bot']) expect(c).toContain(preserved);
    expect(at('.promoted-sha')).toBeGreaterThan(at('pm2'));
    expect(at('SEAL')).toBeLessThan(at('worktree remove'));
  });
  it('backup failure prevents delivery and migration', async () => {
    const { calls, error } = await scenario({ failure: 'ring1-db:dump' });
    expect(error).toBeDefined(); expect(calls.some(c => /rsync|ring1-db:latest|pm2/.test(c))).toBe(false);
  });
  it('install and migration failures prevent process control and frontend publication', async () => {
    for (const failure of ['npm ci --omit=dev', 'ring1-db:status', 'ring1-db:latest']) {
      const { calls, error } = await scenario({ failure }); expect(error).toBeDefined();
      expect(calls.some(c => /pm2|\.promoted-sha/.test(c))).toBe(false);
    }
  });
  it('served-byte mismatch fails acceptance and does not stamp success', async () => {
    const { calls, error } = await scenario({ servedMismatch: true });
    expect(error.message).toContain('Served bytes mismatch'); expect(calls.some(c => c.includes('.promoted-sha'))).toBe(false);
  });
  it('retains worktree when evidence sealing fails', async () => {
    const { calls } = await scenario({ failure: 'SEAL' }); expect(calls.some(c => c.includes('worktree remove'))).toBe(false);
  });
});
