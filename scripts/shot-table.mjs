#!/usr/bin/env node
/**
 * Authenticated screenshot of a UniversalTable page.
 * Mints a JWT for the given USER_ID using JWT_SECRET from .env,
 * injects it into localStorage('god-crm-auth'), and screenshots the
 * resulting /tables/<id> view.
 *
 *   node scripts/shot-table.mjs             # default: table 1708
 *   SHOT_TABLE=1784 node scripts/shot-table.mjs
 */
import 'dotenv/config';
import jwt from 'jsonwebtoken';
import { chromium } from 'playwright';

const BASE = process.env.SHOT_BASE || 'https://crm.hltrn.cc';
const TABLE = process.env.SHOT_TABLE || '1708';
const USER_ID = Number(process.env.SHOT_USER || 1);
const USER_EMAIL = process.env.SHOT_EMAIL || 'geramonnn@gmail.com';
const OUT = process.env.SHOT_OUT || '/tmp/table-state.png';
const VW = Number(process.env.SHOT_VW || 1600);
const VH = Number(process.env.SHOT_VH || 900);

const SECRET = process.env.JWT_SECRET;
if (!SECRET) {
  console.error('JWT_SECRET not in env');
  process.exit(1);
}

const token = jwt.sign(
  { id: USER_ID, userId: USER_ID, email: USER_EMAIL, role: 'admin' },
  SECRET,
  { expiresIn: '10m' }
);

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: VW, height: VH } });
const page = await ctx.newPage();

page.on('console', (m) => {
  if (m.type() === 'error') console.error('[console]', m.text().slice(0, 200));
});

// Prime localStorage on the target origin BEFORE every navigation so the
// app boots already authenticated. addInitScript runs in every new page
// before any user script, including on the first goto.
const persisted = JSON.stringify({
  state: { token, user: { id: USER_ID, email: USER_EMAIL, role: 'admin' } },
  version: 0,
});
await ctx.addInitScript(`window.localStorage.setItem('god-crm-auth', ${JSON.stringify(persisted)});`);

await page.goto(`${BASE}/tables/${TABLE}`, { waitUntil: 'networkidle', timeout: 30_000 });
await page
  .locator('table, [role="grid"]')
  .first()
  .waitFor({ timeout: 15_000 })
  .catch(() => {});
await page.waitForTimeout(1500);

await page.screenshot({ path: OUT, fullPage: false });

const info = await page.evaluate(() => {
  const tables = [...document.querySelectorAll('table')];
  return tables.map((t, i) => {
    const tr = t.getBoundingClientRect();
    const ths = [...t.querySelectorAll('thead th')].map((th) => ({
      text: (th.innerText || '').trim().slice(0, 28),
      w: Math.round(th.getBoundingClientRect().width),
    }));
    let p = t.parentElement;
    while (p && getComputedStyle(p).overflowX === 'visible') p = p.parentElement;
    return {
      idx: i,
      tableW: Math.round(tr.width),
      containerW: p ? Math.round(p.getBoundingClientRect().width) : null,
      ths,
    };
  });
});
console.log(JSON.stringify(info, null, 2));
console.log('url=', page.url());
console.log('screenshot=', OUT);

await browser.close();
