// Immutable image entrypoint. No URL, JS, selector, environment or mount inputs.
import fs from 'node:fs';
import net from 'node:net';
import { performance } from 'node:perf_hooks';
import { chromium } from 'playwright';
import axe from 'axe-core';
import { contrast } from './visual.mjs';
import { metricsValue } from './metrics.mjs';
const registry = JSON.parse(fs.readFileSync(new URL('./registry.json', import.meta.url)));
const [suite, deadlineText] = process.argv.slice(2);
const deadline = Number(deadlineText);
const names = { 'computed-contrast-v1': 'contrast', 'axe-v1': 'axe', 'trace-metrics-v1': 'metrics', 'clipboard-v1': 'clipboard' };
if (!names[suite] || !Number.isInteger(deadline) || deadline <= Date.now() || deadline > Date.now() + 300000 || process.getuid() === 0) process.exit(2);
const timer = setTimeout(() => process.exit(3), deadline - Date.now());
const started = performance.now();
const trace = [], checks = [];
const sockets = new Set();
const bridge = net.createServer(peer => {
  const remote = net.createConnection('/egress.sock');
  sockets.add(peer); sockets.add(remote);
  peer.pipe(remote).pipe(peer);
  for (const socket of [peer, remote]) socket.on('error', () => { peer.destroy(); remote.destroy(); });
  peer.on('close', () => { remote.destroy(); sockets.delete(peer); sockets.delete(remote); });
});
await new Promise((resolve, reject) => { bridge.once('error', reject); bridge.listen(18080, '127.0.0.1', resolve); });
let browser;
try {
  browser = await chromium.launch({ channel: 'chromium', headless: true, chromiumSandbox: true,
    proxy: { server: 'http://127.0.0.1:18080', bypass: '<-loopback>' },
    args: ['--disable-quic','--ssl-version-max=tls1.2', '--disable-features=EncryptedClientHello'], timeout: Math.min(20000, deadline - Date.now()) });
  const session = JSON.parse(fs.readFileSync('/session.json', 'utf8'));
  // Owner-issued staging-only QA session; never accept production credentials.
  if (session.origin !== registry.origin || session.expires_at <= Date.now() || session.database !== 'godcrm_test' || !session.storageState) throw Error('session');
  const operation = async (name, fn) => {
    const start = performance.now();
    await fn();
    trace.push({ action: name, start_ms: start - started, duration_ms: performance.now() - start });
  };
  for (const locale of ['en', 'ru']) for (const theme of ['light', 'dark']) for (const width of [1440, 390]) {
    const context = await browser.newContext({ storageState: session.storageState, locale, colorScheme: theme,
      viewport: { width, height: 900 }, ignoreHTTPSErrors: false, serviceWorkers: 'block', acceptDownloads: false });
    context.setDefaultTimeout(Math.min(10000, Math.max(1, deadline - Date.now())));
    await context.addInitScript(({ language, color }) => {
      localStorage.setItem('god-crm-language', language); localStorage.setItem('god-crm-theme', color);
    }, { language: locale, color: theme });
    await context.addInitScript(() => {
      window.__browserMetrics = { lcp: [], inp: [], cls: [], clsObserved: false };
      for (const type of ['largest-contentful-paint', 'event', 'layout-shift']) {
        if (!PerformanceObserver.supportedEntryTypes.includes(type)) continue;
        const observer = new PerformanceObserver(list => {
          for (const entry of list.getEntries()) {
            if (type === 'largest-contentful-paint') window.__browserMetrics.lcp.push(entry.startTime);
            if (type === 'event' && entry.interactionId) window.__browserMetrics.inp.push({ id: entry.interactionId, duration: entry.duration });
            if (type === 'layout-shift' && !entry.hadRecentInput) window.__browserMetrics.cls.push({ time: entry.startTime, value: entry.value });
          }
        });
        observer.observe({ type, buffered: true, ...(type === 'event' ? { durationThreshold: 16 } : {}) });
        if (type === 'layout-shift') window.__browserMetrics.clsObserved = true;
      }
    });
    if (suite === 'trace-metrics-v1') await context.tracing.start({ screenshots: false, snapshots: false, sources: false });
    const page = await context.newPage();
    const selector = key => page.locator(registry.selectors[key]).first();
    if (suite === 'clipboard-v1') {
      await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: registry.origin });
      await page.goto(registry.origin, { waitUntil: 'domcontentloaded' });
      let ok = false;
      await operation('clipboard_roundtrip', async () => {
        ok = await page.evaluate(async () => {
          const value = 'qa-' + crypto.randomUUID();
          await navigator.clipboard.writeText(value);
          const equal = await navigator.clipboard.readText() === value;
          await navigator.clipboard.writeText('');
          return equal;
        });
      });
      checks.push({ target: 'clipboard', rule: 'clipboard', passed: ok });
    } else {
      for (const target of ['table', 'schema_drawer', 'access']) {
        await operation('navigate', () => page.goto(registry.origin + registry[target === 'schema_drawer' ? 'schema' : target], { waitUntil: 'domcontentloaded' }));
        let scope;
        if (target === 'access') {
          await selector('space_menu').click();
          await selector('space_settings').click();
          await selector('access_tab').click();
          await operation('expand_access', () => selector('access_expand').click());
          scope = selector('drawer');
        } else {
          await operation('open_drawer', async () => {
            if (target === 'schema_drawer') {
              await selector('schema_column').click();
            } else {
              await selector('column_menu').click();
            }
            await selector('drawer').waitFor({ state: 'visible' });
          });
          await operation('switch_tab', () => selector('type_tab').click());
          scope = selector('drawer');
        }
        if (suite === 'computed-contrast-v1') {
          const styles = await scope.locator('button, input, label, p, span').evaluateAll(elements => elements.filter(e => e.getClientRects().length && e.textContent.trim()).map(e => {
            const style = getComputedStyle(e); const backgrounds = [];
            for (let p = e; p; p = p.parentElement) { const s = getComputedStyle(p); backgrounds.push({ color: s.backgroundColor, opacity: s.opacity, image: s.backgroundImage }); }
            return { color: style.color, backgrounds };
          }));
          const ratios = styles.map(contrast);
          const valid = ratios.length > 0 && ratios.every(Number.isFinite);
          checks.push({ target, rule: 'contrast', passed: valid && ratios.every(x => x >= 4.5), ...(valid ? { value: Math.min(...ratios) } : {}) });
        }
        if (suite === 'axe-v1') {
          await page.addScriptTag({ content: axe.source });
          const result = await scope.evaluate(async element => {
            const data = await window.axe.run(element);
            return { violations: data.violations.length, incomplete: data.incomplete.length, passes: data.passes.length };
          });
          checks.push({ target, rule: 'axe', passed: result.violations === 0 && result.incomplete === 0 && result.passes > 0, count: result.violations + result.incomplete });
        }
        if (suite === 'trace-metrics-v1') {
          const cdp = await context.newCDPSession(page);
          await cdp.send('Performance.enable');
          await operation('scroll', async () => { await page.mouse.wheel(0, 800); await page.keyboard.press('Tab'); await page.keyboard.press('Tab'); });
          await page.waitForTimeout(250);
          const metrics = await page.evaluate(() => window.__browserMetrics);
          const cdpMetrics = await cdp.send('Performance.getMetrics');
          const present = cdpMetrics.metrics.some(item => item.name === 'TaskDuration');
          for (const [rule, value] of Object.entries(metricsValue(metrics))) {
            const valid = present && Number.isFinite(value);
            checks.push({ target, rule, passed: valid && value <= registry.budgets[rule], ...(valid ? { value } : {}) });
          }
          await cdp.detach();
        }
      }
    }
    if (suite === 'trace-metrics-v1') await context.tracing.stop(); // Discard private raw trace, never export.
    await context.close();
  }
  process.stdout.write(JSON.stringify({ kind: names[suite], checks, trace }));
} catch {
  process.exitCode = 1; // No raw errors/trace/DOM/session output.
} finally {
  await browser?.close();
  for (const socket of sockets) socket.destroy();
  bridge.close();
  clearTimeout(timer);
}
