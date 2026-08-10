// Radar-push smoke runner. Runs the REAL executeRadarPush (real DB read of the Tweet
// Radar Candidates table, real card render, real filtering/dedup/limit) with the
// Telegram send stubbed out AND dry_run on — so nothing reaches the topic and NO rows
// are marked sent. Prints the exact cards that WOULD be pushed.
//
//   node --import ./scripts/smoke/register-stub.mjs scripts/smoke/run-radar-push.mjs
//
// Env overrides: SMOKE_SCORE_THRESHOLD, SMOKE_LIMIT.
import 'dotenv/config';
import { executeRadarPush } from '../../backend/services/schedule-trigger/action-executors.js';

const config = {
  dry_run: true, // never mark rows sent during a smoke
  score_threshold: process.env.SMOKE_SCORE_THRESHOLD != null ? Number(process.env.SMOKE_SCORE_THRESHOLD) : undefined,
  limit: process.env.SMOKE_LIMIT != null ? Number(process.env.SMOKE_LIMIT) : undefined,
};

console.log('── radar_push smoke — selecting + rendering (no send, no row-mark) ──');
const t0 = Date.now();
const result = await executeRadarPush(config, {});
const secs = ((Date.now() - t0) / 1000).toFixed(1);

const captured = globalThis.__SMOKE_TG__ || [];
console.log(`\n── RESULT (${secs}s) ──`);
console.log(JSON.stringify({ ...result, previews: undefined, results: undefined }, null, 2));

if (result.skipped) {
  console.log(`\n⚠️  Nothing eligible. Try SMOKE_SCORE_THRESHOLD=0 to see all rows render.`);
}

for (const c of captured) {
  console.log(`\n══════════ ${c.via} → ${c.chatId} (thread=${c.message_thread_id ?? '-'} parse_mode=${c.parse_mode}) ══════════`);
  console.log(c.text);
}
console.log(`\n── eligible=${result.eligible ?? 0}, selected=${result.selected ?? 0}, captured ${captured.length} card(s) ──`);
process.exit(0);
