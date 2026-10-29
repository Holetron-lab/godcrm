import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
import { createFixtureServer, openFixture } from './browser-fixture.mjs';
const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL('../../', import.meta.url));
const artifacts = process.env.CHAT_SPACE_ARTIFACTS || '/tmp/chat-space-21919-browser';
await mkdir(artifacts, { recursive: true });
const entry = 'src/tests/chat-space-fixture/index.html';
const server = await createFixtureServer({ root, artifacts, entry });
let browser;
const evidence = [];
try {
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const opener = page.getByRole('button', { name: 'Выбрать Space', exact: true });
    const fixture = await openFixture({ server, page, entry, ready: page.getByRole('button', { name: 'Ещё' }) });
    assert.equal(await opener.count(), 0);
    await page.getByRole('button', { name: 'Ещё' }).click();
    assert.equal(await page.getByRole('menuitem', { name: 'Удалить чат' }).count(), 1);
    await page.getByRole('menuitem', { name: 'Настройки чата' }).click();
    await opener.click();
    const dialog = page.getByRole('dialog', { name: 'Space чата', exact: true });
    await dialog.waitFor();
    const select = page.getByLabel('Выберите Space', { exact: true });
    await select.selectOption('11');
    assert.equal(await select.getByRole('option').count(), 3); // placeholder + owner + admin
    await page.keyboard.press('Escape');
    assert.equal(await dialog.count(), 0);
    // Radix restores focus after its close lifecycle; wait for that lifecycle.
    await page.waitForFunction(() => document.activeElement?.textContent === 'Выбрать Space');
    assert.equal(await opener.evaluate(element => document.activeElement === element), true);
    assert.equal(await page.getByLabel('Черновик').inputValue(), 'Не потерять текст');
    await opener.click();
    await select.selectOption('12');
    await page.addScriptTag({ path: require.resolve('axe-core/axe.min.js') });
    const accessibility = await page.evaluate(async () => window.axe.run([...document.querySelectorAll('[role="dialog"]')].find(element => element.textContent.includes('Выберите Space'))));
    assert.deepEqual(accessibility.violations.map(item => ({ id: item.id, impact: item.impact })), []);
    for (let tab = 0; tab < 6; tab++) {
      await page.keyboard.press('Tab');
      assert.equal(await dialog.evaluate(element => element.contains(document.activeElement)), true);
    }
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: join(artifacts, `dialog-${width}.png`), fullPage: true });
    await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await dialog.waitFor({ state: 'detached' });
    await page.getByText('Design #12', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Закрыть', exact: true }).click();
    await page.waitForFunction(() => document.activeElement?.getAttribute('title') === 'Ещё');
    await fixture.assertStable();
    evidence.push({ width, keyboard: 'PASS', accessibility: 'PASS', savedSpace: 12, console: 'clean' });
    await page.close();
  }
  for (const variant of ['participant', 'empty']) {
    const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
    const opener = page.getByRole('button', { name: 'Выбрать Space', exact: true });
    const fixture = await openFixture({ server, page, entry: `${entry}?variant=${variant}`, ready: page.getByRole('button', { name: 'Ещё' }) });
    await page.getByRole('button', { name: 'Ещё' }).click();
    await page.getByRole('menuitem', { name: 'Настройки чата' }).click();
    if (variant === 'participant') {
      await page.getByText('Владелец чата должен выбрать Space', { exact: true }).waitFor();
      assert.equal(await opener.isDisabled(), true);
    } else {
      await opener.click();
      await page.getByText('Нет доступных Spaces. Нужны права владельца или администратора Space.', { exact: true }).waitFor();
      assert.equal(await page.getByRole('button', { name: 'Сохранить', exact: true }).isDisabled(), true);
    }
    await fixture.assertStable();
    evidence.push({ variant, result: 'PASS' });
    await page.close();
  }
} finally {
  await browser?.close();
  await server.close();
  await writeFile(join(artifacts, 'evidence.json'), JSON.stringify(evidence, null, 2));
  process.stdout.write(`${JSON.stringify(evidence)}\nArtifacts: ${artifacts}\n`);
}
