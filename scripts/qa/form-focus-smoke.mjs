import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { expect } from '@playwright/test';
import { createFixtureServer, openFixture } from './browser-fixture.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const artifacts = await mkdtemp(join(tmpdir(), 'form-focus-'));
const entry = 'src/tests/form-focus-fixture/index.html';
const server = await createFixtureServer({ root, artifacts, entry });
let browser;
try {
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  for (const width of [1440, 390]) for (const theme of ['light', 'dark']) {
    for (const kind of ['create', 'edit', 'json', 'password', 'details']) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      const opener = page.getByRole('button', { name: 'Open form' });
      const fixture = await openFixture({ server, page, entry: `${entry}?kind=${kind}&theme=${theme}`, ready: opener });
      if (kind === 'password') {
        await expect(page.getByLabel('Password')).not.toBeFocused();
        await opener.focus();
        await page.keyboard.press('Tab');
        await expect(page.getByLabel('Password')).toBeFocused();
      } else if (kind === 'details') {
        await page.getByRole('button', { name: 'Edit', exact: true }).click();
        const name = page.getByRole('textbox', { name: 'Name', exact: true });
        await expect(name).toBeFocused();
        await name.fill('Draft');
        await page.getByPlaceholder('Description...').fill('Keep typing');
        await expect(page.getByPlaceholder('Description...')).toBeFocused();
        await page.getByRole('button', { name: 'Cancel', exact: true }).click();
        await expect(page.getByText('Reports', { exact: true })).toBeVisible();
      } else {
        await opener.focus();
        await page.keyboard.press('Enter');
        const name = page.getByRole('textbox', { name: kind === 'json' ? 'Имя ключа' : 'Folder name' });
        await expect(name).toBeFocused();
        if (kind === 'edit') {
          await page.getByRole('button', { name: 'Delete', exact: true }).click();
          await page.getByRole('button', { name: 'Cancel', exact: true }).click();
          await expect(name).toBeFocused();
        }
        await name.fill('Typed');
        await name.press('Tab');
        await expect(name).not.toBeFocused();
        await name.focus();
      }
      await page.addScriptTag({ content: await readFile(join(root, 'node_modules/axe-core/axe.min.js'), 'utf8') });
      const violations = await page.evaluate(async () => (await window.axe.run('section', {
        runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] },
      })).violations);
      await writeFile(join(artifacts, `${kind}-${width}-${theme}-axe.json`), JSON.stringify(violations, null, 2));
      // Existing theme contrast debt is reported separately; this focus-only
      // change must pass the remaining accessibility checks without exceptions.
      const contrast = violations.filter(({ id }) => id === 'color-contrast');
      assert.deepEqual(violations.filter(({ id }) => id !== 'color-contrast').map(({ id }) => id), []);
      await page.screenshot({ path: join(artifacts, `${kind}-${width}-${theme}.png`), fullPage: true });
      if (kind === 'json') {
        await page.getByRole('button', { name: 'Добавить', exact: true }).click();
        await expect(page.getByLabel('Result')).toHaveText('string:Typed');
      } else if (kind === 'create' || kind === 'edit') {
        await page.keyboard.press('Enter');
        await expect(page.getByLabel('Result')).toHaveText('Typed');
        await opener.click();
        await expect(page.getByRole('textbox', { name: 'Folder name' })).toBeFocused();
      }
      await fixture.assertStable();
      process.stdout.write(JSON.stringify({ kind, width, theme, focus: 'PASS', axeExceptContrast: 'PASS', contrastNodes: contrast.flatMap(v => v.nodes).length }) + '\n');
      await page.close();
    }
  }
} finally { await browser?.close(); await server.close(); process.stdout.write(`Artifacts: ${artifacts}\n`); }
