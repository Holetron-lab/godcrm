// Dev-report smoke runner. Runs the REAL executeDevReport (real git log, real ADR
// timings from the guarded status column, real claude CLI generation) with the
// Telegram send stubbed out — then prints the exact two posts that WOULD be sent.
// Read-only against the DB; writes nothing; posts nothing to public channels.
import 'dotenv/config';
import { executeDevReport } from '../../backend/services/schedule-trigger/action-executors.js';

const config = {
  period_hours: Number(process.env.SMOKE_PERIOD_HOURS || 24),
  repo_path: process.cwd(),
  channel_en: '@god_crm',
};

console.log('── dev_report smoke — generating (no send) ──');
const t0 = Date.now();
const result = await executeDevReport(config, {});
const secs = ((Date.now() - t0) / 1000).toFixed(1);

const captured = globalThis.__SMOKE_TG__ || [];
console.log(`\n── RESULT (${secs}s) ──`);
console.log(JSON.stringify(result, null, 2));

if (result.skipped) {
  console.log(`\n⚠️  Skipped: ${result.reason}. Try SMOKE_PERIOD_HOURS=72 to widen the commit window.`);
}

for (const p of captured) {
  console.log(`\n══════════ ${p.via} → ${p.chatId} (parse_mode=${p.parse_mode}) ══════════`);
  console.log(p.text);
}
console.log(`\n── captured ${captured.length} post(s); split marker check: ${captured.length >= 2 ? 'OK (RU+EN)' : 'INCOMPLETE'} ──`);
process.exit(0);
