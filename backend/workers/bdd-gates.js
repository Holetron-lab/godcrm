/**
 * ADR-156 Appendix C §2.1 — Per-runner security gates.
 *
 * Three gates, one per runner kind. Each returns either
 *   { ok: true }
 * or
 *   { ok: false, reason: '<human-readable denial>' }
 *
 * These are synchronous, pure functions: no DB, no I/O, no side effects. The
 * worker calls the right one based on the `bdd_tests.runner` value.
 *
 * Design notes
 * ------------
 * Appendix C lays out a more ambitious bash allowlist (regex per permitted
 * shell invocation). This iteration 2 delivery keeps the per-test anchored
 * allowlist model (Appendix C §"Adding to the allowlist") but moves the
 * hardcoded denylist into a single place for auditability, and keeps the
 * allow patterns per-test (stored in `bdd_tests.data.runner_config.allow`).
 *
 * The denylist below is checked FIRST and is non-negotiable — even if an
 * author's allow pattern technically matches, any denylist hit aborts.
 *
 * For SQL we accept `SELECT ...` and `WITH <cte> ... SELECT ...` after
 * stripping block/line comments. DDL / DML / PL-SQL blocks are rejected.
 *
 * For MCP we accept only read-shaped tool names from the supplied allowlist
 * (the caller passes `runner_config.tools`) and reject any tool name whose
 * prefix indicates writes — regardless of whether it appears in the allow
 * list. Belt and braces.
 */

// -- BASH ---------------------------------------------------------------------

/**
 * Tokens / substrings that, if present ANYWHERE in a bash command, are refused
 * unconditionally. This is checked before the per-test allow regex list, so
 * a sloppy allow pattern cannot accidentally grant dangerous shell.
 *
 * These are substring or regex matches (not anchored). Order does not matter.
 */
const BASH_DENY_PATTERNS = [
  { name: 'rm_rf',          re: /\brm\s+-[a-zA-Z]*r[a-zA-Z]*f[a-zA-Z]*\b/i },
  { name: 'rm_rf_slash',    re: /\brm\s+-rf\s+\/(?:\s|$)/i },
  { name: 'dd',             re: /\bdd\s+if=/i },
  { name: 'mkfs',           re: /\bmkfs(\.|\s)/i },
  { name: 'fork_bomb',      re: /:\(\)\s*\{\s*:\s*\|\s*:?\s*&\s*\}\s*;?\s*:/ },
  { name: 'curl_pipe_sh',   re: /curl\b[^|]*\|\s*(sh|bash)\b/i },
  { name: 'wget_pipe_sh',   re: /wget\b[^|]*\|\s*(sh|bash)\b/i },
  { name: 'eval',           re: /\beval\b/ },
  { name: 'sudo',           re: /\bsudo\b/ },
  { name: 'su',             re: /(^|\s|;|\|)su\b/ },
  { name: 'chmod_777',      re: /\bchmod\s+[0-7]*777/ },
  { name: 'write_dev',      re: />\s*\/dev\// },
  { name: 'read_passwd',    re: /\/etc\/passwd/ },
  { name: 'killall',        re: /\bkillall\b/ },
  // Secondary defence — these usually indicate smuggling via decoded payloads.
  { name: 'bash_c',         re: /\b(bash|sh)\s+-c\b/ },
  { name: 'base64_to_sh',   re: /base64\b[^|]*\|\s*(sh|bash)\b/i },
  // ADR-156 iter-5 Task 3 — curl-specific denylist. Blocks local-file upload
  // (`-T` / `--upload-file` / `--data-binary @/path`), writes into sensitive
  // roots, and dangerous URL schemes. Safe args like `-s -S -f -L --max-time`
  // remain allowed.
  { name: 'curl_upload',       re: /\bcurl\b[^\n]*\s(-T|--upload-file)\b/i },
  { name: 'curl_databin_file', re: /\bcurl\b[^\n]*\s--data-binary\s+@/i },
  { name: 'curl_write_etc',    re: /\bcurl\b[^\n]*\s-o\s+\/etc\//i },
  { name: 'curl_write_root',   re: /\bcurl\b[^\n]*\s-o\s+\/root\//i },
  { name: 'curl_file_scheme',  re: /\bcurl\b[^\n]*\sfile:\/\//i },
  { name: 'curl_gopher',       re: /\bcurl\b[^\n]*\sgopher:\/\//i },
  { name: 'curl_dict',         re: /\bcurl\b[^\n]*\sdict:\/\//i },
];

/**
 * Default safe curl allow pattern (ADR-156 iter-5 Task 3). Tests whose
 * runner_config.allow doesn't include a curl pattern may opt in by pushing
 * this exact string. Authors can also write their own tighter patterns.
 *
 * Shape: curl with required safety flags (-s -S -f -L --max-time <=30
 * --max-filesize <=1048576) followed by an https URL. Anchored.
 */
const CURL_SAFE_ALLOW_PATTERN = String.raw`^curl\s+-s\s+-S\s+-f\s+-L\s+--max-time\s+(?:[1-9]|[12]\d|30)\s+--max-filesize\s+(?:10[0-3]\d{4}|104[0-7]\d{3}|1048[0-5]\d{2}|104857[0-6])\s+https?://\S+$`;

/**
 * gateBash(command, allowPatterns)
 *
 * @param {string}   command        the full command string to run
 * @param {string[]} allowPatterns  per-test list of anchored regex strings
 *                                  (stored in bdd_tests.data.runner_config.allow).
 *                                  Each pattern is applied with the `^...$` anchors
 *                                  implied — callers must already anchor when authoring.
 * @returns {{ok:true}|{ok:false, reason:string}}
 */
function gateBash(command, allowPatterns) {
  if (typeof command !== 'string' || command.trim() === '') {
    return { ok: false, reason: 'empty command' };
  }
  const cmd = command.trim();

  // 1. Denylist — blanket refusal, no exceptions.
  for (const d of BASH_DENY_PATTERNS) {
    if (d.re.test(cmd)) {
      return { ok: false, reason: `denylist:${d.name}` };
    }
  }

  // 2. Per-test allowlist. Must match at least one.
  if (!Array.isArray(allowPatterns) || allowPatterns.length === 0) {
    return { ok: false, reason: 'no allow patterns configured for this test' };
  }
  for (const pat of allowPatterns) {
    if (typeof pat !== 'string' || pat === '') continue;
    let re;
    try {
      // Author stores anchors explicitly; we do not wrap. Bad regexes are
      // caller errors but we refuse rather than throw.
      re = new RegExp(pat);
    } catch (e) {
      return { ok: false, reason: `allow-pattern-invalid: ${pat}` };
    }
    if (re.test(cmd)) return { ok: true };
  }
  return { ok: false, reason: 'no allow pattern matched' };
}

// -- SQL ----------------------------------------------------------------------

/**
 * Strip SQL comments (both -- line and /* block *\/) so our leading-token
 * detection isn't spoofed by `/* DELETE * / SELECT ...`.
 */
function stripSqlComments(sql) {
  // Remove /* block comments */ (non-greedy, multiline).
  let out = sql.replace(/\/\*[\s\S]*?\*\//g, ' ');
  // Remove -- line comments to end-of-line.
  out = out.replace(/--[^\n]*\n?/g, ' ');
  return out;
}

/**
 * gateSql(statement)
 *
 * Accepts only a single top-level statement that begins with SELECT or
 * WITH ... SELECT after comment stripping. Rejects DDL, DML, and PL blocks.
 * The runner is expected to connect with the `bdd_readonly` role which has
 * SELECT-only grants; this check is belt-and-braces.
 *
 * @param {string} statement
 * @returns {{ok:true}|{ok:false, reason:string}}
 */
function gateSql(statement) {
  if (typeof statement !== 'string' || statement.trim() === '') {
    return { ok: false, reason: 'empty statement' };
  }
  const stripped = stripSqlComments(statement).trim();
  if (stripped === '') return { ok: false, reason: 'statement is comments only' };

  // Refuse multi-statement batches. A lone trailing `;` is allowed.
  const withoutTrailingSemi = stripped.replace(/;\s*$/, '');
  if (withoutTrailingSemi.indexOf(';') !== -1) {
    return { ok: false, reason: 'multiple statements not allowed' };
  }

  const head = withoutTrailingSemi.slice(0, 6).toUpperCase();
  if (head.startsWith('SELECT')) return { ok: true };

  if (head.startsWith('WITH')) {
    // A WITH ... SELECT/VALUES chain. Require the final keyword to be SELECT.
    const upper = withoutTrailingSemi.toUpperCase();
    // Disallow any obvious DML kicker inside a WITH chain.
    if (/\b(INSERT|UPDATE|DELETE|MERGE|TRUNCATE|DROP|ALTER|CREATE|GRANT|REVOKE|COPY|CALL|DO)\b/.test(upper)) {
      return { ok: false, reason: 'non-SELECT keyword found inside WITH chain' };
    }
    if (/\bSELECT\b/.test(upper)) return { ok: true };
    return { ok: false, reason: 'WITH chain without final SELECT' };
  }

  return { ok: false, reason: `statement must begin with SELECT or WITH (got: ${head.toLowerCase().trim()})` };
}

// -- MCP ----------------------------------------------------------------------

/**
 * Tool-name prefixes / substrings that indicate a write-capable MCP tool.
 * Tools matching any of these are refused even if they appear in the per-test
 * allow list, mirroring Appendix C §2.1 "Write-capable MCP tools are denied".
 */
const MCP_DENY_SUBSTRINGS = [
  'create_', 'update_', 'delete_',
  'batch_update_', 'batch_delete_',
  'add_', 'send_', 'upload_', 'manage_columns',
];

/**
 * gateMcp(toolName, allowedTools)
 *
 * @param {string}   toolName      the MCP tool the test wants to invoke
 * @param {string[]} allowedTools  per-test allowlist (from runner_config.tools)
 * @returns {{ok:true}|{ok:false, reason:string}}
 */
function gateMcp(toolName, allowedTools) {
  if (typeof toolName !== 'string' || toolName.trim() === '') {
    return { ok: false, reason: 'empty tool name' };
  }
  const name = toolName.trim();

  // Normalise any `mcp__godcrm__foo` prefix the agent may include verbatim.
  const bareName = name.replace(/^mcp__[^_]+__/, '');

  // 1. Hardcoded denylist — write-capable tools refused always.
  for (const sub of MCP_DENY_SUBSTRINGS) {
    if (bareName.startsWith(sub) || bareName.includes(sub)) {
      return { ok: false, reason: `mcp-write-denied:${sub}` };
    }
  }

  // 2. Per-test allowlist.
  if (!Array.isArray(allowedTools) || allowedTools.length === 0) {
    return { ok: false, reason: 'no mcp tools configured for this test' };
  }
  const match = allowedTools.some((t) => {
    if (typeof t !== 'string' || t === '') return false;
    const bareT = t.replace(/^mcp__[^_]+__/, '');
    return bareT === bareName || t === name;
  });
  if (!match) return { ok: false, reason: `mcp tool not in allowlist: ${bareName}` };

  return { ok: true };
}

// ---------------------------------------------------------------------------

export {
  gateBash,
  gateSql,
  gateMcp,
  // Exported for tests / audit.
  BASH_DENY_PATTERNS,
  MCP_DENY_SUBSTRINGS,
  CURL_SAFE_ALLOW_PATTERN,
};

export default { gateBash, gateSql, gateMcp, BASH_DENY_PATTERNS, MCP_DENY_SUBSTRINGS, CURL_SAFE_ALLOW_PATTERN };
