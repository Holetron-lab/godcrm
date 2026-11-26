// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
const h = vi.hoisted(() => ({ spawn:vi.fn() }));
vi.mock('child_process', () => ({spawn:h.spawn}));
import { executeCodexCli } from '../ai-execution/cli-providers.js';
it('leaves the managed MCP space to the CLI launcher', () => {
  const config = JSON.parse(readFileSync(new URL('../../../../.mcp.json', import.meta.url), 'utf8'));
  expect(config.mcpServers.godcrm.env).not.toHaveProperty('MCP_SPACE_ID');
});
it('pins MCP identity/job in Codex launch overrides, without changing global config', async () => {
  h.spawn.mockImplementation(() => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
    child.stdin = {write:vi.fn(),end:vi.fn()}; child.unref = vi.fn();
    setTimeout(() => {
      child.stdout.emit('data',JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'done'}})+'\n');
      child.emit('close',0);
    },1);
    return child;
  });
  await executeCodexCli({messages:[{role:'user',content:'test'}],agentId:21,spaceId:11,jobId:101});
  expect(h.spawn.mock.lastCall[1]).toEqual(expect.arrayContaining([
    'mcp_servers.godcrm.env.AGENT_ID="21"',
    'mcp_servers.godcrm.env.SPACE_ID="11"',
    'mcp_servers.godcrm.env.MCP_SPACE_ID="11"',
    'mcp_servers.godcrm.env.MCP_JOB_ID="101"',
  ]));
});
