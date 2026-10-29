// Test-only fetch redirects a synthetic HTTPS URL to the fixture's loopback HTTP.
// Production remoteMcpFetch/publicLookup and the CRM source are never changed.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runRemoteMcp } from '../../../backend/services/connectors/remoteMcp.js';
const { url, token } = JSON.parse(readFileSync(0, 'utf8'));
const settings = { url: 'https://blender-fixture.example/mcp', bearer_token: token };
const fetchLocal = (_input, init) => fetch(url, init);
for (const bearer_token of [undefined, 'wrong']) {
  await assert.rejects(runRemoteMcp({ ...settings, bearer_token }, { fetch: fetchLocal }));
}
const list = await runRemoteMcp(settings, { fetch: fetchLocal });
assert.deepEqual(list.tools.map(t => t.name).sort(), ['execute_blender_code', 'get_scene_info']);
const result = await runRemoteMcp(settings, { name: 'get_scene_info', args: {}, fetch: fetchLocal });
assert.equal(result.isError, false);
const scene = JSON.parse(result.content[0].text);
assert.equal(scene.name, 'Scene1_ShadowMan');
assert.equal(scene.object_count, 97);
process.stdout.write('PASS: real runRemoteMcp initialize/list/call/cleanup and auth rejection\n');
