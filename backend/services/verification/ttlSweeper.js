// ADR-0011 · Phase D · Step 6 — Verification TTL sweeper (C-9).
//
// Periodically scans every `verification` column whose config contains
// `ttl_seconds`, finds rows whose `verified_at` is older than that TTL, and
// regresses them:
//   verified:      false
//   verified_at:   null
//   methods_used:  []
//   jti:           null
//   audit_log:     [...prev, { at, actor: 'system', event: 'regressed', reason: 'ttl_expired' }]
//
// Safety:
//   * Feature-flag gated — no-op when VERIFICATION_COLUMN_ENABLED !== 'true'.
//   * Idempotent — already-regressed cells are skipped by the WHERE clause.
//   * Column-name guard (isSafeIdentifier) — never interpolates user-controlled
//     identifiers straight into SQL even though column names come from our own
//     table_columns registry.

import { dbAll, dbRun } from '../../database/connection.js';
import { apiLogger } from '../../utils/logger.js';
import { validateVerificationConfig } from './validateConfig.js';

const DEFAULT_INTERVAL_MS = 60 * 60 * 1000; // hourly sweep
const ROW_BATCH_LIMIT = 500;

let _interval = null;
let _running = false;

function isEnabled() {
  return process.env.VERIFICATION_COLUMN_ENABLED === 'true';
}

function isSafeIdentifier(name) {
  return typeof name === 'string' && /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name);
}

export function startVerificationTTLSweeper() {
  if (_interval) return;
  const intervalMs = Number(process.env.VERIFICATION_TTL_SWEEP_INTERVAL_MS) || DEFAULT_INTERVAL_MS;
  _interval = setInterval(() => { runVerificationTTLSweep().catch(() => {}); }, intervalMs);
  apiLogger.info({ intervalMs }, 'ADR-0011: VerificationTTLSweeper started');
  // kick off first sweep shortly after boot so TTL isn't a full interval late
  setTimeout(() => { runVerificationTTLSweep().catch(() => {}); }, 10_000);
}

export function stopVerificationTTLSweeper() {
  if (_interval) {
    clearInterval(_interval);
    _interval = null;
    apiLogger.info('ADR-0011: VerificationTTLSweeper stopped');
  }
}

/**
 * Single sweep pass. Returns a summary object for logging/tests.
 */
export async function runVerificationTTLSweep() {
  if (!isEnabled()) return { skipped: 'flag_off', columns: 0, regressed: 0 };
  if (_running) return { skipped: 'already_running', columns: 0, regressed: 0 };
  _running = true;

  const summary = { columns: 0, regressed: 0, errors: 0 };

  try {
    const columns = await dbAll(
      `SELECT id, table_id, column_name AS name, config
         FROM table_columns
        WHERE type = 'verification'`
    );

    for (const col of columns) {
      let cfg = col.config;
      if (typeof cfg === 'string') {
        try { cfg = JSON.parse(cfg); } catch { cfg = null; }
      }
      const cfgCheck = validateVerificationConfig(cfg || {});
      if (!cfgCheck.ok) continue;
      const { ttl_seconds } = cfgCheck.normalized;
      if (!ttl_seconds) continue;
      if (!isSafeIdentifier(col.name)) {
        apiLogger.warn({ columnId: col.id, name: col.name }, 'TTL sweeper: unsafe column identifier, skipping');
        continue;
      }

      summary.columns += 1;

      try {
        // Find rows whose verified_at is past TTL and still flagged verified.
        // JSONB pathing: `data->column_name->>'verified_at'` parsed as timestamptz.
        const expired = await dbAll(
          `SELECT id, data
             FROM table_rows
            WHERE table_id = ?
              AND (data->?->>'verified') = 'true'
              AND (data->?->>'verified_at') IS NOT NULL
              AND ((data->?->>'verified_at')::timestamptz) < (NOW() - (? || ' seconds')::interval)
            LIMIT ${ROW_BATCH_LIMIT}`,
          [col.table_id, col.name, col.name, col.name, String(ttl_seconds)]
        );

        for (const row of expired) {
          try {
            const data = typeof row.data === 'string' ? JSON.parse(row.data || '{}') : (row.data || {});
            const prevCell = data?.[col.name] || {};
            const prevAudit = Array.isArray(prevCell.audit_log) ? prevCell.audit_log : [];
            const at = new Date().toISOString();
            const cell = {
              verified: false,
              verified_at: null,
              verified_by_user_id: null,
              methods_used: [],
              jti: null,
              audit_log: [
                ...prevAudit,
                { at, actor: 'system', event: 'regressed', reason: 'ttl_expired' },
              ],
            };
            await dbRun(
              `UPDATE table_rows
                  SET data = jsonb_set(data, '{${col.name}}', $1::jsonb),
                      updated_at = NOW()
                WHERE id = $2 AND table_id = $3`,
              [JSON.stringify(cell), row.id, col.table_id]
            );
            summary.regressed += 1;
          } catch (rowErr) {
            summary.errors += 1;
            apiLogger.error({ err: rowErr, columnId: col.id, rowId: row.id }, 'TTL sweeper: row regression failed');
          }
        }
      } catch (colErr) {
        summary.errors += 1;
        apiLogger.error({ err: colErr, columnId: col.id }, 'TTL sweeper: column scan failed');
      }
    }

    if (summary.regressed > 0 || summary.errors > 0) {
      apiLogger.info(summary, 'ADR-0011: TTL sweep completed');
    }
  } finally {
    _running = false;
  }

  return summary;
}
