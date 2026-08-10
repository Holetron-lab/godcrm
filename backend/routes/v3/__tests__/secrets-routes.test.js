// @vitest-environment node
/**
 * ADR-0040 Phase 1 — /api/v3/secrets integration tests.
 *
 * Maps 1:1 to ticket T-140012 acceptance criteria + test_steps:
 *   AC1/T1 — POST creates row; persisted encrypted_payload is v:1 blob,
 *            plaintext never lands in storage.
 *   AC1/T2 — GET lists rows; no plaintext, no encrypted_payload field.
 *   AC1/T3 — POST /:key/reveal returns plaintext + writes audit_log row
 *            (entity_type='secret', action='secret.reveal', NO plaintext
 *            in details).
 *   AC1    — PUT /:key partial update path (plaintext-only, description-only).
 *   AC1    — DELETE hard-removes row + appends audit row.
 *   AC2/T5 — 31st reveal in an hour returns 429 (REVEAL_RATE_LIMITED).
 *   AC1/T4 — Non-owner JWT → 403 on every route.
 *
 * Boot guard: backend/test/setup.js auto-runs on import — refuses to touch
 * PROD DB (ADR-0009).
 */

import './../../../test/setup.js';
import crypto from 'crypto';
import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

// Prime env BEFORE any router import — vault + JWT need them at module load.
if (!process.env.SECRETS_MASTER_KEY) {
  process.env.SECRETS_MASTER_KEY = crypto.randomBytes(32).toString('hex');
}
if (!process.env.JWT_SECRET) {
  process.env.JWT_SECRET = 'test-secret-' + crypto.randomBytes(8).toString('hex');
}
const JWT_SECRET = process.env.JWT_SECRET;

// Lazy imports so env is primed first.
const { PostgresAdapter } = await import('../../../database/adapters/PostgresAdapter.js');
const { dbRun, dbGet, dbAll } = await import('../../../database/connection.js');
const { default: secretsVault } = await import('../../../services/secrets/SecretsVault.js');
const { default: secretsRouter, revealLimiter } = await import('../secrets.js');
const { authenticate } = await import('../../../middleware/auth.js');

const TABLE = '_secrets';
const OWNER_SPACE_ID = 11;

async function ensureMigrations(adapter) {
  // _secrets — apply P0 migration if absent.
  const rel = await adapter.query(
    `SELECT to_regclass('public.${TABLE}') AS r`
  );
  if (rel.rows[0]?.r == null) {
    const mig = await import(
      '../../../database/migrations/knex/057_adr_0040_phase0_secrets_vault.js'
    );
    const knexShim = {
      client: { config: { client: 'pg' } },
      raw: async (sql, bindings = []) => adapter.query(sql, bindings),
    };
    await mig.up(knexShim);
  }
  // Minimal users + audit_log + spaces — godcrm_test on DEV is a slim
  // sandbox, not a full PROD copy. Recreate just the columns this suite
  // touches; full schema lives in `make sync-db`.
  await adapter.query(`
    CREATE TABLE IF NOT EXISTS users (
      id integer PRIMARY KEY,
      email text NOT NULL,
      password_hash text NOT NULL DEFAULT '',
      name text NOT NULL DEFAULT '',
      role text DEFAULT 'user',
      encryption_key_encrypted text NOT NULL DEFAULT '',
      created_at timestamptz DEFAULT NOW()
    )
  `);
  await adapter.query(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id serial PRIMARY KEY,
      user_id integer,
      action text NOT NULL,
      entity_type text,
      entity_id text,
      details text,
      ip_address text,
      user_agent text,
      created_at timestamptz DEFAULT NOW()
    )
  `);
  // `spaces` already exists on this DB (godcrm_test). Be defensive in case
  // a future drop wipes it.
  await adapter.query(`
    CREATE TABLE IF NOT EXISTS spaces (
      id integer PRIMARY KEY,
      owner_id integer NOT NULL,
      name text NOT NULL DEFAULT '',
      type text NOT NULL DEFAULT 'admin'
    )
  `);
}

async function clearSecretsTable() {
  await dbRun(`DELETE FROM ${TABLE}`);
}

async function ensureOwnerUser() {
  // Seed the canonical owner (id=1) and one non-owner (id=2). Idempotent —
  // ON CONFLICT lets the suite re-run without manual cleanup.
  await dbRun(
    `INSERT INTO users (id, email, name, role)
     VALUES (1, ?, ?, 'owner')
     ON CONFLICT (id) DO NOTHING`,
    ['owner-test@local', 'Owner Test']
  );
  await dbRun(
    `INSERT INTO users (id, email, name, role)
     VALUES (2, ?, ?, 'admin')
     ON CONFLICT (id) DO NOTHING`,
    ['nonowner-test@local', 'NonOwner Test']
  );
  // Ensure space 11 exists and is owned by user 1.
  await dbRun(
    `INSERT INTO spaces (id, owner_id, name, type)
     VALUES (?, 1, 'Development', 'admin')
     ON CONFLICT (id) DO UPDATE SET owner_id = 1`,
    [OWNER_SPACE_ID]
  );
  return { ownerId: 1, otherId: 2 };
}

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(authenticate);
  app.use('/api/v3/secrets', secretsRouter);
  return app;
}

function signFor(userId) {
  return jwt.sign({ id: userId, userId, email: `u${userId}@test`, role: 'admin' }, JWT_SECRET);
}

describe('ADR-0040 P1 — /api/v3/secrets', () => {
  let app;
  let adapter;
  let ownerToken;
  let otherToken;
  let ownerId;
  let otherId;

  beforeAll(async () => {
    adapter = new PostgresAdapter({});
    await adapter.initialize();
    await ensureMigrations(adapter);
    await secretsVault.init({ adapter });
    const ids = await ensureOwnerUser();
    ownerId = ids.ownerId;
    otherId = ids.otherId;
    ownerToken = signFor(ownerId);
    otherToken = signFor(otherId);
    app = makeApp();
  });

  afterAll(async () => {
    try { await secretsVault.shutdown(); } catch { /* ignore */ }
    try { await adapter.close?.(); } catch { /* ignore */ }
  });

  beforeEach(async () => {
    await clearSecretsTable();
    // Drop test audit rows so reveal-audit assertion is clean.
    await dbRun(`DELETE FROM audit_log WHERE entity_type = 'secret'`);
    // Reset reveal-rate budget for the owner so prior cases don't bleed into
    // the 30-budget probe in T5. resetKey returns a Promise in v8+.
    try {
      await Promise.resolve(revealLimiter.resetKey?.(`u:${ownerId}`));
      await Promise.resolve(revealLimiter.resetKey?.(`u:${otherId}`));
    } catch { /* ignore */ }
  });

  // ── T1 ─────────────────────────────────────────────────────────────
  it('T1 — POST creates row; encrypted_payload is v:1 blob, plaintext never stored', async () => {
    const res = await request(app)
      .post('/api/v3/secrets')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ key: 'test_key', plaintext: 'hunter2', description: 'CI smoke key' });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.secret.key).toBe('test_key');
    expect(res.body.data.secret.description).toBe('CI smoke key');
    // Plaintext MUST NOT round-trip back from POST.
    expect(JSON.stringify(res.body)).not.toContain('hunter2');
    // Persisted payload is the encrypted blob.
    const row = await dbGet(
      `SELECT encrypted_payload FROM ${TABLE} WHERE key = ? LIMIT 1`,
      ['test_key']
    );
    const blob = typeof row.encrypted_payload === 'string'
      ? JSON.parse(row.encrypted_payload)
      : row.encrypted_payload;
    expect(blob.v).toBe(1);
    expect(typeof blob.iv).toBe('string');
    expect(typeof blob.tag).toBe('string');
    expect(typeof blob.ct).toBe('string');
    expect(JSON.stringify(blob)).not.toContain('hunter2');
  });

  it('POST returns 409 when key already exists', async () => {
    await request(app)
      .post('/api/v3/secrets')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ key: 'dup_key', plaintext: 'first' })
      .expect(201);
    const res = await request(app)
      .post('/api/v3/secrets')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ key: 'dup_key', plaintext: 'second' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
  });

  // ── T2 ─────────────────────────────────────────────────────────────
  it('T2 — GET lists rows without plaintext and without encrypted_payload', async () => {
    await request(app)
      .post('/api/v3/secrets')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ key: 'alpha', plaintext: 'A-plain' })
      .expect(201);
    await request(app)
      .post('/api/v3/secrets')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ key: 'beta', plaintext: 'B-plain', description: 'B note' })
      .expect(201);

    const res = await request(app)
      .get('/api/v3/secrets')
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(res.status).toBe(200);
    const list = res.body.data.secrets;
    expect(list.length).toBe(2);
    const keys = list.map((s) => s.key).sort();
    expect(keys).toEqual(['alpha', 'beta']);
    for (const s of list) {
      expect(s.encrypted_payload).toBeUndefined();
      expect(s.plaintext).toBeUndefined();
    }
    // And no plaintext anywhere in the wire payload.
    const body = JSON.stringify(res.body);
    expect(body).not.toContain('A-plain');
    expect(body).not.toContain('B-plain');
  });

  // ── T3 ─────────────────────────────────────────────────────────────
  it('T3 — reveal returns plaintext + writes audit_log row (no plaintext in details)', async () => {
    await request(app)
      .post('/api/v3/secrets')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ key: 'reveal_me', plaintext: 'top-sekrit' })
      .expect(201);

    const res = await request(app)
      .post('/api/v3/secrets/reveal_me/reveal')
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.plaintext).toBe('top-sekrit');

    const audit = await dbAll(
      `SELECT user_id, action, entity_type, entity_id, details
         FROM audit_log
        WHERE entity_type = 'secret' AND entity_id = ? AND action = ?`,
      ['reveal_me', 'secret.reveal']
    );
    expect(audit.length).toBe(1);
    expect(audit[0].user_id).toBe(ownerId);
    // Details payload must NOT carry the plaintext.
    expect(audit[0].details).not.toContain('top-sekrit');
    // last_revealed_* fields bumped by SecretsVault.revealSecret.
    const row = await dbGet(
      `SELECT last_revealed_at, last_revealed_by FROM ${TABLE} WHERE key = ?`,
      ['reveal_me']
    );
    expect(row.last_revealed_at).not.toBeNull();
    expect(row.last_revealed_by).toBe(ownerId);
  });

  it('reveal on missing key → 404', async () => {
    const res = await request(app)
      .post('/api/v3/secrets/never_existed/reveal')
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(res.status).toBe(404);
  });

  // ── PUT ────────────────────────────────────────────────────────────
  it('PUT updates plaintext (encrypted_payload changes) and keeps description', async () => {
    await request(app)
      .post('/api/v3/secrets')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ key: 'rotateable', plaintext: 'v1', description: 'keep me' })
      .expect(201);
    const before = await dbGet(
      `SELECT encrypted_payload FROM ${TABLE} WHERE key = ?`,
      ['rotateable']
    );
    const res = await request(app)
      .put('/api/v3/secrets/rotateable')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ plaintext: 'v2' });
    expect(res.status).toBe(200);
    const after = await dbGet(
      `SELECT encrypted_payload, description FROM ${TABLE} WHERE key = ?`,
      ['rotateable']
    );
    // Different IV → different blob even for similar plaintext.
    expect(JSON.stringify(after.encrypted_payload)).not.toEqual(
      JSON.stringify(before.encrypted_payload)
    );
    expect(after.description).toBe('keep me');
    // And the new plaintext round-trips through the vault.
    const v = await secretsVault.getSecret('rotateable');
    expect(v).toBe('v2');
  });

  it('PUT description-only does not change encrypted_payload', async () => {
    await request(app)
      .post('/api/v3/secrets')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ key: 'desc_only', plaintext: 'unchanged' })
      .expect(201);
    const before = await dbGet(
      `SELECT encrypted_payload FROM ${TABLE} WHERE key = ?`,
      ['desc_only']
    );
    const res = await request(app)
      .put('/api/v3/secrets/desc_only')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ description: 'now annotated' });
    expect(res.status).toBe(200);
    const after = await dbGet(
      `SELECT encrypted_payload, description FROM ${TABLE} WHERE key = ?`,
      ['desc_only']
    );
    expect(JSON.stringify(after.encrypted_payload)).toEqual(
      JSON.stringify(before.encrypted_payload)
    );
    expect(after.description).toBe('now annotated');
  });

  it('PUT 404 on missing key', async () => {
    const res = await request(app)
      .put('/api/v3/secrets/ghost')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ plaintext: 'x' });
    expect(res.status).toBe(404);
  });

  // ── DELETE ─────────────────────────────────────────────────────────
  it('DELETE hard-removes row + writes audit', async () => {
    await request(app)
      .post('/api/v3/secrets')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ key: 'doomed', plaintext: 'goodbye' })
      .expect(201);
    const res = await request(app)
      .delete('/api/v3/secrets/doomed')
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(res.status).toBe(200);
    const row = await dbGet(`SELECT id FROM ${TABLE} WHERE key = ?`, ['doomed']);
    expect(row ?? null).toBeNull();
    const audit = await dbAll(
      `SELECT action FROM audit_log
        WHERE entity_type = 'secret' AND entity_id = ? AND action = 'secret.delete'`,
      ['doomed']
    );
    expect(audit.length).toBe(1);
  });

  // ── T4 ─────────────────────────────────────────────────────────────
  it('T4 — non-owner JWT → 403 on every route', async () => {
    // Seed a row as owner so DELETE/PUT/reveal have a target.
    await request(app)
      .post('/api/v3/secrets')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ key: 'guarded', plaintext: 'x' })
      .expect(201);

    const calls = [
      ['get', '/api/v3/secrets'],
      ['post', '/api/v3/secrets', { key: 'forbidden_new', plaintext: 'x' }],
      ['put', '/api/v3/secrets/guarded', { plaintext: 'mutate' }],
      ['post', '/api/v3/secrets/guarded/reveal'],
      ['delete', '/api/v3/secrets/guarded'],
    ];
    for (const [method, url, body] of calls) {
      const req = request(app)[method](url).set('Authorization', `Bearer ${otherToken}`);
      const res = body ? await req.send(body) : await req;
      expect(res.status, `${method.toUpperCase()} ${url}`).toBe(403);
    }
  });

  // ── T5 ─────────────────────────────────────────────────────────────
  it('T5 — 31st reveal/hour returns 429 (REVEAL_RATE_LIMITED)', async () => {
    // express-rate-limit v8 MemoryStore.resetKey doesn't reliably clear the
    // sliding-window counter between tests, so we bypass the issue by giving
    // T5 its own ownerId — fresh keyGenerator output → virgin bucket.
    const t5OwnerId = 999_001;
    await dbRun(
      `INSERT INTO users (id, email, name, role)
       VALUES (?, 't5-owner@local', 'T5 Owner', 'owner')
       ON CONFLICT (id) DO NOTHING`,
      [t5OwnerId]
    );
    await dbRun(`UPDATE spaces SET owner_id = ? WHERE id = ?`, [t5OwnerId, OWNER_SPACE_ID]);
    const t5Token = signFor(t5OwnerId);
    try {
      await request(app)
        .post('/api/v3/secrets')
        .set('Authorization', `Bearer ${t5Token}`)
        .send({ key: 'rl_key', plaintext: 'p' })
        .expect(201);

      for (let i = 1; i <= 30; i++) {
        const r = await request(app)
          .post('/api/v3/secrets/rl_key/reveal')
          .set('Authorization', `Bearer ${t5Token}`);
        expect(r.status, `reveal #${i}`).toBe(200);
      }
      const over = await request(app)
        .post('/api/v3/secrets/rl_key/reveal')
        .set('Authorization', `Bearer ${t5Token}`);
      expect(over.status).toBe(429);
      expect(over.body.error.code).toBe('REVEAL_RATE_LIMITED');
    } finally {
      // Restore canonical owner for any later test runs in the same process.
      await dbRun(`UPDATE spaces SET owner_id = 1 WHERE id = ?`, [OWNER_SPACE_ID]);
    }
  }, 30_000);
});
