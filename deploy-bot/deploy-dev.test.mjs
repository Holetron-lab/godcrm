// @vitest-environment node
import { test, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const source = readFileSync(new URL('./bot.js', import.meta.url), 'utf8');
const make = 'make -C /root/production/business-crm dev';

// Load the actual registration and handler. All shell and Telegram IO is fake.
function fixture(env = {}, execute = async () => ({ stdout: '', stderr: '' })) {
  const handlers = [], commands = [], messages = [];
  class Telegram {
    onText(regex, handler) { handlers.push([regex, handler]); }
    on() {}
    async sendMessage(_chat, text) { messages.push(text); return { message_id: 7 }; }
    async editMessageText(text) { messages.push(text); }
  }
  const context = vm.createContext({
    require: name => name === 'dotenv' ? { config() {} }
      : name === 'node-telegram-bot-api' ? Telegram
      : name === 'child_process' ? { exec() {} }
      : name === 'util' ? { promisify: () => async (command, options) => {
        commands.push({ command, options });
        return execute(command, options);
      } } : require(name),
    process: { env: { BOT_TOKEN: 'fixture', OWNER_ID: '1', ...env } },
    console: { log() {}, error() {} }, Buffer, setInterval: () => 0,
  });
  vm.runInContext(source, context);
  const [regex, handler] = handlers.find(([r]) => r.test('/deploy_dev'));
  return {
    commands, messages, regex,
    trigger(id = 1, actor = 1) {
      handler({ text: '/deploy_dev', from: { id: actor }, chat: { id: 1 }, message_id: id });
    },
    async settled() {
      await vi.waitFor(() => expect(vm.runInContext('activeLocks.size', context)).toBe(0));
    },
  };
}

test('runs make dev once on the source host, even with legacy DEV overrides', async () => {
  const f = fixture({ DEV_HOST: 'wrong-destination', DEV_RSYNC_TARGET: 'legacy-host', DEV_PM2: 'wrong-process' });
  f.trigger();
  await f.settled();
  expect(f.commands).toEqual([{ command: make, options: { timeout: 900000 } }]);
  expect(f.messages.at(-1)).toContain('make dev completed');
  expect(f.messages.at(-1)).toContain('Gate 1 and real API smoke still required');
  expect(f.messages.at(-1)).toContain('https://dev.godcrm.ai');
});

test('remote source receives make, never the DEV diagnostics host', async () => {
  const f = fixture({ PROD_HOST: 'source-host', DEV_HOST: 'dev-host' });
  f.trigger();
  await f.settled();
  expect(f.commands).toEqual([{
    command: `ssh -o BatchMode=yes -o ConnectTimeout=10 source-host '${make}'`,
    options: { timeout: 900000 },
  }]);
});

test('rejects a mismatched checkout before executing any command', async () => {
  const f = fixture({ PROD_CODE: '/other-checkout' });
  f.trigger();
  await f.settled();
  expect(f.commands).toEqual([]);
  expect(f.messages.at(-1)).toContain('requires PROD_CODE=/root/production/business-crm');
});

test.each(['install failed', 'build failed', 'restart failed', 'command timed out'])(
  'reports %s without success, fallback or retry; releases lock', async reason => {
    let fail = true;
    const f = fixture({}, async () => {
      if (fail) throw Object.assign(new Error(reason), { code: 2, stderr: reason });
      return { stdout: '', stderr: '' };
    });
    f.trigger();
    await f.settled();
    expect(f.commands).toHaveLength(1);
    expect(f.messages.at(-1)).toContain(`DEV deploy failed: ${reason}`);
    expect(f.messages.some(text => text.includes('make dev completed'))).toBe(false);
    fail = false;
    f.trigger(2);
    await f.settled();
    expect(f.commands).toHaveLength(2);
    expect(f.messages.at(-1)).toContain('make dev completed');
  },
);

test('denies unauthorized users without commands', async () => {
  const f = fixture();
  f.trigger(1, 2);
  await f.settled();
  expect(f.commands).toEqual([]);
  expect(f.messages.at(-1)).toContain('Access denied');
});

test('deduplicates deliveries and rejects a concurrent deployment', async () => {
  let resolve;
  const pending = new Promise(done => { resolve = done; });
  const f = fixture({}, () => pending);
  f.trigger();
  await vi.waitFor(() => expect(f.commands).toHaveLength(1));
  f.trigger();
  f.trigger(2);
  expect(f.commands).toHaveLength(1);
  expect(f.messages.filter(text => text.includes('skipping duplicate'))).toHaveLength(2);
  resolve({ stdout: '', stderr: '' });
  await f.settled();
  f.trigger();
  expect(f.commands).toHaveLength(1);
});

test('accepts only an exact command, optionally addressed to the bot', () => {
  const { regex } = fixture();
  for (const input of ['/deploy_dev', '/deploy_dev@GodcrmBot', '/deploy_dev  ']) expect(regex.test(input)).toBe(true);
  for (const input of ['text /deploy_dev', '/deploy_dev_check', '/deploy_dev prod', '/deploy_dev;id']) expect(regex.test(input)).toBe(false);
});
