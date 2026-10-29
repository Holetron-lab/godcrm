import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { createFixtureServer, openFixture } from './browser-fixture.mjs';
const root = fileURLToPath(new URL('../../', import.meta.url));
const artifacts = await mkdtemp(join(tmpdir(), 'chat-list-'));
const entry = 'src/tests/chat-list-fixture/index.html';
const server = await createFixtureServer({ root, artifacts, entry });
let browser;
try {
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  for (const width of [1440, 390]) {
    for (const theme of ['light', 'dark']) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, locale: 'ru-RU' });
      const chat = page.getByRole('button', { name: 'Команда — обсуждение следующего релиза', exact: true });
      const fixture = await openFixture({ server, page, entry, ready: chat });
      await page.evaluate(theme => {
        document.documentElement.dataset.theme = theme;
        document.documentElement.classList.toggle('dark', theme === 'dark');
      }, theme);
      await chat.focus();
      await page.keyboard.press('Enter');
      assert.equal(await page.getByLabel('Выбранный чат').textContent(), '1');
      const trigger = page.getByLabel('Ещё: Команда — обсуждение следующего релиза');
      await trigger.focus();
      await page.keyboard.press('Space');
      await page.keyboard.press('Tab');
      const pin = page.getByRole('button', { name: 'Закрепить', exact: true });
      assert.ok(await pin.evaluate(el => el === document.activeElement));
      assert.ok(await trigger.evaluate(el => {
        const next = document.querySelector('summary[aria-label="Ещё: Дизайн"]').getBoundingClientRect();
        const menu = el.parentElement;
        return menu.contains(document.elementFromPoint(next.x + next.width / 2, next.y + next.height / 2));
      }), 'Open menu must cover the following row action trigger');
      await page.screenshot({ path: join(artifacts, `${width}-${theme}-menu.png`), fullPage: true });
      await page.keyboard.press('Escape');
      assert.ok(await trigger.evaluate(el => el === document.activeElement && !el.parentElement.open));
      await chat.click({ button: 'right' });
      await page.keyboard.press('Tab');
      await page.keyboard.press('Enter');
      assert.equal(await page.getByLabel('Действие').textContent(), 'pin:1');
      assert.equal(await page.getByLabel('Выбранный чат').textContent(), '1');
      const settings = page.getByRole('button', { name: /: Команда — обсуждение следующего релиза/ });
      await settings.focus();
      await page.keyboard.press('Space');
      assert.equal(await page.getByLabel('Действие').textContent(), 'settings');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      if (process.env.AXE_SCRIPT) {
        await page.addScriptTag({ content: await readFile(process.env.AXE_SCRIPT, 'utf8') });
        // Audit the changed list and settings control. The unchanged empty
        // message list has separate contrast/scroll-region accessibility debt.
        await trigger.click();
        const violations = await page.evaluate(async () => (await window.axe.run({ include: [
          ['section[aria-label="Чаты"]'],
          ['button[aria-label^="Настройки чата:"]'],
        ] }, {
          runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] },
        })).violations);
        assert.deepEqual(violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => n.target) })), []);
      }
      await fixture.assertStable();
      process.stdout.write(JSON.stringify({ width, theme, keyboard: 'PASS', contextMenu: 'PASS', axe: process.env.AXE_SCRIPT ? 'PASS' : 'SKIPPED' }) + '\n');
      await page.close();
    }
  }
} finally {
  await browser?.close();
  await server.close();
  process.stdout.write(`Artifacts: ${artifacts}\n`);
}
