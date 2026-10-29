/**
 * Blender MCP connector — kind 'mcp'.
 *
 * Represents the server-side launcher that opens the owner's home Blender
 * over the pinned reverse tunnel (scripts/blender-mcp/scoped-mcp.py). It has
 * no credentials: what the row carries is the owner's on/off switch and the
 * outcome of the last real connection check.
 *
 * Who may use it is decided on the server, never from the request body:
 *
 *   BLENDER_MCP_COMMAND    launcher path (default /opt/godcrm-blender-mcp/scoped-mcp.py)
 *   BLENDER_MCP_AGENT_ID   the only agent that opens Blender   (crm.hltrn.cc: 174642)
 *   BLENDER_MCP_SPACE_ID   the only space the connector lives in (crm.hltrn.cc: 7809)
 *
 * Without both ids the type reports `configured: false` and no row can be
 * created. Safe mode is a property of the home addon (BLENDER_MCP_SAFE_MODE=1
 * on the launcher side) and is surfaced here as a constant so the UI can say
 * so; the CRM never gets a switch to turn it off.
 */

import { probeStdioMcp } from '../mcpProbe.js';

const DEFAULT_COMMAND = '/opt/godcrm-blender-mcp/scoped-mcp.py';

function envInt(name) {
  const n = Number.parseInt(process.env[name] || '', 10);
  return Number.isFinite(n) ? n : null;
}

const blender_mcp = {
  slug: 'blender_mcp',
  display_name: 'Blender MCP',
  icon: '🧊',
  auth_kind: 'mcp',
  scopes_default: [],
  scopes_choices: [],
  fields: [],
  refresh_supported: false,

  /** Server-side pin, read on every call so a config change needs no restart of this module's state. */
  config() {
    const allowed_agent_id = envInt('BLENDER_MCP_AGENT_ID');
    const allowed_space_id = envInt('BLENDER_MCP_SPACE_ID');
    return {
      configured: allowed_agent_id != null && allowed_space_id != null,
      allowed_agent_id,
      allowed_space_id,
      safe_mode: true,
      command: process.env.BLENDER_MCP_COMMAND || DEFAULT_COMMAND,
    };
  },

  /** Public projection of config() — what the catalogue and rows expose. */
  describe() {
    const { configured, allowed_agent_id, allowed_space_id, safe_mode } = this.config();
    return { configured, allowed_agent_id, allowed_space_id, safe_mode };
  },

  /**
   * Real check: launch exactly as an agent turn would (same env the gate
   * wrapper reads, `opts.env` carrying the gate token) and complete the MCP
   * handshake. The wrapper fails closed as a valid but empty MCP server named
   * `blender-scope-inactive`; that handshake is a denial, not a connection.
   * @param {{env?:Record<string,string>, timeoutMs?:number}} [opts]
   */
  async test(opts = {}) {
    const cfg = this.config();
    const r = await probeStdioMcp({
      command: cfg.command,
      env: {
        AGENT_ID: String(cfg.allowed_agent_id),
        SPACE_ID: String(cfg.allowed_space_id),
        BLENDER_MCP_SAFE_MODE: '1',
        ...(opts.env || {}),
      },
      timeoutMs: opts.timeoutMs || 20_000,
    });
    if (r.ok && r.server_info?.name === 'blender-scope-inactive') {
      return { ...r, ok: false, error_code: 'gate', error: `Launcher denied by the CRM gate (${r.server_info.reason || 'unknown'})` };
    }
    return r;
  },
};

export default blender_mcp;
