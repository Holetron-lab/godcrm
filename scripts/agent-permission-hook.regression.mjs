import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';

const hook = process.env.HOOK_UNDER_TEST || new URL('./agent-permission-hook.js', import.meta.url).pathname;
const call = { tool_name: 'Bash', tool_input: { command: 'pm2 restart godcrm' } };
function run(dialect, payload = call, extra = {}) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, AGENT_HOOK_DIALECT: dialect, AGENT_PERMS_TOKEN: '', AGENT_PERMS_FAIL_CLOSED: '', ...extra };
    delete env.KIMI_CRM_MANAGED;
    const child = spawn(process.execPath, [hook], { env, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', c => { out += c; });
    child.stderr.resume();
    child.on('error', reject);
    child.on('close', code => resolve({ code, out }));
    child.stdin.end(JSON.stringify(payload));
  });
}
for (const dialect of ['', 'claude', 'codex', 'kimi']) {
  test(`${dialect || 'default'} denies critical commands without KIMI_CRM_MANAGED`, async () => {
    const result = await run(dialect);
    assert.equal(result.code, 0);
    assert.equal(JSON.parse(result.out).hookSpecificOutput.permissionDecision, 'deny');
  });
  test(`${dialect || 'default'} preserves fail-closed without KIMI_CRM_MANAGED`, async () => {
    const result = await run(dialect, { tool_name: 'Read', tool_input: {} }, { AGENT_PERMS_FAIL_CLOSED: '1' });
    assert.equal(JSON.parse(result.out).hookSpecificOutput.permissionDecision, 'deny');
  });
}
test('headless Kimi allows silently and converts policy ask to deny', async () => {
  const allowed = await run('kimi', { tool_name: 'Read', tool_input: {} });
  assert.equal(allowed.out, '');
  const server = createServer((_req, res) => res.end(JSON.stringify({ data: { decision: 'ask', reason: 'approval required' } })));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const result = await run('kimi', { tool_name: 'Read', tool_input: {} }, {
      AGENT_PERMS_TOKEN: 'test-only', AGENT_PERMS_CHECK_URL: `http://127.0.0.1:${server.address().port}`,
    });
    assert.equal(JSON.parse(result.out).hookSpecificOutput.permissionDecision, 'deny');
  } finally { await new Promise(resolve => server.close(resolve)); }
});
