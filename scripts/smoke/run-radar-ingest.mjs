// Read-only smoke for radar_ingest (ADR-152 step [1]).
// Runs the REAL executeRadarIngest against the live TwitterAPI.io API with dry_run=true:
// it fetches + maps + dedups but writes ZERO rows. Proves the truncation fix (full `text`),
// the dedup against the existing table, and the candidate mapping — without touching the DB.
//
//   SMOKE_QUERY='"AI agents" min_faves:20' node scripts/smoke/run-radar-ingest.mjs
//
// The vault must be initialised so getSecret('twitterapi_io_key') resolves (same path the
// server takes at boot). Nothing is written because dry_run is forced on.
import dotenv from 'dotenv';
dotenv.config();
import vault from '../../backend/services/secrets/SecretsVault.js';
import { getAdapter } from '../../backend/database/connection.js';
import { executeRadarIngest } from '../../backend/services/schedule-trigger/action-executors.js';

const QUERY = process.env.SMOKE_QUERY || '"context window" OR "AI agents" min_faves:30';

async function main() {
  const adapter = await getAdapter();
  await vault.init({ adapter, allowEnvFallback: false });

  const res = await executeRadarIngest({
    queries: [{ query: QUERY, source_type: 'theme', source_ref: 'smoke' }],
    lookback_hours: 168,   // wide window so the smoke reliably finds something
    per_query_limit: 10,
    dry_run: true,         // <<< nothing is written
  });

  console.log('\n=== radar_ingest dry-run result ===');
  console.log('success:', res.success, '| dryRun:', res.dryRun, '| fetched:', res.fetched, '| candidates:', res.candidates, '| written:', res.written);
  console.log('per-query:', JSON.stringify(res.queries));
  console.log('\n=== candidate previews (new, deduped) ===');
  for (const p of (res.previews || [])) {
    console.log(`  ${p.handle}  tweet_id=${p.tweet_id}  text_len=${p.text_len}  src=${p.source_ref}`);
  }
  if (res.written !== 0) {
    console.error('\n❌ SMOKE BUG: dry-run wrote rows — written should be 0');
    process.exit(1);
  }
  console.log('\n✅ dry-run wrote 0 rows. Full tweet body preserved (text_len reflects the WHOLE post, not a 280 cap).');
  process.exit(0);
}
main().catch(e => { console.error('SMOKE ERROR', e); process.exit(1); });
