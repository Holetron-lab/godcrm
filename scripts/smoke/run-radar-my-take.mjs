// Radar my_take generator smoke. Runs the REAL executeRadarMyTake (real DB read of the
// Tweet Radar Candidates table, real structure rotation A→F, real Claude CLI generation)
// with dry_run ON — so NO rows are written. Prints the rotated take it WOULD save per
// candidate, so the voice + skeleton variety can be gut-checked before anything lands.
//
//   node --import ./scripts/smoke/register-stub.mjs scripts/smoke/run-radar-my-take.mjs
//
// By default only rows that LACK a my_take are drafted (hand-approved takes are left
// alone). To preview the rotation on the existing approved rows without touching them,
// set SMOKE_FORCE=1 (still dry_run — nothing is written).
//
// Env overrides: SMOKE_STATUS, SMOKE_LIMIT, SMOKE_FORCE.
import 'dotenv/config';
import { executeRadarMyTake } from '../../backend/services/schedule-trigger/action-executors.js';

const config = {
  dry_run: true, // never write rows during a smoke
  force: process.env.SMOKE_FORCE === '1',
  status: process.env.SMOKE_STATUS || undefined,
  limit: process.env.SMOKE_LIMIT != null ? Number(process.env.SMOKE_LIMIT) : undefined,
};

console.log('── radar_my_take smoke — generating + rotating (no row write) ──');
console.log(`   force=${config.force} (force=1 previews rotation on existing takes)`);
const t0 = Date.now();
const result = await executeRadarMyTake(config, {});
const secs = ((Date.now() - t0) / 1000).toFixed(1);

console.log(`\n── RESULT (${secs}s) ──`);
console.log(JSON.stringify({ ...result, previews: undefined }, null, 2));

if (result.skipped) {
  console.log(`\n⚠️  Nothing to draft. All matching rows already have a take — set SMOKE_FORCE=1 to preview the rotation on them.`);
}

for (const p of result.previews || []) {
  console.log(`\n══════════ [${p.structure} · ${p.structure_name || '?'}] @${(p.handle || '').replace(/^@/, '')} · ⭐${p.score ?? '?'} (row ${p.rowId}) ══════════`);
  if (p.error) { console.log(`  ✗ ${p.error}`); continue; }
  console.log(p.my_take);
  if (p.tweet_text_ru || p.my_take_ru) {
    console.log(`  🇷🇺 твит:  ${p.tweet_text_ru || '(—)'}`);
    console.log(`  🇷🇺 ответ: ${p.my_take_ru || '(—)'}`);
  }
}

const rotation = (result.previews || []).filter(p => /^[A-F]$/.test(p.structure || '')).map(p => p.structure).join('→');
console.log(`\n── candidates=${result.candidates ?? 0}, drafted=${result.drafted ?? 0}, translated=${result.translated ?? 0}, rotation ${rotation || '(none)'} ──`);
process.exit(0);
