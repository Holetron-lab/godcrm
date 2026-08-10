#!/usr/bin/env node
/**
 * Live smoke: prove the Bluesky amplifier-graph handler works end-to-end from
 * THIS box — vault read (bluesky_handle/app_password) → createSession on the PDS
 * → searchPosts on the AppView. Read-only; touches no prod-DB writes.
 *
 *   node scripts/smoke/bluesky-search-smoke.mjs ["query"]
 *
 * Exit: 0 = got results, 1 = error/empty, 2 = vault not configured.
 */
import dotenv from 'dotenv';
dotenv.config();

import vault from '../../backend/services/secrets/SecretsVault.js';
import { getAdapter as getDbAdapter } from '../../backend/database/connection.js';
import { blueskyToolHandlers } from '../../backend/services/agent-tools/bluesky-tools.js';

const query = process.argv[2] || 'bioinformatics pain';

async function main() {
  if (!process.env.SECRETS_MASTER_KEY) {
    console.error('❌ SECRETS_MASTER_KEY not set — cannot read vault.');
    process.exit(2);
  }
  const adapter = await getDbAdapter();
  await vault.init({ adapter, allowEnvFallback: false });

  console.log(`→ bluesky_search(${JSON.stringify(query)}, sort=top, limit=5)`);
  const out = await blueskyToolHandlers.bluesky_search({ query, limit: 5, sort: 'top' });

  await vault.shutdown();
  if (adapter?.close) { try { await adapter.close(); } catch { /* ignore */ } }

  if (out.error) {
    console.error('❌', out.error, out.hint ? `\n   hint: ${out.hint}` : '');
    process.exit(out.error.includes('not configured') ? 2 : 1);
  }

  console.log(`✅ provider=${out.provider} sort=${out.sort} results=${out.results_count}`);
  for (const r of out.results) {
    console.log(
      `  [#${r.index}] @${r.author.handle}  ♥${r.amplifier.likes} 🔁${r.amplifier.reposts} 💬${r.amplifier.replies}` +
        `\n        ${r.text.slice(0, 120).replace(/\s+/g, ' ')}` +
        `\n        ${r.url || r.uri}`
    );
  }
  process.exit(out.results_count > 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('smoke fatal:', err);
  process.exit(1);
});
