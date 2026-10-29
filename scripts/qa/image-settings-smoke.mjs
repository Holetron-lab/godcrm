import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createFixtureServer, openFixture } from './browser-fixture.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const artifacts = await mkdtemp(join(tmpdir(), 'image-settings-22314-'));
const entry = 'src/tests/image-settings-fixture/index.html';
const server = await createFixtureServer({ root, artifacts, entry });
const results = [];
let browser;
try {
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  for (const theme of ['light', 'dark']) for (const language of ['en', 'ru']) for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    const dialog = page.getByRole('dialog', { name: 'Images', exact: true });
    const fixture = await openFixture({ server, page, entry: `${entry}?theme=${theme}&language=${language}`, ready: dialog });
    const fit = dialog.getByRole('combobox', { name: language === 'en' ? 'Image fit' : 'Заполнение' });
    const image = dialog.getByRole('img').first();
    for (const [value, en, ru] of [['cover', 'Cover', 'Заполнить'], ['contain', 'Contain', 'Вписать'], ['fill', 'Stretch', 'Растянуть'], ['none', 'Original', 'Оригинал']]) {
      await fit.click();
      await page.getByRole('option', { name: new RegExp(`^${language === 'en' ? en : ru} —`) }).click();
      assert.equal(await image.evaluate(el => getComputedStyle(el).objectFit), value);
      assert.ok(await image.evaluate(el => el.complete && el.naturalWidth === 240));
      await image.screenshot({ path: join(artifacts, `${theme}-${language}-${width}-${value}.png`) });
    }
    const shapes = language === 'en' ? ['Square', 'Rounded', 'Circle'] : ['Квадрат', 'Скруглённый', 'Круг'];
    for (const [index, name] of shapes.entries()) {
      await dialog.getByRole('button', { name, exact: true }).click();
      const radius = await image.evaluate(el => getComputedStyle(el).borderRadius);
      assert.equal(index === 0 ? radius === '0px' : radius !== '0px', true);
    }
    await dialog.getByRole('checkbox', { name: language === 'en' ? 'Show filename' : 'Показывать имя файла' }).check();
    assert.ok(await dialog.getByText('wide.svg', { exact: true }).isVisible());
    await dialog.getByRole('checkbox', { name: language === 'en' ? 'Enlarge on hover' : 'Увеличивать при наведении' }).check();
    await image.hover();
    await page.waitForTimeout(250);
    assert.notEqual(await image.evaluate(el => getComputedStyle(el).transform), 'none');
    await dialog.getByRole('button', { name: language === 'en' ? /^Carousel / : /^Карусель / }).click();
    const next = dialog.getByRole('button', { name: language === 'en' ? 'Next image' : 'Следующее изображение' });
    await next.focus();
    await page.keyboard.press('Enter');
    assert.match(await image.getAttribute('src'), /portrait.svg$/);
    const opener = dialog.getByRole('button', { name: language === 'en' ? 'Open image 2' : 'Открыть изображение 2' });
    await opener.focus();
    await page.keyboard.press('Enter');
    const viewer = page.getByRole('dialog', { name: 'portrait.svg', exact: true });
    await viewer.waitFor();
    await page.keyboard.press('Escape');
    await viewer.waitFor({ state: 'hidden' });
    await page.waitForFunction(label => document.activeElement?.getAttribute('aria-label') === label, await opener.getAttribute('aria-label'));
    await dialog.getByRole('checkbox', { name: language === 'en' ? 'Open lightbox on click' : 'Открывать в лайтбоксе по клику' }).uncheck();
    assert.equal(await dialog.getByRole('button', { name: /^(Open image|Открыть изображение) \d/ }).count(), 0);
    await dialog.getByRole('button', { name: language === 'en' ? /^Grid / : /^Сетка / }).click();
    await dialog.getByRole('spinbutton', { name: language === 'en' ? 'Thumbnail size (px)' : 'Размер миниатюры (px)' }).fill('48');
    assert.equal(await image.evaluate(el => el.getBoundingClientRect().width), 48);
    assert.equal(await dialog.getByRole('img').count(), 3);
    await dialog.getByRole('button', { name: language === 'en' ? /^Stack / : /^Стек / }).click();
    await dialog.getByRole('spinbutton', { name: language === 'en' ? 'Maximum images' : 'Макс. изображений' }).fill('2');
    assert.equal(await dialog.getByRole('img').count(), 2);
    await dialog.getByRole('spinbutton', { name: language === 'en' ? 'Offset (px)' : 'Смещение (px)' }).fill('20');
    const contrast = await dialog.evaluate(element => {
      const rgb = value => value.match(/[\d.]+/g)?.slice(0, 3).map(Number);
      const luminance = color => color.map(c => { c /= 255; return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; }).reduce((sum, c, i) => sum + c * [.2126, .7152, .0722][i], 0);
      let minimum = Infinity;
      for (const node of element.querySelectorAll('span, legend, p, label, button > div')) {
        if (!node.textContent.trim() || !node.getClientRects().length || node.closest('[aria-hidden="true"]')) continue;
        const css = getComputedStyle(node);
        let ancestor = node;
        while (ancestor && getComputedStyle(ancestor).backgroundColor === 'rgba(0, 0, 0, 0)') ancestor = ancestor.parentElement;
        if (!ancestor) continue;
        const fg = rgb(css.color), bg = rgb(getComputedStyle(ancestor).backgroundColor);
        if (!fg || !bg) continue;
        const [a, b] = [luminance(fg), luminance(bg)].sort((x, y) => y - x);
        minimum = Math.min(minimum, (a + .05) / (b + .05));
      }
      return minimum;
    });
    assert.ok(contrast >= 4.5, `Text contrast ${contrast}`);
    const a11y = await dialog.evaluate(element => [...element.querySelectorAll('input, button, [role="combobox"]')].filter(el => {
      if (!el.getClientRects().length || el.type === 'hidden') return false;
      return !el.getAttribute('aria-label') && !el.getAttribute('title') && !el.textContent.trim() && !el.labels?.length;
    }).map(el => el.outerHTML));
    assert.deepEqual(a11y, []);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: join(artifacts, `${theme}-${language}-${width}.png`), fullPage: true });
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    const saved = page.getByRole('region', { name: 'Saved cell' });
    assert.equal(await saved.getByRole('img').count(), 2);
    assert.equal(await saved.getByRole('img').first().evaluate(el => getComputedStyle(el).objectFit), 'none');
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    assert.equal(await dialog.getByRole('spinbutton', { name: language === 'en' ? 'Maximum images' : 'Макс. изображений' }).inputValue(), '2');
    await fixture.assertStable();
    results.push({ theme, language, width, contrast, status: 'PASS' });
    process.stdout.write(JSON.stringify(results.at(-1)) + '\n');
    await page.close();
  }
} finally {
  await browser?.close();
  await server.close();
  await writeFile(join(artifacts, 'results.json'), JSON.stringify(results, null, 2));
  process.stdout.write(`Artifacts: ${artifacts}\n`);
}
