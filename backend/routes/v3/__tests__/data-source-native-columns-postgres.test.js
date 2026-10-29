// @vitest-environment node
// Read-only integration: no fixtures, migrations, or data mutations.
import { beforeAll, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import { dbGet } from '../../../database/connection.js';
import router from '../data-sources.js';

const app = express();
app.use((req, _res, next) => {
  req.user = { id: 8981, role: req.headers['x-test-role'] || 'admin' };
  next();
});
app.use('/api/v3/data-sources', router);

beforeAll(async () => {
  expect((await dbGet('SELECT current_database() AS name')).name).toBe('godcrm_test');
});

it.each(['conversations', 'conversation_participants', 'messages', 'files', 'spaces', 'users'])(
  'reads live PostgreSQL metadata for %s', async name => {
    const res = await request(app).get(`/api/v3/data-sources/internal-crm/tables/${name}/columns`);
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
    for (const column of res.body.data) {
      expect(column).toEqual({
        name: expect.any(String), type: expect.any(String), nullable: expect.any(Boolean),
        default: expect.toBeOneOf([null, expect.any(String)]),
        is_identity: expect.any(Boolean), is_generated: expect.any(Boolean),
      });
    }
    if (name === 'conversations') {
      expect(res.body.data).toContainEqual(expect.objectContaining({ name: 'space_id', type: 'integer', nullable: true }));
      expect(res.body.data).toContainEqual(expect.objectContaining({ name: 'id', nullable: false }));
    }
  },
);

it('refuses a non-admin through the HTTP router', async () => {
  const res = await request(app)
    .get('/api/v3/data-sources/internal-crm/tables/users/columns').set('x-test-role', 'user');
  expect(res.status).toBe(403);
  expect(res.body.data).toBeUndefined();
});
