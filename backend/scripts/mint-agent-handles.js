#!/usr/bin/env node
/**
 * ADR-198 T2 (D4) — mint `users.handle` for agent passports that have none.
 *
 * `handle` is the mail local-part (`<handle>@agents.godcrm.ai`) AND the `<<@slug>>`
 * routing key, so every active agent needs one and it must be globally unique
 * (migration 089 / 076 enforce `users_handle_lower_unique`).
 *
 * Source of the slug, in order:
 *   1. the agent's residence row (`table_rows.data->>'slug'`) — keeps the passport handle
 *      identical to the card slug people already type in chat;
 *   2. otherwise the agent's name.
 * Either source goes through `mintBase` = `normaliseSlug(referralPrefix(x))` — the two
 * slugifiers this repo already has (signup's and the passport router's), composed. No new
 * one is written; see mintBase for why both are needed.
 * Collisions (case-insensitive, against the DB and against handles minted earlier in this
 * run) get a `-2`, `-3`, … suffix — the same shape as referral-code minting.
 *
 * Idempotent: only rows with `handle IS NULL` are touched, so a second run is all [SKIP].
 * `status = 'deleted'` passports are skipped entirely.
 *
 *   $ node backend/scripts/mint-agent-handles.js              # report only, writes nothing
 *   $ node backend/scripts/mint-agent-handles.js --dry-run    # same, explicit
 *   $ node backend/scripts/mint-agent-handles.js --apply      # write
 *
 * Exit codes: 0 — ok (or dry-run) · 1 — at least one [FAIL]
 */

import dotenv from 'dotenv';
dotenv.config();

import { dbAll, dbRun, destroyAdapter } from '../database/connection.js';
import { referralPrefix } from '../services/AuthService.js';
import { normaliseSlug } from '../services/agent-users.js';

const APPLY = process.argv.includes('--apply');
const MAX_SUFFIX = 50;

/**
 * The minted handle must survive BOTH namespaces it lives in:
 *   - mail local-part  → `referralPrefix` (Cyrillic map + 20-char cap, signup's slugifier);
 *   - `<<@slug>>` routing → `normaliseSlug`, which every mention is passed through before
 *     `lower(handle) = $1` (agent-users.js:272,372).
 * Composing them is what keeps the two in sync: `referralPrefix` alone leaves `_` in place
 * (slugify's `\w` class keeps it), so "Orchestrator_Agent" would mint `orchestrator_agent`
 * — a legal address that `<<@orchestrator_agent>>` can never resolve, because the mention is
 * normalised to `orchestrator-agent` first. No third slugifier is introduced.
 */
function mintBase(raw) {
  return normaliseSlug(referralPrefix(raw));
}

async function main() {
  console.log(`[mint-handles] db=${process.env.POSTGRES_DB} host=${process.env.POSTGRES_HOST} mode=${APPLY ? 'APPLY' : 'DRY-RUN'}`);

  // Every handle already in use, lowercased — the collision set. Seeded from the DB and
  // extended in-loop so two same-named agents in one run cannot both take `image-generator`.
  const taken = new Set(
    (await dbAll(`SELECT lower(handle) AS h FROM users WHERE handle IS NOT NULL`)).map((r) => r.h)
  );

  // Every active agent passport, not just the handle-less ones: rows that already have a
  // handle are reported as [SKIP] so a second run is visibly all-SKIP (idempotency proof)
  // instead of a silent empty report.
  const candidates = await dbAll(`
    SELECT u.id, u.name, u.handle, r.data->>'slug' AS row_slug
      FROM users u
      LEFT JOIN table_rows r
        ON r.table_id = u.managed_by_agent_table_id
       AND r.id       = u.managed_by_agent_row_id
     WHERE u.user_type = 'agent'
       AND COALESCE(u.status, '') <> 'deleted'
     ORDER BY u.id
  `);

  const report = { NEW: 0, SKIP: 0, FAIL: 0 };
  for (const row of candidates) {
    if (row.handle) {
      console.log(`[SKIP] user ${row.id} "${row.name}" — handle already set: ${row.handle}`);
      report.SKIP++;
      continue;
    }

    const fromRow = row.row_slug ? mintBase(row.row_slug) : null;
    const base = fromRow || mintBase(row.name);
    const source = fromRow ? 'row-slug' : 'name';

    if (!base) {
      console.log(`[FAIL] user ${row.id} "${row.name}" — name yields no slug; issue a handle explicitly`);
      report.FAIL++;
      continue;
    }

    let handle = base;
    for (let n = 2; taken.has(handle.toLowerCase()) && n <= MAX_SUFFIX; n++) handle = `${base}-${n}`;

    if (taken.has(handle.toLowerCase())) {
      console.log(`[FAIL] user ${row.id} "${row.name}" — no free handle for base '${base}' after ${MAX_SUFFIX} tries`);
      report.FAIL++;
      continue;
    }

    if (APPLY) {
      // `WHERE handle IS NULL` re-checks under the write: a concurrent provisioner that
      // filled this row between SELECT and UPDATE wins, and we report [SKIP] instead of
      // clobbering its handle.
      const res = await dbRun(
        `UPDATE users SET handle = ?, updated_at = NOW()
          WHERE id = ? AND (handle IS NULL OR btrim(handle) = '')`,
        [handle, row.id]
      );
      const changed = res?.changes ?? res?.rowCount ?? 0;
      if (changed === 0) {
        console.log(`[SKIP] user ${row.id} "${row.name}" — handle appeared concurrently`);
        report.SKIP++;
        continue;
      }
    }

    taken.add(handle.toLowerCase());
    console.log(`[NEW]  user ${row.id} "${row.name}" → ${handle}  (${source})`);
    report.NEW++;
  }

  console.log(`[mint-handles] ${APPLY ? 'applied' : 'would mint'}: NEW=${report.NEW} SKIP=${report.SKIP} FAIL=${report.FAIL} (candidates=${candidates.length})`);
  if (!APPLY) console.log('[mint-handles] DRY-RUN — nothing written. Re-run with --apply to commit.');
  await destroyAdapter();
  process.exit(report.FAIL > 0 ? 1 : 0);
}

main().catch(async (err) => {
  console.error('[mint-handles] fatal:', err);
  await destroyAdapter().catch(() => {});
  process.exit(1);
});
