// ADR-0181 — Agent Write-Reservations. Runs against godcrm_test (ADR-0009).
// The ADR-0009 boot guard (backend/test/setup.js) hard-aborts if this points
// at a combat master, so the DB-backed cases below are safe by construction.
import { describe, test, expect, beforeAll, afterEach } from 'vitest';
import { dbRun } from '../../../database/connection.js';
import {
  normalizeReservationPath,
  acquireWriteReservation,
  releaseWriteReservation,
  checkReservation,
  gateWrite,
  WRITE_TOOLS,
} from '../reservations.js';

// ── Part A — path normalization (pure, no DB) — ADR-0181 AC#4 ──────────────
describe('normalizeReservationPath', () => {
  const REL = 'backend/routes/v3/__tests__/sim-setup-tables.test.js';

  test('shared edit-tree absolute path → repo-relative key', () => {
    expect(normalizeReservationPath(`/root/production/business-crm/${REL}`)).toBe(REL);
  });

  test('per-agent worktree path → same repo-relative key', () => {
    expect(
      normalizeReservationPath(`/root/production/business-crm/.claude/worktrees/agent-ralph-7/${REL}`)
    ).toBe(REL);
  });

  test('deploy-artifact path → same repo-relative key', () => {
    expect(normalizeReservationPath(`/srv/godcrm/live/${REL}`)).toBe(REL);
  });

  test('all three tree forms collapse to ONE key', () => {
    const a = normalizeReservationPath(`/root/production/business-crm/${REL}`);
    const b = normalizeReservationPath(`/root/production/business-crm/.claude/worktrees/agent-x/${REL}`);
    const c = normalizeReservationPath(`/srv/godcrm/live/${REL}`);
    expect(new Set([a, b, c]).size).toBe(1);
  });

  test('already-relative path passes through', () => {
    expect(normalizeReservationPath(REL)).toBe(REL);
  });

  test('unusable input → null', () => {
    expect(normalizeReservationPath(null)).toBeNull();
    expect(normalizeReservationPath('')).toBeNull();
    expect(normalizeReservationPath(42)).toBeNull();
  });
});

// ── Part B — acquire / gate / steal (DB-backed, godcrm_test) ───────────────
describe('write-reservation acquire semantics', () => {
  const KEY = `__adr0181_test__/${Date.now()}_a.js`;

  beforeAll(async () => {
    // Idempotent — mirrors migration 079 so the suite is hermetic on a fresh
    // godcrm_test that may not have the migration applied yet.
    await dbRun(`
      CREATE TABLE IF NOT EXISTS _agent_write_reservations (
        file_path       TEXT PRIMARY KEY,
        wp_id           TEXT,
        holder_session  TEXT NOT NULL,
        agent_id        INT,
        space_id        INT,
        acquired_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        renewed_at      TIMESTAMPTZ,
        expires_at      TIMESTAMPTZ NOT NULL
      )
    `);
  });

  afterEach(async () => {
    await dbRun(`DELETE FROM _agent_write_reservations WHERE file_path LIKE '__adr0181_test__/%'`);
  });

  test('AC#2 fresh path → granted', async () => {
    const r = await acquireWriteReservation({ filePath: KEY, holderSession: 'loopA' });
    expect(r.granted).toBe(true);
  });

  test('AC#2 same holder re-acquire → granted (idempotent renew)', async () => {
    await acquireWriteReservation({ filePath: KEY, holderSession: 'loopA', wpId: 'WP-1' });
    const r = await acquireWriteReservation({ filePath: KEY, holderSession: 'loopA', wpId: 'WP-1' });
    expect(r.granted).toBe(true);
    const held = await checkReservation(KEY);
    expect(held.holder_session).toBe('loopA');
    expect(held.renewed_at).not.toBeNull(); // DO UPDATE path stamped renewed_at
  });

  test('AC#2 different live holder → denied with holder + expiry', async () => {
    await acquireWriteReservation({ filePath: KEY, holderSession: 'loopA', wpId: 'WP-1' });
    const r = await acquireWriteReservation({ filePath: KEY, holderSession: 'loopB' });
    expect(r.granted).toBe(false);
    expect(r.holder).toBe('loopA');
    expect(r.wpId).toBe('WP-1');
    expect(r.expiresAt).toBeTruthy();
  });

  test('AC#3 stale reservation is transparently stolen', async () => {
    // Acquire with a 1s TTL, then let it expire.
    await acquireWriteReservation({ filePath: KEY, holderSession: 'deadLoop', ttlSeconds: 1 });
    await new Promise((res) => setTimeout(res, 1100));
    const r = await acquireWriteReservation({ filePath: KEY, holderSession: 'loopB' });
    expect(r.granted).toBe(true);
    const held = await checkReservation(KEY);
    expect(held.holder_session).toBe('loopB');
  });

  test('release removes only the holder’s own row', async () => {
    await acquireWriteReservation({ filePath: KEY, holderSession: 'loopA' });
    // Wrong holder cannot release.
    expect(await releaseWriteReservation({ filePath: KEY, holderSession: 'loopB' })).toBe(false);
    // Rightful holder can (path given in absolute form → normalized).
    const abs = `/root/production/business-crm/${KEY}`;
    expect(await releaseWriteReservation({ filePath: abs, holderSession: 'loopA' })).toBe(true);
    expect(await checkReservation(KEY)).toBeNull();
  });
});

// ── Part C — gateWrite wiring (DB-backed) — AC#2 / AC#6 ────────────────────
describe('gateWrite (/check post-allow stage)', () => {
  const REL = `__adr0181_test__/${Date.now()}_gate.js`;
  const ABS = `/root/production/business-crm/${REL}`;

  beforeAll(async () => {
    await dbRun(`
      CREATE TABLE IF NOT EXISTS _agent_write_reservations (
        file_path TEXT PRIMARY KEY, wp_id TEXT, holder_session TEXT NOT NULL,
        agent_id INT, space_id INT, acquired_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        renewed_at TIMESTAMPTZ, expires_at TIMESTAMPTZ NOT NULL
      )`);
  });
  afterEach(async () => {
    await dbRun(`DELETE FROM _agent_write_reservations WHERE file_path LIKE '__adr0181_test__/%'`);
  });

  test('AC#6 non-mutation tool → null (untouched)', async () => {
    const out = await gateWrite({ toolName: 'Bash', toolInput: { command: 'ls' }, holderSession: 'loopA' });
    expect(out).toBeNull();
  });

  test('Edit with no holder session → null (cannot reserve, allow)', async () => {
    const out = await gateWrite({ toolName: 'Edit', toolInput: { file_path: ABS }, holderSession: null });
    expect(out).toBeNull();
  });

  test('AC#2 first Edit → null (allow); rival Edit → soft-deny object', async () => {
    const first = await gateWrite({ toolName: 'Edit', toolInput: { file_path: ABS }, holderSession: 'loopA', wpId: 'WP-9' });
    expect(first).toBeNull(); // acquired → keep policy allow

    // A DIFFERENT loop editing the SAME logical file via a worktree path.
    const wt = `/root/production/business-crm/.claude/worktrees/agent-b/${REL}`;
    const rival = await gateWrite({ toolName: 'Edit', toolInput: { file_path: wt }, holderSession: 'loopB' });
    expect(rival).toMatchObject({ decision: 'deny', matched_source: 'reservation', matched_rule_id: null });
    expect(rival.reason).toContain('loopA');
  });

  test('same holder re-Edit (multi-file WP turn) → null (renew, allow)', async () => {
    await gateWrite({ toolName: 'Write', toolInput: { file_path: ABS }, holderSession: 'loopA' });
    const again = await gateWrite({ toolName: 'Edit', toolInput: { file_path: ABS }, holderSession: 'loopA' });
    expect(again).toBeNull();
  });
});

test('WRITE_TOOLS covers file-mutation tools only', () => {
  expect([...WRITE_TOOLS].sort()).toEqual(['Edit', 'MultiEdit', 'NotebookEdit', 'Write']);
  expect(WRITE_TOOLS.has('Bash')).toBe(false);
});
