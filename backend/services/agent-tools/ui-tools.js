/**
 * UI Probe Tool Handler — `ui_probe`
 *
 * The missing runtime tool behind the "frontend QA agent" gap: until now the
 * only browser-ish names an agent could call (`browser_devtools`, `screenshot`,
 * `lighthouse_audit`, `accessibility_check`, `visual_diff`) existed as rows in
 * the tools catalogue (1790) with NO handler anywhere in the backend, so every
 * call resolved to "Unknown tool". This is one real tool that actually drives a
 * browser: it runs a scripted user scenario with Playwright (already a repo
 * dependency, chromium headless shell already installed) and returns what a
 * human QA would report — did the steps pass, what did the console say, which
 * requests failed, what does the page look like.
 *
 * Scope guard: a scenario runner can click "Delete" as easily as "Save", so the
 * host must be on an allowlist. Default = staging/dev + localhost only
 * (dev.godcrm.ai, devcrm.hltrn.cc, hltrn.cc, 127.0.0.1). Ring 0 and Ring 1 are
 * NOT reachable by default; widen deliberately with UI_PROBE_ALLOWED_HOSTS.
 *
 * Deliberately NOT here: Lighthouse (needs full chrome + a separate npm dep)
 * and visual diffing (needs a baseline store). Both are follow-ups; this tool
 * covers the scenario/console/a11y/screenshot surface that blocks QA today.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { aiLogger } from '../../utils/logger.js';
import { dbRun, sqlNow } from '../../database/connection.js';

const UPLOAD_BASE = process.env.UPLOAD_PATH || '/var/lib/business-crm-data/uploads';
const BASE_URL = process.env.BASE_URL || process.env.APP_URL || 'https://app.godcrm.ai';

const DEFAULT_ALLOWED_HOSTS = [
  'dev.godcrm.ai',
  'devcrm.hltrn.cc',
  'hltrn.cc',
  'www.hltrn.cc',
  'localhost',
  '127.0.0.1',
];

const DEFAULT_TIMEOUT_MS = 30000;
const MAX_TIMEOUT_MS = 120000;
const MAX_STEPS = 40;
const MAX_CONSOLE_ENTRIES = 50;
const MAX_FAILED_REQUESTS = 30;

function allowedHosts() {
  const raw = process.env.UI_PROBE_ALLOWED_HOSTS;
  if (!raw) return DEFAULT_ALLOWED_HOSTS;
  return raw.split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);
}

/**
 * Exact-hostname allowlist. Substring matching would let `crm.hltrn.cc`
 * (Ring 1, real users) through a `hltrn.cc` entry — hence exact only.
 */
function checkUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { ok: false, error: `invalid url: ${rawUrl}` };
  }
  if (!/^https?:$/.test(parsed.protocol)) {
    return { ok: false, error: `unsupported protocol: ${parsed.protocol}` };
  }
  const hosts = allowedHosts();
  if (!hosts.includes(parsed.hostname.toLowerCase())) {
    return {
      ok: false,
      error: `host "${parsed.hostname}" is not in the ui_probe allowlist (${hosts.join(', ')}). `
        + 'Test on dev.godcrm.ai; widen with UI_PROBE_ALLOWED_HOSTS only for a host you may click around in.',
    };
  }
  return { ok: true, url: parsed };
}

/**
 * Persist a screenshot the same way agent-generated images are persisted
 * (uploads/spaces/<space>/ + a public `files` row) so the ADR-0016 upload
 * guard serves it and the owner can just open the URL from chat.
 */
async function saveScreenshot(buffer, spaceId) {
  const fileId = `file_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
  const fileName = `${fileId}.png`;
  const spaceDir = path.join(UPLOAD_BASE, 'spaces', String(spaceId || 'ui-probe'));
  if (!fs.existsSync(spaceDir)) fs.mkdirSync(spaceDir, { recursive: true });
  const filePath = path.join(spaceDir, fileName);
  fs.writeFileSync(filePath, buffer);
  const relativeUrl = `/uploads/spaces/${spaceId || 'ui-probe'}/${fileName}`;
  try {
    await dbRun(
      `INSERT INTO files (id, name, original_name, mime_type, size, path, url, storage_provider_id, space_id, uploaded_by, visibility, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'local', ?, ?, 'public', ${sqlNow()}, ${sqlNow()})`,
      [fileId, fileName, fileName, 'image/png', buffer.length, filePath, relativeUrl,
        (spaceId && Number.isInteger(Number(spaceId))) ? Number(spaceId) : null, null]
    );
  } catch (err) {
    // The bytes are on disk either way; a missing row only costs the URL.
    aiLogger.warn({ err: err.message }, 'ui_probe: screenshot file row insert failed');
  }
  return { file_id: fileId, url: relativeUrl, full_url: `${BASE_URL}${relativeUrl}`, size: buffer.length };
}

/**
 * Static DOM accessibility pass. Intentionally axe-core-free: axe is not a
 * dependency here and pulling it in is a separate decision. These are the
 * checks that catch the bulk of real regressions in this codebase's UI —
 * unlabelled controls, images without alt, broken heading order.
 */
const A11Y_SCRIPT = `() => {
  const issues = [];
  const push = (rule, el, detail) => {
    if (issues.length >= 60) return;
    const sel = el ? (el.tagName.toLowerCase()
      + (el.id ? '#' + el.id : '')
      + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\\s+/).slice(0, 2).join('.') : '')) : null;
    issues.push({ rule, element: sel, detail: detail || null });
  };
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
  };
  const name = (el) => (
    el.getAttribute('aria-label')
    || (el.getAttribute('aria-labelledby') && document.getElementById(el.getAttribute('aria-labelledby'))?.textContent)
    || el.textContent
    || el.getAttribute('title')
    || el.getAttribute('alt')
    || ''
  ).trim();

  if (!document.documentElement.getAttribute('lang')) push('html-has-lang', document.documentElement, 'missing lang attribute');

  document.querySelectorAll('img').forEach((el) => {
    if (!visible(el)) return;
    if (el.getAttribute('alt') === null && el.getAttribute('role') !== 'presentation') push('image-alt', el, 'img without alt');
  });

  document.querySelectorAll('button, a[href], [role="button"]').forEach((el) => {
    if (!visible(el)) return;
    if (!name(el) && !el.querySelector('img[alt]:not([alt=""])')) push('control-has-name', el, 'interactive control has no accessible name');
  });

  document.querySelectorAll('input:not([type="hidden"]), select, textarea').forEach((el) => {
    if (!visible(el)) return;
    const labelled = el.labels?.length > 0 || el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || el.getAttribute('title');
    if (!labelled) push('form-field-label', el, el.getAttribute('placeholder') ? 'only a placeholder, no label' : 'no label');
  });

  const ids = {};
  document.querySelectorAll('[id]').forEach((el) => { ids[el.id] = (ids[el.id] || 0) + 1; });
  Object.entries(ids).filter(([, n]) => n > 1).slice(0, 10).forEach(([id, n]) => push('duplicate-id', null, id + ' x' + n));

  let prev = 0;
  document.querySelectorAll('h1,h2,h3,h4,h5,h6').forEach((el) => {
    const lvl = Number(el.tagName[1]);
    if (prev && lvl > prev + 1) push('heading-order', el, 'jumps from h' + prev + ' to h' + lvl);
    prev = lvl;
  });

  return issues;
}`;

async function runStep(page, step, index, report, spaceId) {
  const started = Date.now();
  const action = String(step.action || '').toLowerCase();
  const entry = { index, action, target: step.selector || step.url || step.text || null, ok: false };
  try {
    switch (action) {
      case 'goto': {
        const check = checkUrl(step.url);
        if (!check.ok) throw new Error(check.error);
        const resp = await page.goto(step.url, { waitUntil: step.wait_until || 'domcontentloaded' });
        entry.http_status = resp ? resp.status() : null;
        break;
      }
      case 'click':
        await page.click(step.selector, { timeout: step.timeout_ms || 10000 });
        break;
      case 'fill':
        await page.fill(step.selector, String(step.value ?? ''), { timeout: step.timeout_ms || 10000 });
        break;
      case 'press':
        await page.press(step.selector || 'body', step.key || 'Enter', { timeout: step.timeout_ms || 10000 });
        break;
      case 'select':
        await page.selectOption(step.selector, String(step.value ?? ''), { timeout: step.timeout_ms || 10000 });
        break;
      case 'wait_for':
        await page.waitForSelector(step.selector, { timeout: step.timeout_ms || 10000, state: step.state || 'visible' });
        break;
      case 'wait_ms':
        await page.waitForTimeout(Math.min(Number(step.ms) || 500, 15000));
        break;
      case 'scroll':
        await page.evaluate((y) => globalThis.window.scrollBy(0, y), Number(step.y) || 800);
        break;
      case 'expect_text': {
        const body = await page.textContent('body');
        if (!body || !body.includes(String(step.text))) throw new Error(`text not found on page: ${JSON.stringify(step.text)}`);
        break;
      }
      case 'expect_visible':
        await page.waitForSelector(step.selector, { timeout: step.timeout_ms || 10000, state: 'visible' });
        break;
      case 'expect_url': {
        const current = page.url();
        if (!current.includes(String(step.text || step.url))) throw new Error(`url is ${current}, expected to contain ${step.text || step.url}`);
        break;
      }
      case 'screenshot': {
        const buf = await page.screenshot({ fullPage: !!step.full_page });
        const saved = await saveScreenshot(buf, spaceId);
        report.screenshots.push({ step: index, label: step.label || null, ...saved });
        break;
      }
      default:
        throw new Error(`unknown action "${action}" (supported: goto, click, fill, press, select, wait_for, wait_ms, scroll, expect_text, expect_visible, expect_url, screenshot)`);
    }
    entry.ok = true;
  } catch (err) {
    entry.error = String(err.message || err).split('\n')[0].slice(0, 300);
  }
  entry.ms = Date.now() - started;
  return entry;
}

/**
 * ui_probe — drive a real browser through a scenario and report what broke.
 */
async function uiProbe(args, userId, context) {
  const spaceId = context?.spaceId ?? context?.space_id ?? args.space_id ?? null;
  const check = checkUrl(args.url);
  if (!check.ok) return { error: 'url_not_allowed', message: check.error };

  const steps = Array.isArray(args.steps) ? args.steps.slice(0, MAX_STEPS) : [];
  const timeout = Math.min(Number(args.timeout_ms) || DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS);

  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch (err) {
    return { error: 'playwright_unavailable', message: `playwright import failed: ${err.message}` };
  }

  const report = {
    url: args.url,
    steps: [],
    console_errors: [],
    console_warnings: [],
    page_errors: [],
    failed_requests: [],
    screenshots: [],
  };

  const startedAt = Date.now();
  let browser = null;
  try {
    browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    const viewport = args.viewport === 'mobile'
      ? { width: 390, height: 844 }
      : (args.viewport && typeof args.viewport === 'object'
        ? { width: Number(args.viewport.width) || 1440, height: Number(args.viewport.height) || 900 }
        : { width: 1440, height: 900 });

    const ctx = await browser.newContext({
      viewport,
      isMobile: args.viewport === 'mobile',
      ignoreHTTPSErrors: true,
      // Match authStore's persisted contract; initialize() validates the token
      // through /auth/me. Seed once, only for this origin, so logout/reload and
      // navigation to another host cannot restore or leak the supplied token.
      ...(args.auth_token ? { storageState: {
        cookies: [],
        origins: [{
          origin: check.url.origin,
          localStorage: [{
            name: 'god-crm-auth',
            value: JSON.stringify({ state: { token: String(args.auth_token), user: null }, version: 0 }),
          }],
        }],
      } } : {}),
    });
    ctx.setDefaultTimeout(timeout);

    // Auth: the caller supplies a token it already has (chat session, minted
    // for a test user). The tool never mints or reads credentials itself.
    if (args.auth_token) {
      const origin = check.url.origin;
      await ctx.addCookies([{ name: 'access_token', value: String(args.auth_token), url: origin }]);
    }

    const page = await ctx.newPage();
    page.on('console', (msg) => {
      const type = msg.type();
      const bucket = type === 'error' ? report.console_errors : (type === 'warning' ? report.console_warnings : null);
      if (bucket && bucket.length < MAX_CONSOLE_ENTRIES) bucket.push(msg.text().slice(0, 400));
    });
    page.on('pageerror', (err) => {
      if (report.page_errors.length < MAX_CONSOLE_ENTRIES) report.page_errors.push(String(err.message || err).slice(0, 400));
    });
    page.on('requestfailed', (req) => {
      if (report.failed_requests.length < MAX_FAILED_REQUESTS) {
        report.failed_requests.push({ url: req.url().slice(0, 300), method: req.method(), reason: req.failure()?.errorText || null });
      }
    });
    page.on('response', (res) => {
      if (res.status() >= 400 && report.failed_requests.length < MAX_FAILED_REQUESTS) {
        report.failed_requests.push({ url: res.url().slice(0, 300), method: res.request().method(), status: res.status() });
      }
    });

    const resp = await page.goto(args.url, { waitUntil: args.wait_until || 'domcontentloaded', timeout });
    report.http_status = resp ? resp.status() : null;

    for (let i = 0; i < steps.length; i++) {
      const entry = await runStep(page, steps[i], i, report, spaceId);
      report.steps.push(entry);
      if (!entry.ok && args.stop_on_failure !== false) break;
    }

    report.final_url = page.url();
    report.title = await page.title().catch(() => null);

    if (args.a11y) {
      try {
        // Evaluated as an IIFE: page.evaluate() given a plain string treats it
        // as an *expression*, so bare `() => {...}` would return an
        // unserializable function instead of running the audit.
        report.a11y = { issues: await page.evaluate(`(${A11Y_SCRIPT})()`) };
        report.a11y.count = report.a11y.issues.length;
      } catch (err) {
        report.a11y = { error: String(err.message || err).slice(0, 200) };
      }
    }

    // A trailing screenshot unless the scenario already took its own.
    if (args.screenshot !== false && !report.screenshots.length) {
      const buf = await page.screenshot({ fullPage: args.screenshot === 'full' });
      report.screenshots.push({ step: 'final', ...(await saveScreenshot(buf, spaceId)) });
    }
  } catch (err) {
    report.error = String(err.message || err).split('\n')[0].slice(0, 400);
  } finally {
    if (browser) await browser.close().catch(() => {});
  }

  report.duration_ms = Date.now() - startedAt;
  const stepsFailed = report.steps.filter((s) => !s.ok).length;
  report.ok = !report.error
    && stepsFailed === 0
    && (report.http_status === null || report.http_status < 400)
    && report.page_errors.length === 0;
  report.summary = report.error
    ? `run failed: ${report.error}`
    : `${report.steps.length - stepsFailed}/${report.steps.length} steps ok · http ${report.http_status} · `
      + `${report.page_errors.length} page errors · ${report.console_errors.length} console errors · `
      + `${report.failed_requests.length} failed requests`
      + (report.a11y?.count != null ? ` · ${report.a11y.count} a11y issues` : '');

  aiLogger.info({
    url: args.url, ok: report.ok, steps: report.steps.length, stepsFailed,
    consoleErrors: report.console_errors.length, durationMs: report.duration_ms,
  }, 'ui_probe run complete');

  return report;
}

export const uiToolHandlers = {
  ui_probe: uiProbe,
};

export default { uiToolHandlers };
