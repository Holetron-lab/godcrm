// Production-bundle regression: virtual id origin, fixture auth, no live API/DB.
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import express from 'express';
import { chromium, expect } from '@playwright/test';

const root = resolve(process.argv[2] || process.cwd());
const artifacts = await mkdtemp(join(tmpdir(), 'login-return-'));
const origin = 'https://id.godcrm.ai';
const query = new URLSearchParams({
  client_id: 'forgejo', response_type: 'code',
  redirect_uri: 'https://godcrm.ai/git/user/oauth2/GOD%20CRM/callback',
  state: 'a+b&extra=c%25', nonce: 'n+with&extra=c%',
});
const authorize = `/oauth/authorize?${query}`;
const cases = [
  { target: authorize, expected: authorize },
  { target: '/oauth/authorize?state=%E0%A4%A&nonce=%', expected: '/oauth/authorize?state=%E0%A4%A&nonce=%' },
  ...[
    'https://evil.example/phish', '//evil.example/phish', '/\\evil.example',
    '/\t/evil.example', '/spaces\u0000', '/login', '/AUTH/login',
    '/%61uth/login', '/spaces/%2e%2e/auth/login', '/spaces%2f..%2fauth/login', '/bad%escape',
    '/spaces%3f/../auth/login', '/spaces%23/../auth/login',
  ].map(target => ({ target, expected: '/spaces' })),
  { target: undefined, from: '/spaces?tab=recent#saved', expected: '/spaces?tab=recent#saved' },
  { target: 'https://evil.example', from: '/spaces?tab=recent', expected: '/spaces?tab=recent' },
  { target: undefined, from: '/\\evil.example', expected: '/spaces' },
];
const app = express();
app.use(express.static(join(root, 'dist')));
app.get('*', (_req, res) => res.sendFile(join(root, 'dist/index.html')));
const server = await new Promise(resolveServer => {
  const instance = app.listen(0, '127.0.0.1', () => resolveServer(instance));
});
const base = `http://127.0.0.1:${server.address().port}`;
const results = [];
let browser;
try {
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  for (const mode of ['returning', 'fresh']) for (const scenario of cases) {
    const context = await browser.newContext({ serviceWorkers: 'block' });
    await context.route('**/*', route => route.abort());
    await context.routeWebSocket('**/*', socket => socket.close());
    const page = await context.newPage();
    let authenticated = mode === 'returning';
    let resumed;
    const errors = [];
    const external = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) {
        if (route.request().isNavigationRequest()) external.push(url.href);
        return route.abort();
      }
      if (url.pathname === '/oauth/authorize') {
        resumed = url.pathname + url.search;
        return route.fulfill({ contentType: 'text/html', body: '<p>Captured authorize return</p>' });
      }
      if (url.pathname.startsWith('/api/')) {
        if (url.pathname.endsWith('/auth/login')) authenticated = true;
        if (/\/auth\/(me|refresh|login)$/.test(url.pathname)) {
          return route.fulfill({ status: authenticated ? 200 : 401, json: authenticated
            ? { success: true, data: { accessToken: 'fixture-only', user: { id: 7, email: 'oidc@example.test', name: 'Test', role: 'member' } } }
            : { error: { message: 'No fixture session' } } });
        }
        return route.fulfill({ json: { success: true, data: [] } });
      }
      const response = await context.request.get(base + url.pathname + url.search);
      return route.fulfill({ response });
    });
    if (scenario.from) await page.addInitScript(from => {
      history.replaceState({ usr: { from } }, '', location.href);
    }, scenario.from);
    const search = scenario.target === undefined ? '' : `?redirect=${encodeURIComponent(scenario.target)}`;
    await page.goto(`${origin}/auth/login${search}`);
    if (mode === 'fresh') {
      const email = page.locator('input[type="email"]');
      const password = page.locator('input[type="password"]');
      await expect(email).toHaveAccessibleName(/.+/);
      await expect(password).toHaveAccessibleName(/.+/);
      await email.fill('oidc@example.test');
      await email.press('Tab');
      await expect(password).toBeFocused();
      await password.fill('fixture-password');
      await password.press('Enter');
    }
    await expect(page).toHaveURL(origin + scenario.expected);
    await page.waitForLoadState('networkidle');
    if (scenario.expected.startsWith('/oauth/authorize')) assert.equal(resumed, scenario.expected);
    if (scenario.expected === authorize) {
      assert.deepEqual(Object.fromEntries(new URL(page.url()).searchParams), Object.fromEntries(query));
    }
    assert.deepEqual(external, []);
    assert.deepEqual(errors, []);
    results.push({ mode, ...scenario, actual: page.url(), external, errors });
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await context.close();
    console.log(`PASS ${mode}: ${scenario.target ?? 'location.state'}`);
  }
  console.log(`${results.length} login return cases PASS (fresh + returning; keyboard and accessible fields checked)`);
} finally {
  await writeFile(join(artifacts, 'results.json'), JSON.stringify(results, null, 2));
  await browser?.close();
  await new Promise(resolveServer => server.close(resolveServer));
  console.log(`Artifacts: ${artifacts}`);
}
