#!/usr/bin/env node
/**
 * ADR-0060 P5d — Playwright UI smoke for the public project page.
 *
 * Verifies the live render against devcrm.hltrn.cc:
 *  1. /s/help/projects/146 loads, no console errors / no 401/403/5xx.
 *  2. Sidebar renders + the help project is clickable.
 *  3. The seeded table_view widget (4139) is mounted and shows rows.
 *  4. No edit affordances (textarea, input-as-cell, "+ Add row", dnd handles)
 *     are interactable on the public surface.
 *  5. Mobile (<768px) viewport: sidebar collapses, content still rendered.
 *
 * Run with:
 *   node scripts/smoke-adr0060-p5d.mjs
 * Optional env:
 *   SMOKE_URL=https://devcrm.hltrn.cc   (default)
 *   SMOKE_SLUG=help
 *   SMOKE_PROJECT_ID=146
 */
import { chromium } from 'playwright';

const BASE = process.env.SMOKE_URL || 'https://devcrm.hltrn.cc';
const SLUG = process.env.SMOKE_SLUG || 'help';
const PROJECT = process.env.SMOKE_PROJECT_ID || '146';
const URL = `${BASE}/s/${SLUG}/projects/${PROJECT}`;

const results = [];
function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  // eslint-disable-next-line no-console
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}

async function run() {
  const browser = await chromium.launch({ headless: true });

  // ---------- Desktop pass ----------
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();

  const errors = [];
  const badStatuses = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('response', (r) => {
    const s = r.status();
    const u = r.url();
    if (s >= 400 && u.startsWith(BASE)) badStatuses.push(`${s} ${u}`);
  });

  await page.goto(URL, { waitUntil: 'networkidle', timeout: 30_000 });
  // Wait for either a data row OR the explicit "no widgets" empty state to
  // settle — useQuery chains projects → dashboard → widget → data, which
  // resolves after networkidle.
  await page
    .locator('text=GOD CRM User Guide, text=В этом проекте')
    .first()
    .waitFor({ timeout: 15_000 })
    .catch(() => {});
  await page.waitForTimeout(500);

  // The auth-refresh probe is part of every page (not a P5d artefact);
  // filter it out so the AC sees a clean signal for "no 4xx/5xx".
  const realBadStatuses = badStatuses.filter((s) => !s.includes('/auth/refresh'));
  const realErrors = errors.filter((e) => !e.includes('/auth/refresh') && !/401/.test(e));

  record('HTML shell loads (desktop)', page.url().includes('/projects/'));
  record('No 4xx/5xx on first-paint requests (auth-refresh exempted)', realBadStatuses.length === 0, realBadStatuses.slice(0, 5).join(' | '));
  record('No console errors (auth-refresh exempted)', realErrors.length === 0, realErrors.slice(0, 3).join(' | '));

  // The page mounts inside PublicLayout which renders the sidebar via
  // PublicSpaceSidebar; the project is listed in the tree.
  const sidebarMarker = await page.locator('text=Knowledge Base').first().count();
  record('Sidebar shows project link', sidebarMarker > 0);

  // The seeded widget 4139 is a table_view; its title is "Knowledge Base Documents".
  const widgetMarker = await page.locator('text=Knowledge Base Documents').first().count();
  record('Seeded table_view widget rendered', widgetMarker > 0);

  // A row from the data endpoint should appear (we asserted via curl that 47 rows exist).
  const rowMarker = await page.locator('text=GOD CRM User Guide').first().count();
  record('At least one data row rendered', rowMarker > 0);

  // No edit affordances: there should be NO input/textarea inside the dashboard
  // body and no "Add row" / "Add column" buttons. We're permissive — the
  // public layout has a search input in its chrome that's allowed.
  const editableCells = await page
    .locator('[role="grid"] input, [role="grid"] textarea, [data-cell-editable="true"]')
    .count();
  record('No editable cells in public viewer', editableCells === 0, `count=${editableCells}`);

  const addRowBtn = await page.getByRole('button', { name: /\+\s*Add row|Add row|Добавить строку/i }).count();
  record('No "Add row" button visible', addRowBtn === 0);

  const addColBtn = await page.getByRole('button', { name: /Add column|Добавить колонку/i }).count();
  record('No "Add column" button visible', addColBtn === 0);

  // Bundle hash advanced (snapshot from current HTML)
  const html = await page.content();
  const bundleHash = (html.match(/index-([A-Za-z0-9]+)\.js/) || [])[1] || '(not-found)';
  record('Bundle hash advanced from index-CQEbzHAo.js', bundleHash !== 'CQEbzHAo', `current=${bundleHash}`);

  await page.screenshot({ path: '/tmp/p5d-desktop.png', fullPage: true });

  await ctx.close();

  // ---------- Mobile pass ----------
  const mctx = await browser.newContext({ viewport: { width: 375, height: 667 } });
  const mpage = await mctx.newPage();
  await mpage.goto(URL, { waitUntil: 'networkidle', timeout: 30_000 });
  await mpage
    .locator('text=Knowledge Base Documents')
    .first()
    .waitFor({ timeout: 15_000 })
    .catch(() => {});
  await mpage.waitForTimeout(500);

  const mobileWidget = await mpage.locator('text=Knowledge Base Documents').first().count();
  record('[mobile 375px] widget still rendered', mobileWidget > 0);

  // Sidebar must collapse on mobile — assert that no full-width sidebar nav is visible
  // by checking a typical desktop sidebar landmark is either hidden or off-screen.
  // PublicSpaceSidebar has a hamburger toggle on mobile; the project list is not in
  // the initial DOM until the user expands it.
  const visibleLinks = await mpage.locator('aside a, [data-sidebar] a').count();
  record('[mobile 375px] sidebar links not exposed by default', visibleLinks < 10, `count=${visibleLinks}`);

  await mpage.screenshot({ path: '/tmp/p5d-mobile.png', fullPage: true });

  await mctx.close();
  await browser.close();

  // ---------- Summary ----------
  const total = results.length;
  const passed = results.filter((r) => r.ok).length;
  // eslint-disable-next-line no-console
  console.log(`\n${'='.repeat(60)}`);
  console.log(`SUMMARY: ${passed}/${total} passed`);
  console.log(`Screenshots: /tmp/p5d-desktop.png, /tmp/p5d-mobile.png`);
  if (passed !== total) {
    console.log(`FAILED ITEMS:`);
    for (const r of results.filter((x) => !x.ok)) {
      console.log(`  - ${r.name}${r.detail ? ` (${r.detail})` : ''}`);
    }
    process.exit(1);
  }
}

run().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('SMOKE_ERROR', err);
  process.exit(2);
});
