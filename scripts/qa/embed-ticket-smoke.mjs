import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('../../', import.meta.url));
const crmOrigin = 'http://127.0.0.1:5173';
const parentOrigin = 'http://127.0.0.1:5174';
const ticket = 'browser-one-time-ticket';
const accessToken = 'browser-embed-access-token';
let browser;
let vite;
let ticketRequests = 0;
let refreshRequests = 0;
let spacesAuthorization = null;
let redemptionSummary = null;
const consoleMessages = [];

const parentServer = createServer((request, response) => {
  if (request.url === '/') {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(`<!doctype html><html><head><meta name="csrf-token" content="browser-csrf-token"></head><body><script src="${crmOrigin}/embed.js" data-auth="ticket" data-client-id="level" data-ticket-url="/api/embed/godcrm/ticket" data-space="35"></script></body></html>`);
    return;
  }
  response.writeHead(404).end();
});

async function waitForVite() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      if ((await fetch(`${crmOrigin}/embed/chat?auth=ticket&client_id=level`)).ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Vite did not start');
}

try {
  await new Promise(resolve => parentServer.listen(5174, '127.0.0.1', resolve));
  vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5173', '--strictPort'], {
    cwd: root,
    stdio: 'ignore',
  });
  await waitForVite();
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on('console', message => consoleMessages.push(message.text()));

  await page.route(`${crmOrigin}/api/v3/**`, async route => {
    await route.fulfill({
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ success: true, data: [] }),
    });
  });
  await page.route('**/api/embed/godcrm/ticket', async route => {
    ticketRequests += 1;
    assert.equal(route.request().method(), 'POST');
    const hasValidCsrf = route.request().headers()['x-csrf-token'] === 'browser-csrf-token';
    await route.fulfill({
      status: hasValidCsrf ? 200 : 419,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
      body: JSON.stringify(hasValidCsrf
        ? { data: { ticket, expires_in: 60 } }
        : { message: 'CSRF token mismatch.' }),
    });
  });
  await page.route(`${crmOrigin}/api/v3/embed/session`, async route => {
    const request = route.request();
    const body = request.postDataJSON();
    redemptionSummary = { clientId: body.client_id, parentOrigin: body.parent_origin, ticketMatches: body.ticket === ticket };
    assert.deepEqual(body, { client_id: 'level', ticket, parent_origin: parentOrigin });
    assert.equal(request.headers()['cookie'], undefined);
    await route.fulfill({
      status: 200,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
      body: JSON.stringify({ data: {
        accessToken,
        expiresIn: 900,
        user: { id: '77', email: 'admin@example.test', name: 'Admin', role: 'admin' },
        space_id: 35,
      } }),
    });
  });
  await page.route(`${crmOrigin}/api/v3/auth/refresh`, async route => {
    refreshRequests += 1;
    await route.fulfill({ status: 401, body: '' });
  });
  await page.route(`${crmOrigin}/api/v3/spaces`, async route => {
    spacesAuthorization = route.request().headers()['authorization'];
    await route.fulfill({
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ data: [
        { id: 35, name: 'Level', icon: 'L', type: 'business' },
        { id: 11, name: 'Eleven', icon: 'E', type: 'business' },
      ] }),
    });
  });

  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.setCookieControls', {
    enableThirdPartyCookieRestriction: true,
    disableThirdPartyCookieMetadata: false,
    disableThirdPartyCookieHeuristics: false,
  });
  await page.goto(parentOrigin);
  const frameElement = await page.waitForSelector('iframe', { state: 'attached' });
  const frame = await frameElement.contentFrame();
  assert.ok(frame);
  await frame.waitForSelector('button[title="Level"]', { state: 'attached' }).catch(async error => {
    const body = await frame.locator('body').innerText();
    throw new Error(`${error.message}\nEmbed body: ${body}\nTicket requests: ${ticketRequests}; refresh: ${refreshRequests}; spaces authorized: ${spacesAuthorization !== null}\nRedemption: ${JSON.stringify(redemptionSummary)}\nBrowser errors: ${consoleMessages.join(' | ')}`);
  });
  await page.getByRole('button', { name: 'Open AI chat' }).click();
  await frame.waitForSelector('button[title="Level"]', { state: 'visible' });

  assert.equal(ticketRequests, 1);
  assert.equal(refreshRequests, 0);
  assert.equal(spacesAuthorization, `Bearer ${accessToken}`);
  assert.ok(!frame.url().includes(ticket));
  assert.ok(!frame.url().includes(accessToken));
  assert.ok(!frame.url().includes('space='));
  const persistedAuth = await frame.evaluate(() => {
    try { return localStorage.getItem('god-crm-auth'); } catch { return 'blocked'; }
  });
  assert.ok(persistedAuth === null || persistedAuth === 'blocked');
  assert.ok(!consoleMessages.join('\n').includes(ticket));
  assert.ok(!consoleMessages.join('\n').includes(accessToken));

  process.stdout.write(JSON.stringify({
    status: 'PASS',
    thirdPartyCookieRestriction: true,
    ticketRequests,
    refreshRequests,
    spacesAuthorization: 'Bearer [redacted]',
    spaceId: 35,
    persistedAuth,
    sensitiveLeaks: false,
  }) + '\n');
} finally {
  await browser?.close();
  if (vite && !vite.killed) vite.kill('SIGTERM');
  await new Promise(resolve => parentServer.close(resolve));
}
