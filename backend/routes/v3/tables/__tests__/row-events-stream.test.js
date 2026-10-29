// @vitest-environment node
// End-to-end over the real bus: HTTP SSE subscriber ← LISTEN ← pg_notify ← notifyRowChange().
import '../../../../test/setup.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import express from 'express';
import http from 'node:http';
import { dbGet } from '../../../../database/connection.js';
import { createEphemeralWorkspace } from '../../../../tests/helpers/workspace-fixture.js';
import { notifyRowChange } from '../../../../services/realtime/rowEvents.js';
import router, { closeRowEventsListener } from '../tableRowEventsController.js';

let ws;
let server;
let port;

beforeAll(async () => {
  expect((await dbGet('SELECT current_database() AS name')).name).toBe('godcrm_test');
  ws = await createEphemeralWorkspace({ label: 'row-events', dashboard: false });
  const app = express();
  app.use('/api/v3', router);
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;
});

afterAll(async () => {
  await new Promise((resolve) => server?.close(resolve));
  await closeRowEventsListener();
  await ws?.cleanup();
});

/** Plain GET for responses that end on their own (the SSE stream never does). */
function getOnce(path) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    }).on('error', reject);
  });
}

describe('GET /tables/:tableId/events — live row stream', () => {
  it('delivers a row.updated frame published through notifyRowChange()', async () => {
    const path = `/api/v3/tables/${ws.tableId}/events`;
    const streamed = new Promise((resolve, reject) => {
      const req = http.get({ host: '127.0.0.1', port, path }, (res) => {
        let buffer = '';
        res.setEncoding('utf8');
        res.on('data', async (chunk) => {
          buffer += chunk;
          if (buffer.includes('event: hello') && !res.notified) {
            res.notified = true; // subscribed → publish
            await notifyRowChange({ tableId: ws.tableId, rowId: 4242, action: 'updated', source: 'test' });
          }
          if (buffer.includes('event: row.updated')) { req.destroy(); resolve({ status: res.statusCode, headers: res.headers, body: buffer }); }
        });
      });
      req.on('error', (err) => { if (err.code !== 'ECONNRESET') reject(err); });
      setTimeout(() => { req.destroy(); reject(new Error('no row.updated frame within 4 s')); }, 4000);
    });

    const { status, headers, body } = await streamed;
    expect(status).toBe(200);
    expect(headers['content-type']).toMatch(/text\/event-stream/);
    expect(headers['x-accel-buffering']).toBe('no');
    const frame = body.slice(body.indexOf('event: row.updated'));
    const data = JSON.parse(frame.slice(frame.indexOf('data: ') + 6, frame.indexOf('\n\n')));
    expect(data).toMatchObject({ table_id: ws.tableId, row_id: '4242', action: 'updated', source: 'test' });
  });

  it('refuses a table that does not exist', async () => {
    const { status, body } = await getOnce('/api/v3/tables/999999999/events');
    expect(status).toBe(403);
    expect(body).toContain('Table not found');
  });
});
