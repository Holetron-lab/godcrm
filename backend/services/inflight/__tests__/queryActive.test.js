// ADR-0057-A WP-D — Integration tests for queryActiveInflight UNION
// + pg_notify smoke for the markPaused → chat_inflight channel.
//
// Acceptance criteria mirror ticket #158170:
//   Case 1: only agent_jobs row    → 1 agent, source='jobs'.
//   Case 2: only _inflight_runs    → 1 agent, source='inflight'.
//   Case 3: both, same agent_row_id → inflight wins (anti-join).
//   Case 4: inflight status='paused' → reason / resume_at / paused_at carry through.
//   Case 5: inflight status IN ('done','failed') → excluded.
//   Smoke : markPaused() emits pg_notify('chat_inflight', …) in same tx.
//
// Gating:
//   - Skipped unless TEST_POSTGRES=true (mirrors connection-postgres.test.js).
//   - Boot guard `backend/test/setup.js` (ADR-0009) aborts if POSTGRES_DB=godcrm_prod.
//   - Caller MUST run with `POSTGRES_DB=godcrm_test` (devloop or CI).
//
// Isolation:
//   - One fresh `conversations` row per file run, used for every case.
//   - Two test-agent rows in table_rows (1784) with collision-proof slugs.
//   - beforeEach wipes the conversation's inflight + jobs slice; we never
//     touch rows we don't own.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import pg from 'pg';
import { queryActiveInflight } from '../queryActive.js';
import { markPaused } from '../markPaused.js';
import { dbGet, dbRun } from '../../../database/connection.js';

const runPostgresTests = process.env.TEST_POSTGRES === 'true';

const AGENTS_TABLE_ID = 1784;
const SUFFIX = `wpd-${Date.now()}`;

describe.skipIf(!runPostgresTests)('inflight/queryActive — UNION integration (WP-D)', () => {
  /** @type {number|null} */
  let convId = null;
  /** @type {Array<{ id: number, slug: string }>} */
  const agents = [];

  beforeAll(async () => {
    // 1. Ensure _inflight_runs schema exists. Migration 063 is CREATE IF NOT
    //    EXISTS; we mirror only the columns the tests touch so a fresh
    //    godcrm_test (where migrate:latest hasn't run) still boots.
    await dbRun(`
      CREATE TABLE IF NOT EXISTS _inflight_runs (
        id BIGSERIAL PRIMARY KEY,
        ticket_id BIGINT,
        agent_slug TEXT NOT NULL,
        conversation_id BIGINT,
        started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_step_id BIGINT,
        status TEXT NOT NULL DEFAULT 'running',
        reason TEXT,
        resume_at TIMESTAMPTZ,
        resume_attempts INT NOT NULL DEFAULT 0,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT _inflight_runs_status_chk
          CHECK (status IN ('running','paused','done','failed'))
      )
    `);

    // 2. Fresh conversation to anchor FK on agent_jobs.
    const conv = await dbGet(
      `INSERT INTO conversations (type, title, created_by)
       VALUES ('ai_chat', ?, NULL) RETURNING id`,
      [`wpd-integration-${SUFFIX}`]
    );
    convId = conv.id;

    // 3. Two test-agent rows; unique slugs so the JOIN in queryActive
    //    deterministically resolves agent_row_id.
    for (let i = 0; i < 2; i += 1) {
      const slug = `${SUFFIX}-${i}`;
      const row = await dbGet(
        `INSERT INTO table_rows (table_id, base_id, data)
         VALUES (?, ?, ?::jsonb) RETURNING id`,
        [
          AGENTS_TABLE_ID,
          `WPD${i}${Date.now()}`,
          JSON.stringify({ agent_slug: slug, name: `WP-D Test ${i}` }),
        ]
      );
      agents.push({ id: row.id, slug });
    }
  });

  afterAll(async () => {
    if (convId != null) {
      await dbRun(`DELETE FROM _inflight_runs WHERE conversation_id = ?`, [convId]);
      await dbRun(`DELETE FROM agent_jobs WHERE conversation_id = ?`, [convId]);
      await dbRun(`DELETE FROM messages WHERE conversation_id = ?`, [convId]);
      await dbRun(`DELETE FROM conversations WHERE id = ?`, [convId]);
    }
    for (const a of agents) {
      await dbRun(`DELETE FROM table_rows WHERE id = ?`, [a.id]);
    }
  });

  beforeEach(async () => {
    await dbRun(`DELETE FROM _inflight_runs WHERE conversation_id = ?`, [convId]);
    await dbRun(`DELETE FROM agent_jobs WHERE conversation_id = ?`, [convId]);
  });

  it('Case 1 — only agent_jobs row → source=jobs', async () => {
    const a = agents[0];
    await dbRun(
      `INSERT INTO agent_jobs (conversation_id, agent_row_id, agent_name, status, started_at)
       VALUES (?, ?, ?, 'processing', NOW())`,
      [convId, a.id, `WP-D Test ${a.slug}`]
    );

    const result = await queryActiveInflight(convId);

    expect(result).toHaveLength(1);
    const row = result[0];
    expect(row.source).toBe('jobs');
    expect(row.agent_row_id).toBe(a.id);
    expect(row.agent_name).toBe(`WP-D Test ${a.slug}`);
    expect(row.status).toBe('processing');
    expect(row.reason).toBeNull();
    expect(row.resume_at).toBeNull();
    expect(row.paused_at).toBeNull();
    expect(row.agent_slug).toBeNull(); // jobs branch carries no slug
    expect(row.job_db_id).not.toBeNull();
  });

  it('Case 2 — only _inflight_runs row → source=inflight', async () => {
    const a = agents[0];
    await dbRun(
      `INSERT INTO _inflight_runs (conversation_id, agent_slug, status, started_at)
       VALUES (?, ?, 'running', NOW())`,
      [convId, a.slug]
    );

    const result = await queryActiveInflight(convId);

    expect(result).toHaveLength(1);
    const row = result[0];
    expect(row.source).toBe('inflight');
    expect(row.agent_slug).toBe(a.slug);
    expect(row.agent_row_id).toBe(a.id); // resolved via JOIN
    expect(row.agent_name).toBe(`WP-D Test ${0}`); // from data->>'name'
    expect(row.status).toBe('running');
    expect(row.reason).toBeNull();
    expect(row.resume_at).toBeNull();
    expect(row.paused_at).toBeNull(); // not paused → NULL even with updated_at populated
    expect(row.job_db_id).toBeNull();
  });

  it('Case 3 — same agent in both sources → inflight wins (anti-join)', async () => {
    const a = agents[0];

    await dbRun(
      `INSERT INTO _inflight_runs (conversation_id, agent_slug, status, started_at)
       VALUES (?, ?, 'running', NOW())`,
      [convId, a.slug]
    );
    await dbRun(
      `INSERT INTO agent_jobs (conversation_id, agent_row_id, agent_name, status, started_at)
       VALUES (?, ?, ?, 'processing', NOW())`,
      [convId, a.id, `WP-D Test ${a.slug}`]
    );

    const result = await queryActiveInflight(convId);

    expect(result).toHaveLength(1);
    expect(result[0].source).toBe('inflight');
    expect(result[0].agent_slug).toBe(a.slug);
    expect(result[0].agent_row_id).toBe(a.id);

    // Sanity: a *second* agent with only a jobs row still shows up alongside
    // (anti-join is per agent_row_id, not blanket).
    const b = agents[1];
    await dbRun(
      `INSERT INTO agent_jobs (conversation_id, agent_row_id, agent_name, status, started_at)
       VALUES (?, ?, ?, 'pending', NOW())`,
      [convId, b.id, `WP-D Test ${b.slug}`]
    );

    const result2 = await queryActiveInflight(convId);
    expect(result2).toHaveLength(2);
    const bySource = Object.fromEntries(result2.map((r) => [r.source, r]));
    expect(bySource.inflight.agent_row_id).toBe(a.id);
    expect(bySource.jobs.agent_row_id).toBe(b.id);
  });

  it('Case 4 — inflight status=paused → reason/resume_at/paused_at populated', async () => {
    const a = agents[0];
    const resumeAt = new Date(Date.now() + 5 * 60_000); // +5 min
    await dbRun(
      `INSERT INTO _inflight_runs
         (conversation_id, agent_slug, status, reason, resume_at, started_at, metadata)
       VALUES (?, ?, 'paused', 'paused-rate-limit', ?, NOW(), '{"retry_after_s":300}'::jsonb)`,
      [convId, a.slug, resumeAt.toISOString()]
    );

    const result = await queryActiveInflight(convId);

    expect(result).toHaveLength(1);
    const row = result[0];
    expect(row.source).toBe('inflight');
    expect(row.status).toBe('paused');
    expect(row.reason).toBe('paused-rate-limit');
    expect(row.resume_at).not.toBeNull();
    // resume_at is returned as Date or ISO string depending on pg driver; both round-trip
    const observed = new Date(row.resume_at).getTime();
    expect(Math.abs(observed - resumeAt.getTime())).toBeLessThan(2000);
    expect(row.paused_at).not.toBeNull(); // = updated_at when status='paused'
  });

  it('Case 5 — inflight status IN (done, failed) → excluded', async () => {
    const a = agents[0];
    const b = agents[1];
    await dbRun(
      `INSERT INTO _inflight_runs (conversation_id, agent_slug, status, started_at)
       VALUES (?, ?, 'done', NOW())`,
      [convId, a.slug]
    );
    await dbRun(
      `INSERT INTO _inflight_runs (conversation_id, agent_slug, status, started_at)
       VALUES (?, ?, 'failed', NOW())`,
      [convId, b.slug]
    );

    const result = await queryActiveInflight(convId);

    expect(result).toHaveLength(0);
  });

  it('Smoke — markPaused emits pg_notify(chat_inflight) in same tx', async () => {
    const a = agents[0];

    // Dedicated client just for LISTEN — the pool client cannot do LISTEN
    // reliably (it gets returned to the pool and may not be on the wire when
    // the NOTIFY fires).
    const listener = new pg.Client({
      host: process.env.POSTGRES_HOST || 'localhost',
      port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
      database: process.env.POSTGRES_DB,
      user: process.env.POSTGRES_USER,
      password: process.env.POSTGRES_PASSWORD,
    });
    await listener.connect();

    try {
      const inbox = [];
      listener.on('notification', (msg) => {
        if (msg.channel !== 'chat_inflight') return;
        try { inbox.push(JSON.parse(msg.payload || '{}')); } catch { /* drop */ }
      });
      await listener.query('LISTEN chat_inflight');

      const resumeAt = new Date(Date.now() + 60_000);
      const { id: inflightId } = await markPaused({
        agent_slug: a.slug,
        reason: 'paused-manual',
        resume_at: resumeAt,
        conversation_id: convId,
        metadata: { test: SUFFIX },
      });

      // pg driver returns BIGSERIAL as string; coerce for the comparison.
      expect(Number(inflightId)).toBeGreaterThan(0);

      // Give the notify a moment to round-trip. pg.Client emits on the next
      // tick after the server flushes, but in CI we may pay a bit more.
      const deadline = Date.now() + 2000;
      while (inbox.length === 0 && Date.now() < deadline) {
        // eslint-disable-next-line no-await-in-loop
        await new Promise((r) => setTimeout(r, 25));
      }

      expect(inbox.length).toBeGreaterThan(0);
      const payload = inbox[0];
      expect(Number(payload.inflight_id)).toBe(Number(inflightId));
      expect(Number(payload.conversation_id)).toBe(convId);
      expect(payload.agent_slug).toBe(a.slug);
      expect(payload.status).toBe('paused');
      expect(payload.reason).toBe('paused-manual');
      expect(payload.resume_at).toBeTruthy();
      expect(payload.source).toBe('markPaused');
    } finally {
      try { await listener.end(); } catch { /* ignore */ }
    }
  });
});
