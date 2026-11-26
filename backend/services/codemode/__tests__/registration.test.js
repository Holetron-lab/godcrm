// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

function surface(enabled) {
  const script = `
    const { AGENT_TOOLS } = await import('./backend/services/agent-tools/tool-definitions/index.js');
    const { buildToolList } = await import('./backend/services/mcp/buildToolList.js');
    const { createRequire } = await import('node:module');
    const require = createRequire(import.meta.url);
    const { apps } = require('./ecosystem.config.cjs');
    console.log(JSON.stringify({
      agent: AGENT_TOOLS.map((tool) => tool.function.name),
      mcp: buildToolList().map((tool) => tool.name),
      sandbox: apps.some((app) => app.name === 'godcrm-sandbox'),
    }));
  `;
  return JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: process.cwd(),
    env: { ...process.env, CODEMODE_ENABLED: enabled ? 'true' : 'false' },
    encoding: 'utf8',
  }));
}

describe('ADR-206 registration', () => {
  it('keeps API, MCP and PM2 surfaces unchanged while disabled and exposes them when enabled', () => {
    const disabled = surface(false);
    const enabled = surface(true);
    expect(disabled.agent).not.toContain('run_crm_script');
    expect(disabled.mcp).not.toContain('run_crm_script');
    expect(disabled.sandbox).toBe(false);
    expect(enabled.agent).toEqual([...disabled.agent, 'run_crm_script']);
    expect(enabled.mcp).toEqual([...disabled.mcp, 'run_crm_script']);
    expect(enabled.sandbox).toBe(true);
  }, 15_000);
});
