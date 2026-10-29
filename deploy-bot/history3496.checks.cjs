const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseMessage, cliArgs, safeEnv } = require('./history3496.cjs');
const now = 1800000000;
const valid = { text: '/history3496 apply', from: { id: 423753027 }, chat: { id: 423753027, type: 'private' }, message_id: 123, date: now };
const me = { id: 8601600288, username: 'Godcrmdeploybot' };
test('only an exact fresh owner-originated private message can select a fixed action', () => {
  assert.equal(parseMessage(valid, 423753027, me, now), 'apply');
  for (const action of ['status', 'dry-run', 'apply', 'verify', 'rollback']) {
    assert.equal(parseMessage({ ...valid, text: `/history3496@Godcrmdeploybot ${action}` }, 423753027, me, now), action);
  }
  for (const patch of [
    { from: { id: 1 } }, { chat: { id: 1, type: 'private' } }, { chat: { id: 423753027, type: 'group' } },
    { edit_date: now }, { forward_origin: {} }, { forward_date: now }, { forward_from: {} }, { via_bot: {} },
    { date: now - 121 }, { date: now + 31 }, { message_id: -1 },
    ...['/history3496 apply\n', '/history3496 apply;id', '/history3496 apply /tmp/x', '/history3496@OtherBot apply', '/history3496  apply'].map(text => ({ text })),
  ]) assert.equal(parseMessage({ ...valid, ...patch }, 423753027, me, now), null);
  assert.equal(parseMessage(valid, 0, me, now), null);
  assert.equal(parseMessage(valid, 423753027, { ...me, id: 1 }, now), null);
});
test('CLI arguments are fixed; dry-run receives no production credentials', () => {
  const args = cliArgs('apply', '/opt/godcrm-history3496/releases/' + 'a'.repeat(40), '/var/lib/godcrm-history3496/runs/123');
  assert.ok(args.includes('godcrm_prod'));
  assert.equal(args[args.indexOf('--messages')+1], '6061');
  assert.equal(args[args.indexOf('--target-space')+1], '44');
  assert.equal(args[args.indexOf('--target-name')+1], 'Играемся');
  assert.ok(args.includes('--related-sha256'));
  assert.throws(() => cliArgs('apply;id', '/tmp', '/tmp'));
  process.env.NODE_OPTIONS = '--require /untrusted';
  const env = safeEnv('dry-run');
  assert.equal(env.NODE_OPTIONS, undefined);
  assert.equal(env.POSTGRES_DB, 'godcrm_test');
  assert.equal(env.POSTGRES_PASSWORD, undefined);
  delete process.env.NODE_OPTIONS;
});
test('production environment refuses URL overrides, remote hosts, wrong database and missing credentials', () => {
  const credentials = { POSTGRES_HOST: '127.0.0.1', POSTGRES_PORT: '5432', POSTGRES_DB: 'godcrm_prod', POSTGRES_USER: 'operator', POSTGRES_PASSWORD: 'not-logged' };
  assert.deepEqual(Object.keys(safeEnv('apply', credentials)).sort(), ['LANG', 'NODE_ENV', 'PATH', ...Object.keys(credentials)].sort());
  for (const patch of [{ POSTGRES_URL: 'postgres://other' }, { NODE_OPTIONS: '--require bad' }, { POSTGRES_HOST: '<RING1_IP>' }, { POSTGRES_DB: 'godcrm_edit' }, { POSTGRES_PORT: '0' }, { POSTGRES_PASSWORD: '' }]) assert.throws(() => safeEnv('apply', { ...credentials, ...patch }));
  assert.throws(() => safeEnv('apply'));
});
test('status follows the latest completion even when a newer request was busy; incomplete intent stays conservative', () => {
  const fs = require('node:fs');
  const { admit, previousRuns, durableJson, needsVerify } = require('./history3496.cjs');
  const dir = fs.mkdtempSync('/tmp/history3496-status-');
  try {
    fs.mkdirSync(`${dir}/runs`, { mode: 0o700 });
    const m = { channel_commit_sha: 'a'.repeat(40), deployed_app_sha: 'a'.repeat(40) };
    const apply = admit({ message_id: 1 }, 'apply', m, dir);
    const busy = admit({ message_id: 2 }, 'apply', m, dir);
    durableJson(`${busy.run}/result.json`, { status: 'BUSY', finished_at: 200 });
    durableJson(`${apply.run}/result.json`, { status: 'SUCCEEDED', finished_at: 300 });
    assert.equal(previousRuns(dir)[0].run_id, apply.runId);
    fs.mkdirSync(`${dir}/runs/orphan`, { mode: 0o700 });
    assert.equal(needsVerify(previousRuns(dir), 'other'), true);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
