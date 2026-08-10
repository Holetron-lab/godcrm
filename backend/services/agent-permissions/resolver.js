/**
 * ADR-0053 Phase C2 — server-side DB resolver for command policies.
 *
 * The PreToolUse hook (scripts/agent-permission-hook.js) is a one-shot child
 * process spawned by Claude CLI for every tool call. In-memory cache cannot
 * survive in the hook itself; instead the hook POSTs to a localhost endpoint
 * (/api/v3/agent-permissions/check) backed by this resolver, which lives in
 * the long-lived godcrm server process and keeps a 60 s in-memory cache of
 * the `_command_policies` table.
 *
 * pg_notify('command_policies_changed', 'invalidate-all') from the table
 * trigger evicts the cache wholesale on any write. Mirrors SecretsVault.js.
 *
 * Resolution order (most specific wins, deny-wins on tie):
 *   1. CRITICAL_DENIES (code-level, checked client-side in the hook BEFORE
 *      we ever call here — included here too as a defense-in-depth net).
 *   2. scope='space' + agent_id + tool_id
 *   3. scope='space' + agent_id
 *   4. scope='space' + tool_id
 *   5. scope='space' (any agent/tool in the space)
 *   6. scope='global' + agent_id + tool_id
 *   7. scope='global' + agent_id
 *   8. scope='global' + tool_id
 *   9. scope='global' (everyone)
 *  10. default-allow
 *
 * Within a specificity tier, deny wins over allow. Across tiers, the
 * most-specific tier wins regardless of action.
 *
 * Pattern matching:
 *   - exact   → subject === pattern
 *   - prefix  → subject.startsWith(pattern)
 *   - regex   → new RegExp(pattern).test(subject)
 *
 * Subject derivation matches critical-denies.buildSubjects():
 *   Bash      → tool_input.command  (also matched against tool_name as fallback)
 *   Edit/Write→ tool_input.file_path (also matched against tool_name as fallback)
 *   *         → tool_name           (covers MCP-style tools like mcp__notion__*)
 *
 * A pattern with no `:` prefix matches against the natural subject for the
 * tool. A pattern with a `tool:` prefix (e.g. `Bash:rm`, `Edit:/etc/`) anchors
 * the match to that exact tool. This lets policies write
 * `pattern='Bash:rm -rf '` instead of having to repeat the tool name.
 */

import pg from 'pg';
import { apiLogger } from '../../utils/logger.js';
import { matchCriticalDeny, buildSubjects } from './critical-denies.js';

const log = apiLogger.child({ module: 'agent_permissions' });

const CACHE_TTL_MS = 60_000;
const NOTIFY_CHANNEL = 'command_policies_changed';
const POLICIES_TABLE = '_command_policies';
const AUDIT_TABLE = '_command_audit';

// Specificity score for ordering. Higher = wins.
//   bit 3 (8) — scope=space
//   bit 2 (4) — agent_id pinned
//   bit 1 (2) — tool_id pinned
//   bit 0 (1) — pattern is more specific (exact > regex > prefix > empty-pattern)
function specificityScore(row) {
  let s = 0;
  if (row.scope === 'space') s += 8;
  if (row.agent_id != null) s += 4;
  if (row.tool_id != null) s += 2;
  if (row.match_type === 'exact') s += 1;
  return s;
}

class PermissionResolver {
  constructor() {
    this._initialized = false;
    this._adapter = null;
    /** @type {pg.Client|null} */
    this._listener = null;
    /** @type {{ rows: any[], loadedAt: number }|null} */
    this._cache = null;
  }

  async init(opts = {}) {
    if (this._initialized) return this.health();
    this._adapter = opts.adapter ?? null;
    if (this._adapter) {
      try {
        await this._startListener();
      } catch (err) {
        log.error({ err }, 'PermissionResolver: LISTEN client failed — cache eviction degraded to TTL-only');
      }
    }
    this._initialized = true;
    log.info({ listening: !!this._listener }, 'PermissionResolver initialized');
    return this.health();
  }

  async _startListener() {
    const opts = this._adapter?.options || {};
    const connectionConfig = opts.connectionString || opts.url || process.env.POSTGRES_URL
      ? { connectionString: opts.connectionString || opts.url || process.env.POSTGRES_URL }
      : {
          host: opts.host || process.env.POSTGRES_HOST || 'localhost',
          port: parseInt(opts.port || process.env.POSTGRES_PORT || '5432', 10),
          database: opts.database || process.env.POSTGRES_DB || 'godcrm',
          user: opts.user || process.env.POSTGRES_USER || 'godcrm',
          password: opts.password || process.env.POSTGRES_PASSWORD,
          ssl: opts.ssl !== false ? { rejectUnauthorized: false } : false,
        };

    const client = new pg.Client(connectionConfig);
    await client.connect();
    client.on('notification', (msg) => {
      if (msg.channel !== NOTIFY_CHANNEL) return;
      this._cache = null;
      log.debug({ payload: msg.payload }, 'PermissionResolver: cache evicted via NOTIFY');
    });
    client.on('error', (err) => {
      log.error({ err }, 'PermissionResolver: LISTEN client error');
    });
    await client.query(`LISTEN ${NOTIFY_CHANNEL}`);
    this._listener = client;
  }

  async shutdown() {
    if (this._listener) {
      try { await this._listener.end(); } catch { /* ignore */ }
      this._listener = null;
    }
    this._cache = null;
    this._initialized = false;
  }

  health() {
    return {
      ok: this._initialized,
      listening: this._listener !== null,
      cacheLoaded: this._cache !== null,
      cacheAgeMs: this._cache ? Date.now() - this._cache.loadedAt : null,
      cacheSize: this._cache?.rows.length ?? 0,
    };
  }

  async _loadCache() {
    if (!this._adapter) return [];
    if (this._cache && Date.now() - this._cache.loadedAt < CACHE_TTL_MS) {
      return this._cache.rows;
    }
    const result = await this._adapter.query(
      `SELECT id, scope, space_id, agent_id, tool_id, pattern, match_type, action
         FROM ${POLICIES_TABLE}`
    );
    this._cache = { rows: result.rows, loadedAt: Date.now() };
    return result.rows;
  }

  /**
   * Test one rule against a (toolName, toolInput) request.
   * Returns true if the rule matches.
   */
  _ruleMatches(rule, toolName, subjects) {
    let pattern = rule.pattern || '';
    let subject = subjects.tool;

    // tool-prefix anchoring: "Bash:rm -rf" matches only the Bash tool's command.
    const colonIdx = pattern.indexOf(':');
    if (colonIdx > 0 && colonIdx < 20) {
      const prefix = pattern.slice(0, colonIdx);
      if (prefix !== toolName) {
        // not for this tool
        return false;
      }
      pattern = pattern.slice(colonIdx + 1);
      // Choose subject by tool: Bash → command, Edit/Write → path, else tool name.
      if (toolName === 'Bash' && subjects.bash != null) subject = subjects.bash;
      else if ((toolName === 'Edit' || toolName === 'Write') && subjects.path != null) subject = subjects.path;
      else subject = subjects.tool;
    } else {
      // Untyped pattern: try the most informative subject.
      subject = subjects.bash ?? subjects.path ?? subjects.tool;
    }

    if (subject == null) return false;
    switch (rule.match_type) {
      case 'exact':  return subject === pattern;
      case 'regex':  {
        try { return new RegExp(pattern).test(subject); }
        catch { return false; }
      }
      case 'prefix':
      default:       return typeof subject === 'string' && subject.startsWith(pattern);
    }
  }

  /**
   * Resolve a permission decision.
   * @param {{ tool_name: string, tool_input: object, agent_id: number|null, space_id: number|null }} req
   * @returns {Promise<{ decision: 'allow'|'deny', reason: string, matched_source: string, matched_rule_id: number|null }>}
   */
  async resolve(req) {
    const toolName = String(req.tool_name || '');
    const toolInput = req.tool_input && typeof req.tool_input === 'object' ? req.tool_input : {};
    const agentId = req.agent_id != null ? Number(req.agent_id) : null;
    const spaceId = req.space_id != null ? Number(req.space_id) : null;

    // 1. Code-level CRITICAL_DENIES first (defense-in-depth — hook checks too).
    const crit = matchCriticalDeny(toolName, toolInput);
    if (crit) {
      return {
        decision: 'deny',
        reason: crit.reason,
        matched_source: 'code-level',
        matched_rule_id: null,
        matched_rule_name: crit.id,
      };
    }

    // 2. DB rules with specificity ordering.
    const allRules = await this._loadCache();
    const subjects = buildSubjects(toolName, toolInput);

    // Filter to rules whose scope/agent/tool COULD apply to this request.
    const candidates = allRules.filter(r => {
      if (r.scope === 'space') {
        if (spaceId == null || r.space_id !== spaceId) return false;
      }
      if (r.agent_id != null && r.agent_id !== agentId) return false;
      if (r.tool_id != null) {
        // tool_id is a relation to _ai_tools (table 1790). We don't resolve
        // tool_id → tool_name here (would require a JOIN per request) — the
        // pattern is what actually matches. tool_id pinning is metadata for
        // the UI (so the rule shows up grouped by tool); the resolver still
        // gates on pattern. Treat tool_id-pinned rules as applicable.
        // TODO(C4): JOIN _ai_tools to enforce tool_id matches tool_name.
      }
      return this._ruleMatches(r, toolName, subjects);
    });

    if (candidates.length === 0) {
      return {
        decision: 'allow',
        reason: 'No matching policy — default-allow.',
        matched_source: 'default-allow',
        matched_rule_id: null,
      };
    }

    // Pick winning specificity tier; within tier, deny wins.
    let bestScore = -1;
    let winners = [];
    for (const r of candidates) {
      const s = specificityScore(r);
      if (s > bestScore) {
        bestScore = s;
        winners = [r];
      } else if (s === bestScore) {
        winners.push(r);
      }
    }
    const deny = winners.find(r => r.action === 'deny');
    const chosen = deny || winners[0];

    return {
      decision: chosen.action,
      reason: chosen.action === 'deny'
        ? `Denied by policy rule #${chosen.id} (${chosen.scope}/${chosen.match_type}:${chosen.pattern}).`
        : `Allowed by policy rule #${chosen.id} (${chosen.scope}/${chosen.match_type}:${chosen.pattern}).`,
      matched_source: 'db-rule',
      matched_rule_id: chosen.id,
    };
  }

  /**
   * Append an audit row. Best-effort — never throws to the caller.
   */
  async writeAudit({ agent_id, space_id, tool_name, command, decision, matched_rule_id, matched_source, reason }) {
    if (!this._adapter) return;
    try {
      await this._adapter.query(
        `INSERT INTO ${AUDIT_TABLE}
           (agent_id, space_id, tool_name, command, decision, matched_rule_id, matched_source, reason)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          agent_id ?? null,
          space_id ?? null,
          tool_name ?? null,
          (command ?? '').slice(0, 2000), // cap to keep audit rows bounded
          decision,
          matched_rule_id ?? null,
          matched_source,
          (reason ?? '').slice(0, 500),
        ]
      );
    } catch (err) {
      log.error({ err }, 'PermissionResolver: failed to write audit row');
    }
  }
}

const singleton = new PermissionResolver();
export async function init(opts) { return singleton.init(opts); }
export async function shutdown() { return singleton.shutdown(); }
export function health() { return singleton.health(); }
export default singleton;
