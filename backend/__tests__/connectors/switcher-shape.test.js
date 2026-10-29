// @vitest-environment node
/**
 * ADR-159 switcher mode — `GET /spaces/:id/connectors?compatible_with=<module>`.
 *
 * The account switcher and the mail «Accounts» settings bind to the scrubbed
 * `space_connectors` row (display_name / account_name / account_label / email),
 * the same shape the settings view returns. A narrower projection here is what
 * made the CRM name look unsaved in Mail → Settings → Accounts (2026-10-17).
 * Boot guard imported per ADR-0009.
 */

import './../../test/setup.js';
import crypto from 'crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createEphemeralWorkspace } from '../../tests/helpers/workspace-fixture.js';
import { dbRun } from '../../database/connection.js';

if (!process.env.CRM_CREDENTIAL_KEY) {
  process.env.CRM_CREDENTIAL_KEY = crypto.randomBytes(32).toString('hex');
}
if (!process.env.JWT_SECRET) {
  process.env.JWT_SECRET = 'test-secret-' + crypto.randomBytes(8).toString('hex');
}

const { default: connectorsRouter } = await import('../../routes/v3/connectors.js');

describe('GET /spaces/:spaceId/connectors?compatible_with=mail', () => {
  let ws;
  let app;
  let connectorId;

  beforeAll(async () => {
    ws = await createEphemeralWorkspace({ dashboard: false, table: false, label: 'switcher' });
    const row = await dbRun(
      `INSERT INTO space_connectors
         (space_id, type_slug, kind, display_name, status, account_label, email, account_name,
          encrypted_payload, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        ws.spaceId,
        'imap',
        'api_key',
        'Счета · bill',
        'active',
        'SIXTYNINE · Счета',
        'bill@example.test',
        'Bill',
        JSON.stringify({ v: 1, iv: 'iv', tag: 'tag', ct: 'ct' }),
        ws.userId,
      ]
    );
    connectorId = row.lastInsertRowid;

    app = express();
    app.use(express.json());
    // The fixture user owns the space, so checkUserSpaceAccess passes on rule 1.
    app.use((req, _res, next) => {
      req.user = { id: ws.userId, role: 'user' };
      next();
    });
    app.use('/api/v3', connectorsRouter);
  });

  afterAll(async () => {
    await dbRun('DELETE FROM space_connectors WHERE space_id = ?', [ws.spaceId]);
    await ws.cleanup();
  });

  it('returns the scrubbed settings-view row (display_name included, no secrets)', async () => {
    const res = await request(app).get(`/api/v3/spaces/${ws.spaceId}/connectors?compatible_with=mail`);
    expect(res.status).toBe(200);
    const { connectors } = res.body.data;
    expect(connectors).toHaveLength(1);
    expect(connectors[0]).toMatchObject({
      id: connectorId,
      type_slug: 'imap',
      kind: 'api_key',
      display_name: 'Счета · bill',
      account_name: 'Bill',
      account_label: 'SIXTYNINE · Счета',
      email: 'bill@example.test',
      status: 'active',
      enabled: true,
      has_payload: true,
    });
    expect(connectors[0]).not.toHaveProperty('encrypted_payload');
  });

  it('rejects an unknown module', async () => {
    const res = await request(app).get(`/api/v3/spaces/${ws.spaceId}/connectors?compatible_with=nope`);
    expect(res.status).toBe(400);
  });
});
