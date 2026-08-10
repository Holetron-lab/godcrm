/**
 * DB-free transport smoke for the public MCP mount (NO-SIGNUP-MCP §B).
 * Mounts mcpPublicHandler behind a stub that pins req.publicSpace, then drives
 * a real JSON-RPC handshake through StreamableHTTPServerTransport:
 *   initialize → tools/list (expect EXACTLY the 9-tool read-safe allow-set,
 *   MCP-DOOR-LEGIBILITY Option A) → tools/call list_spaces
 *   (locked → account_required upsell, NOT cross-tenant data).
 * No loader is exercised, so no DB is touched.
 */
import express from 'express';
import request from 'supertest';
import { mcpPublicHandler } from '../../backend/services/mcp/publicMcp.js';

const app = express();
app.use(express.json());
app.all('/s/:slug/mcp', (req, _res, next) => {
  req.publicSpace = { id: 7773, name: 'GOD CRM Public', settings: null, public_slug: 'help' };
  next();
}, mcpPublicHandler);

const HEADERS = { Accept: 'application/json, text/event-stream', 'Content-Type': 'application/json' };
const rpc = (id, method, params = {}) => ({ jsonrpc: '2.0', id, method, params });

let failed = false;
const check = (label, cond, detail) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : ' — ' + detail}`);
  if (!cond) failed = true;
};

// Streamable-HTTP may answer as SSE-framed text even with enableJsonResponse;
// extract the JSON-RPC payload from either shape.
const parseBody = (res) => {
  const t = res.text || (res.body ? JSON.stringify(res.body) : '');
  const line = t.split('\n').find(l => l.startsWith('data:')) || t;
  try { return JSON.parse(line.replace(/^data:\s*/, '')); } catch { return res.body; }
};

const init = await request(app).post('/s/help/mcp').set(HEADERS).send(
  rpc(1, 'initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'smoke', version: '0' },
  })
);
const initBody = parseBody(init);
check('initialize returns a result', init.status === 200 && !!initBody?.result, `status=${init.status} body=${JSON.stringify(initBody).slice(0,200)}`);

const list = await request(app).post('/s/help/mcp').set(HEADERS).send(rpc(2, 'tools/list'));
const listBody = parseBody(list);
const tools = listBody?.result?.tools || [];
const toolNames = tools.map(t => t.name).sort();
const ALLOWSET = [
  'get_dashboard_widgets', 'get_document_content', 'get_table_row', 'get_table_schema',
  'list_documents', 'list_projects', 'list_tables', 'memory_recall', 'query_table_data',
].sort();
check('tools/list advertises EXACTLY the 9 read-safe tools (Option A)',
  toolNames.length === ALLOWSET.length && toolNames.every((n, i) => n === ALLOWSET[i]),
  `got ${tools.length}: ${toolNames.join(',')}`);
check('tools/list advertises NO write/destructive verbs',
  !tools.some(t => /^(delete_|add_|update_|create_|send_|batch_|move_|copy_|printer_)/.test(t.name)),
  toolNames.filter(n => /^(delete_|add_|update_|create_|send_|batch_|move_|copy_|printer_)/.test(n)).join(','));
check('tools/list NOT a "Server not initialized" error', !listBody?.error, JSON.stringify(listBody?.error));

// Lever 1: serverInfo signals read-only + intentionally public.
check('serverInfo.name signals read-only', initBody?.result?.serverInfo?.name === 'godcrm-public-readonly',
  JSON.stringify(initBody?.result?.serverInfo));
check('serverInfo.instructions carries "intentionally public" clause',
  /intentionally public/i.test(initBody?.result?.instructions || ''),
  (initBody?.result?.instructions || '').slice(0, 120));

// Lever 2: GET probe → benign banner, not a transport error.
const probe = await request(app).get('/s/help/mcp');
const probeBody = probe.body || {};
check('GET probe → 200 benign banner', probe.status === 200 && probeBody.intentional === true,
  `status=${probe.status} body=${JSON.stringify(probeBody).slice(0,160)}`);

const locked = await request(app).post('/s/help/mcp').set(HEADERS).send(
  rpc(3, 'tools/call', { name: 'list_spaces', arguments: {} })
);
const lockedBody = parseBody(locked);
const lockedText = lockedBody?.result?.content?.[0]?.text || '';
check('locked tool list_spaces → account_required upsell', lockedText.includes('account_required'), lockedText.slice(0, 160));
check('locked tool did NOT return tenant data', !/space/i.test(lockedText) || lockedText.includes('account_required'), lockedText.slice(0, 160));

console.log(failed ? '\nSMOKE FAILED' : '\nSMOKE OK');
process.exit(failed ? 1 : 0);
