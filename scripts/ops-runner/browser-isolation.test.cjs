const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { chromium } = require('playwright');
require('./isolation.test.cjs');

test('Chromium sandbox and fixture server work inside isolated loopback', async () => {
  const server = http.createServer((_req, res) => res.end('<button>Hello</button>'));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true, chromiumSandbox: true });
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    assert.equal(await page.getByRole('button').textContent(), 'Hello');
    await page.screenshot({ path: '/work/browser-proof.png' });
    // No host service/network fallback. Chromium failure is a failed profile.
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
});
