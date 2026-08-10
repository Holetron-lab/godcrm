// backend/services/audit/AuditChainScheduler.js
//
// ADR-0066-A §C/§D (follow-on) — nightly audit-chain integrity check.
//
//   - Runs a full verify once per day.
//   - A break fires a Telegram alert to the owner ("evidence with no
//     detector is theatre").
//   - Emits the current head {max_id, entry_hash} to the owner nightly as
//     an owner-held external anchor (§D) that no box-local actor can
//     revise.
//
// Default OFF. Enable per box with AUDIT_CHAIN_VERIFY_ENABLED=true. This
// keeps it dark on NL until Phase C (schedulers/bots stay off there) and
// lets @sysadmin flip it on Ring 0 — or replace this in-process timer
// with a systemd timer that curls GET /api/v3/audit/verify. Either wiring
// path is fine; the code is the same verify + alert.

import { logger } from '../../utils/logger.js';
import { sendAdminAlert } from '../TelegramService.js';
import { verifyAuditChain } from './verifyAuditChain.js';

const log = logger.child({ module: 'audit-chain-scheduler' });
const DAY_MS = 24 * 60 * 60 * 1000;

let timer = null;

/**
 * One verify pass: alert on break, always emit head as the owner anchor.
 * Never throws — callers schedule it fire-and-forget.
 */
export async function runAuditChainCheck() {
  const result = await verifyAuditChain();

  if (!result.ok) {
    log.error(
      { break_at_id: result.break_at_id, checked: result.checked },
      'nightly audit verify: CHAIN BROKEN'
    );
    await sendAdminAlert(
      `🔴 AUDIT CHAIN BROKEN\n` +
        `break_at_id: ${result.break_at_id}\n` +
        `checked: ${result.checked} (cutover ${result.cutover_id})\n` +
        `Possible tampering — inspect audit_log around this id.`
    ).catch((err) =>
      log.error({ err: { message: err?.message } }, 'break alert delivery failed')
    );
  } else {
    log.info(
      { checked: result.checked, head: result.head },
      'nightly audit verify: chain intact'
    );
  }

  // Owner-held anchor (§D) — recorded off-box, defeats a full rewrite.
  if (result.head) {
    await sendAdminAlert(
      `🔗 Audit chain head (record as anchor)\n` +
        `max_id: ${result.head.max_id}\n` +
        `entry_hash: ${result.head.entry_hash}`
    ).catch((err) =>
      log.error({ err: { message: err?.message } }, 'head anchor delivery failed')
    );
  }

  return result;
}

/**
 * Start the daily scheduler. No-op unless AUDIT_CHAIN_VERIFY_ENABLED=true.
 */
export function startAuditChainScheduler() {
  if (timer) return;
  if (process.env.AUDIT_CHAIN_VERIFY_ENABLED !== 'true') {
    log.info(
      'audit chain scheduler disabled (set AUDIT_CHAIN_VERIFY_ENABLED=true to enable)'
    );
    return;
  }

  const run = () =>
    runAuditChainCheck().catch((err) =>
      log.error({ err: { message: err?.message } }, 'nightly audit verify crashed')
    );

  // First pass shortly after boot, then every 24h. unref so the timer
  // never keeps the process alive on shutdown.
  const kick = setTimeout(run, 60 * 1000);
  kick.unref?.();
  timer = setInterval(run, DAY_MS);
  timer.unref?.();

  log.info('audit chain scheduler started (daily full verify + owner head emit)');
}

export function stopAuditChainScheduler() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
