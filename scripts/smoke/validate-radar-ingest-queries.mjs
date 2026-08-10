// One-off DRY validation of the ICP monitor-queries before scheduling radar_ingest.
// Runs the REAL executeRadarIngest with dry_run=true (writes ZERO rows) across the
// science/integrity/OSINT query set the marketer handed @sysadmin, and reports how
// many live candidates each query actually returns. Proves the niche queries are not
// dead before we wire them into a cron automation.
import dotenv from 'dotenv';
dotenv.config();
import vault from '../../backend/services/secrets/SecretsVault.js';
import { getAdapter } from '../../backend/database/connection.js';
import { executeRadarIngest } from '../../backend/services/schedule-trigger/action-executors.js';

const QUERIES = [
  { query: '("excel hell" OR "paste between" OR "reverted to paper") (lab OR research OR experiments) lang:en', source_type: 'theme', source_ref: 'sci-excel-hell' },
  { query: '("wrote my own" OR "built my own") (pipeline OR tool OR dashboard) (LIMS OR vendor OR spreadsheet) lang:en', source_type: 'theme', source_ref: 'build-your-own' },
  { query: '(reproducibility OR "raw data" OR "couldn\'t reproduce" OR "lost my data") (science OR lab OR paper) lang:en', source_type: 'theme', source_ref: 'reproducibility' },
  { query: '(Maltego OR "per seat" OR "per-seat") (osint OR research OR "too expensive" OR "self-host") lang:en', source_type: 'theme', source_ref: 'per-seat-cost' },
  { query: '("too many tabs" OR "context switch" OR "tool sprawl" OR "tab hell") (investigation OR workflow OR research) lang:en', source_type: 'theme', source_ref: 'tool-sprawl' },
  { query: '("AI agents" OR "ai agent") (memory OR "lost context" OR "across resets" OR persistent) lang:en', source_type: 'theme', source_ref: 'agent-memory' },
];

async function main() {
  const adapter = await getAdapter();
  await vault.init({ adapter, allowEnvFallback: false });

  let grandFetched = 0, grandCandidates = 0;
  for (const q of QUERIES) {
    const res = await executeRadarIngest({
      queries: [q],
      candidates_table_id: 100208,
      lookback_hours: 72,
      per_query_limit: 10,
      query_type: 'Latest',
      dry_run: true,
    });
    const fetched = res.fetched || 0;
    const cands = res.candidates || 0;
    grandFetched += fetched; grandCandidates += cands;
    const sample = (res.previews || []).slice(0, 2).map(p => `@${p.handle}(${p.text_len}c)`).join(', ');
    console.log(`[${q.source_ref.padEnd(16)}] fetched=${String(fetched).padStart(2)} new=${String(cands).padStart(2)} written=${res.written}  ${sample}`);
    if (res.written !== 0) { console.error('❌ dry-run wrote rows!'); process.exit(1); }
  }
  console.log(`\nTOTAL fetched=${grandFetched} new-candidates=${grandCandidates} written=0 (dry)`);
  console.log(grandCandidates > 0 ? '✅ queries return live signal — safe to schedule' : '⚠️ zero candidates — queries too narrow, retune before scheduling');
  process.exit(0);
}
main().catch(e => { console.error('VALIDATE ERROR', e); process.exit(1); });
