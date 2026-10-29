import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { expect } from '@playwright/test';
import { createFixtureServer, openFixture } from './browser-fixture.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const artifacts = await mkdtemp(join(tmpdir(), 'chat-video-'));
const clip = join(artifacts, 'clip.mp4');
execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=320x180:d=5', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', clip]);
const videoBytes = await readFile(clip);
const entry = 'src/tests/chat-video-fixture/index.html';
const server = await createFixtureServer({ root, artifacts, entry });
let browser;
try {
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  for (const width of [1440, 390]) for (const theme of ['light', 'dark']) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const trigger = page.getByRole('button', { name: 'Загрузить видео: clip.mp4' });
    const fixture = await openFixture({ server, page, entry: `${entry}?theme=${theme}`, ready: trigger });
    let fetches = 0;
    await page.route('**/uploads/fixture-clip?download=1', route => {
      assert.equal(route.request().headers().authorization, 'Bearer fixture-video-token');
      fetches++;
      return route.fulfill({ contentType: 'video/mp4', body: videoBytes });
    });
    assert.equal(fetches, 0);
    await trigger.focus(); await page.keyboard.press('Enter');
    const video = page.locator('video');
    await expect(video).toHaveAttribute('src', /^blob:/);
    await expect.poll(() => video.evaluate(el => el.readyState)).toBeGreaterThanOrEqual(2);
    assert.equal(fetches, 1);
    await video.focus(); await page.keyboard.press('Space');
    await expect.poll(() => video.evaluate(el => el.currentTime)).toBeGreaterThan(0);
    await page.keyboard.press('Space');
    await expect.poll(() => video.evaluate(el => el.paused)).toBe(true);
    const bounds = await video.boundingBox(); assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width);
    await expect(video).toHaveAttribute('playsinline', '');
    await expect(page.getByRole('link', { name: 'clip.mp4' })).toHaveAttribute('download', 'clip.mp4');
    const chooserPromise = page.waitForEvent('filechooser');
    await page.getByTitle('Прикрепить файл', { exact: true }).click();
    const chooser = await chooserPromise;
    assert.equal(await chooser.element().getAttribute('accept'), null);
    const files = [
      { name: 'clip.mp4', mimeType: 'video/mp4', buffer: videoBytes },
      { name: 'archive.zip', mimeType: 'application/zip', buffer: Buffer.from('zip') },
      { name: 'script.py', mimeType: 'text/x-python', buffer: Buffer.from('print(1)') },
      { name: 'unknown.custom', mimeType: '', buffer: Buffer.from('custom') },
    ];
    await chooser.setFiles(files);
    await page.getByTitle('Отправить', { exact: true }).click();
    await expect(page.getByLabel('Отправленные файлы')).toHaveText(files.map(file => file.name).join(', '));
    await page.addScriptTag({ content: await readFile(join(root, 'node_modules/axe-core/axe.min.js'), 'utf8') });
    const violations = await page.evaluate(async () => (await window.axe.run('[aria-label="Видео"]', {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] },
    })).violations);
    await writeFile(join(artifacts, `${width}-${theme}-axe.json`), JSON.stringify(violations, null, 2));
    assert.deepEqual(violations.map(({ id }) => id), []);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: join(artifacts, `${width}-${theme}.png`) });
    await fixture.assertStable(); await page.close();
    process.stdout.write(`${width} ${theme}: authenticated video, keyboard playback, file picker, bounds, axe PASS\n`);
  }
} finally { await browser?.close(); await server.close(); process.stdout.write(`Artifacts: ${artifacts}\n`); }
