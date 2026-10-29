import assert from 'node:assert/strict';
import { join } from 'node:path';
import { createServer } from 'vite';

// Keep fixture HTML/TSX under src/tests in the caller's isolated worktree.
export async function createFixtureServer({ root, artifacts, entry }) {
  const server = await createServer({
    root, configFile: false, envFile: false,
    cacheDir: join(artifacts, 'vite-cache'),
    resolve: { alias: { '@': join(root, 'src') }, dedupe: ['react', 'react-dom'] },
    css: { postcss: root },
    esbuild: { jsx: 'automatic' },
    optimizeDeps: {
      entries: [entry],
      include: ['react', 'react-dom/client', 'react/jsx-runtime', 'react/jsx-dev-runtime'],
      holdUntilCrawlEnd: true,
    },
    server: { host: '127.0.0.1', port: 0, hmr: false },
  });
  try {
    await server.listen();
    return server;
  } catch (error) {
    await server.close();
    throw error;
  }
}

async function waitForFixtureIdle(server, timeout) {
  let timer;
  try {
    await Promise.race([
      server.waitForRequestsIdle(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Fixture Vite crawl timed out')), timeout);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

// Call once, before any interaction. Never retry/reload a failed assertion.
// `ready` is a Playwright Locator for the rendered component, not just #root.
export async function openFixture({ server, page, entry, ready, timeout = 30_000 }) {
  const origin = new URL(server.resolvedUrls.local[0]).origin;
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('response', response => {
    if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`);
  });
  page.on('requestfailed', request => {
    errors.push(`Failed request: ${request.url()} (${request.failure()?.errorText})`);
  });
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin === origin && url.pathname !== '/api' && !url.pathname.startsWith('/api/')) {
      return route.continue();
    }
    errors.push(`Unexpected request: ${url.origin}${url.pathname}`);
    return route.abort();
  });
  page.setDefaultTimeout(timeout);
  page.setDefaultNavigationTimeout(timeout);
  const url = new URL(entry, `${origin}/`).href;
  assert.equal(new URL(url).origin, origin, 'Fixture must use the local Vite server');
  await page.goto(url);
  await ready.waitFor({ state: 'visible' });
  await waitForFixtureIdle(server, timeout);
  // Start assertions in a fresh document after dependency preparation.
  await page.reload();
  await ready.waitFor({ state: 'visible' });
  await waitForFixtureIdle(server, timeout);
  await page.waitForFunction(() => document.fonts.status === 'loaded');
  assert.deepEqual(errors, [], 'Fixture bootstrap errors');
  const documentId = await page.evaluate(() => {
    window.__fixtureDocumentId = crypto.randomUUID();
    return window.__fixtureDocumentId;
  });
  return {
    async assertStable() {
      assert.equal(await page.evaluate(() => window.__fixtureDocumentId), documentId,
        'Fixture reloaded during assertions; prepare lazy dependencies before testing');
      assert.deepEqual(errors, [], 'Fixture browser/network errors');
    },
  };
}
