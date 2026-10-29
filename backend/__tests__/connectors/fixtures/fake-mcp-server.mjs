#!/usr/bin/env node
// Minimal stdio MCP server used by the Blender MCP connector tests.
// Speaks newline-delimited JSON-RPC like a real MCP server; no SDK needed.
//
//   FAKE_MCP_MODE=ok    (default) answers initialize / tools/list / tools/call
//   FAKE_MCP_MODE=hang  never answers — exercises the probe timeout
//   FAKE_MCP_MODE=exit  exits 3 with a stderr line before answering
//
// It also echoes AGENT_ID / SPACE_ID it was started with in serverInfo so a
// test can prove which scope the probe passed down.
import readline from 'node:readline';

const mode = process.env.FAKE_MCP_MODE || 'ok';
if (mode === 'exit') {
  process.stderr.write('fake-mcp: refusing to start\n');
  process.exit(3);
}

const TOOLS = [
  { name: 'get_scene_info', description: 'Read the scene', inputSchema: { type: 'object' } },
  { name: 'get_addon_status', description: 'Addon status', inputSchema: { type: 'object' } },
];

const out = (obj) => process.stdout.write(JSON.stringify(obj) + '\n');
const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  if (mode === 'hang') return;
  let req;
  try {
    req = JSON.parse(line);
  } catch {
    return;
  }
  if (!req || typeof req !== 'object' || !('id' in req)) return; // notification
  const res = { jsonrpc: '2.0', id: req.id };
  switch (req.method) {
    case 'initialize':
      res.result = {
        protocolVersion: req.params?.protocolVersion || '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: {
          name: 'fake-mcp',
          version: '1.0.0',
          agent_id: process.env.AGENT_ID || null,
          space_id: process.env.SPACE_ID || null,
        },
      };
      break;
    case 'tools/list':
      res.result = { tools: TOOLS };
      break;
    case 'tools/call':
      res.result = { content: [{ type: 'text', text: `called ${req.params?.name}` }] };
      break;
    case 'ping':
      res.result = {};
      break;
    default:
      res.error = { code: -32601, message: 'unknown method' };
  }
  out(res);
});
rl.on('close', () => process.exit(0));
