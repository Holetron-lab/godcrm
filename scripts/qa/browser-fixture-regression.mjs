import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { chromium } from 'playwright';
import { createFixtureServer, openFixture } from './browser-fixture.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));

for (let run = 1; run <= 3; run += 1) {
  test(`cold bootstrap ${run}: Divider events survive at desktop/mobile widths`, { timeout: 90_000 }, async () => {
    const artifacts = await mkdtemp(join(tmpdir(), 'fixture-regression-'));
    const directory = await mkdtemp(join(root, 'src/tests/fixture-bootstrap-'));
    const entry = relative(root, join(directory, 'index.html'));
    let server;
    let browser;
    try {
      await writeFile(join(directory, 'index.html'), `<!doctype html>
<html data-theme="light"><head><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body><div id="root"></div><script type="module" src="./main.jsx"></script></body></html>`);
      await writeFile(join(directory, 'main.jsx'), `
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { DividerPreview } from '@/features/tables/components/FormBuilder/DividerPreview';
import '@/styles/index.css';
function Fixture() {
  const [selected, setSelected] = useState(false);
  window.events ??= [];
  const record = name => () => window.events.push(name);
  return <main className="p-4"><DividerPreview isSelected={selected}
    onClick={() => { window.events.push('select'); setSelected(value => !value); }}
    onMoveUp={record('up')} onMoveDown={record('down')} onDelete={record('delete')}
    canMoveUp canMoveDown /></main>;
}
createRoot(document.getElementById('root')).render(<Fixture />);
`);
      server = await createFixtureServer({ root, artifacts, entry });
      browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
      for (const width of [1440, 390]) {
        const page = await browser.newPage({ viewport: { width, height: 900 } });
        try {
          const control = page.getByRole('button', { name: 'Выбрать разделитель', exact: true });
          const fixture = await openFixture({ server, page, entry, ready: control });
          await control.focus();
          await page.keyboard.press('Enter');
          await page.keyboard.press('Space');
          await control.click();
          await page.getByRole('button', { name: 'Переместить вверх' }).click();
          await page.getByRole('button', { name: 'Переместить вниз' }).click();
          await page.getByRole('button', { name: 'Удалить разделитель' }).click();
          assert.equal(await control.getAttribute('aria-pressed'), 'true');
          assert.deepEqual(await page.evaluate(() => window.events),
            ['select', 'select', 'select', 'up', 'down', 'delete']);
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
          await fixture.assertStable();
          process.stdout.write(JSON.stringify({ run, width, events: 'PASS', stable: true }) + '\n');

          // Negative controls: a reload or browser error must never become a pass.
          if (run === 1) {
            await page.reload();
            await control.waitFor();
            await assert.rejects(() => fixture.assertStable(), /reloaded during assertions/);
          } else if (run === 2) {
            await page.evaluate(() => console.error('regression sentinel'));
            await assert.rejects(() => fixture.assertStable(), /browser\/network errors/);
          } else {
            let apiReachedServer = false;
            server.middlewares.use((request, response, next) => {
              if (request.url === '/api/fixture-bootstrap-sentinel') apiReachedServer = true;
              next();
            });
            await page.evaluate(async () => {
              await fetch('/api/fixture-bootstrap-sentinel').catch(() => {});
              await fetch('https://fixture.invalid/sentinel').catch(() => {});
            });
            await assert.rejects(() => fixture.assertStable(), /browser\/network errors/);
            assert.equal(apiReachedServer, false, 'API request must be blocked before the server');
          }
        } finally {
          await page.close();
        }
      }
    } finally {
      await browser?.close();
      await server?.close();
      await rm(directory, { recursive: true, force: true });
      process.stdout.write(`Artifacts: ${artifacts}\n`);
    }
  });
}
