// ADR-0031 Phase 1 — Row-Mutation Event Log
//
// Diffs old vs new row data on UPDATE, looks up rules in _chat_mutation_log_config,
// renders Liquid-lite templates, and posts `system` messages of content_type
// `row_mutation` into the row's attached chat (lazy-creating the conversation
// on first emit).
//
// Public API:
//   emitRowMutationEvents({ tableId, rowId, oldData, newData, actor, ctx })
//   invalidateMutationConfigCache()
//
// Feature flag:
//   ROW_MUTATION_LOG_ENABLED_SPACES — comma-separated space IDs. Empty = off
//   for all spaces. P3 flips this on for space 11 (Development).
//
// Suppression:
//   ctx.suppress_mutation_log === true → no events emitted (Q4 — agent run mode).
//
// Universal short-circuits applied BEFORE config lookup:
//   - old deep-equals new (no real change)
//   - column_key in {updated_at, created_at} (defence-in-depth)
//
// Rendering: Liquid-lite supports {{path}}, {{path | default: x}}, and
// {% if cond %}…{% elsif cond %}…{% else %}…{% endif %} with `==` equality
// against quoted string literals — enough for the 20 P0 seed rules. Anything
// more exotic should fall back to a richer engine in a follow-up.

import { dbAll, dbGet, dbRun, sqlNow, safeJsonParse } from '../database/connection.js';
import { apiLogger } from '../utils/logger.js';

const ALWAYS_EXCLUDED_COLUMNS = new Set(['updated_at', 'created_at']);
const CONFIG_TTL_MS = 5 * 60 * 1000; // 5 min — matches automations hot-reload cadence

let configCache = { byTableCol: null, fetchedAt: 0 };
let spaceTableCache = new Map(); // table_id → space_id (long-lived; tables rarely move spaces)
let columnConfigCache = new Map(); // `${tableId}::${columnName}` → table_columns row

function getEnabledSpaces() {
  const raw = process.env.ROW_MUTATION_LOG_ENABLED_SPACES || '';
  return new Set(
    raw
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
      .map(s => Number(s))
      .filter(n => Number.isFinite(n))
  );
}

async function loadConfig() {
  const rows = await dbAll(
    `SELECT id, table_id, column_key, template, event_type, enabled
       FROM _chat_mutation_log_config
      WHERE enabled = true`
  );
  const byTableCol = new Map();
  for (const r of rows) byTableCol.set(`${r.table_id}::${r.column_key}`, r);
  return byTableCol;
}

async function getConfig() {
  const now = Date.now();
  if (configCache.byTableCol && now - configCache.fetchedAt < CONFIG_TTL_MS) {
    return configCache.byTableCol;
  }
  try {
    const byTableCol = await loadConfig();
    configCache = { byTableCol, fetchedAt: now };
    return byTableCol;
  } catch (err) {
    apiLogger.warn({ err: err.message }, 'tableMutationService: config load failed');
    return new Map();
  }
}

export function invalidateMutationConfigCache() {
  configCache = { byTableCol: null, fetchedAt: 0 };
  spaceTableCache.clear();
  columnConfigCache.clear();
}

async function getTableSpaceId(tableId) {
  const tid = Number(tableId);
  if (spaceTableCache.has(tid)) return spaceTableCache.get(tid);
  const row = await dbGet(
    `SELECT p.space_id FROM universal_tables t
       LEFT JOIN projects p ON p.id = t.project_id
      WHERE t.id = ?`,
    [tid]
  );
  const spaceId = row && row.space_id != null ? Number(row.space_id) : null;
  spaceTableCache.set(tid, spaceId);
  return spaceId;
}

async function getColumnConfig(tableId, columnName) {
  const key = `${tableId}::${columnName}`;
  if (columnConfigCache.has(key)) return columnConfigCache.get(key);
  const row = await dbGet(
    `SELECT id, type, config FROM table_columns
      WHERE table_id = ? AND column_name = ?
      LIMIT 1`,
    [Number(tableId), columnName]
  );
  columnConfigCache.set(key, row || null);
  return row || null;
}

function deepEqual(a, b) {
  if (a === b) return true;
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  if (typeof a !== typeof b) return false;
  if (typeof a !== 'object') return false;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

async function resolveDisplay(tableId, columnName, value) {
  if (value == null || value === '') return value;
  const col = await getColumnConfig(tableId, columnName);
  if (!col || col.type !== 'select') return value;
  const cfg = safeJsonParse(col.config) || {};
  const rel = cfg.relation;
  if (!rel || !rel.enabled || !rel.tableId) return value;
  const labelCol = rel.labelColumn || cfg.displayColumn || 'name';
  try {
    const target = await dbGet(
      `SELECT data FROM table_rows WHERE id = ? AND table_id = ? LIMIT 1`,
      [Number(value), Number(rel.tableId)]
    );
    if (!target) return value;
    const data = safeJsonParse(target.data) || {};
    return data[labelCol] != null ? data[labelCol] : value;
  } catch {
    return value;
  }
}

function lookupPath(obj, path) {
  if (obj == null) return undefined;
  const parts = String(path).split('.');
  let cur = obj;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}

function evalIfCond(condRaw, ctx) {
  // Supports `<path> == 'literal'` only — enough for the seed.
  // Anything else returns falsy so {% else %} branch is taken.
  const m = condRaw.match(/^\s*([\w.]+)\s*==\s*['"]([^'"]*)['"]\s*$/);
  if (m) {
    const lhs = lookupPath(ctx, m[1]);
    return String(lhs ?? '') === m[2];
  }
  // Bare truthiness: `<path>` → truthy
  const bare = condRaw.match(/^\s*([\w.]+)\s*$/);
  if (bare) {
    const v = lookupPath(ctx, bare[1]);
    return Boolean(v);
  }
  return false;
}

function renderConditionals(tpl, ctx) {
  // Single-pass {% if %}…{% elsif %}…{% else %}…{% endif %} resolver.
  const re = /\{%\s*if\s+([\s\S]+?)\s*%\}([\s\S]*?)\{%\s*endif\s*%\}/g;
  return tpl.replace(re, (_full, firstCond, body) => {
    const branches = [];
    let cur = { cond: firstCond, body: '' };
    const parts = body.split(/(\{%\s*(?:elsif|else)\s*[\s\S]*?%\})/g);
    let buf = '';
    let pendingCond = firstCond;
    for (const seg of parts) {
      const elsifM = seg.match(/^\{%\s*elsif\s+([\s\S]+?)\s*%\}$/);
      const elseM = seg.match(/^\{%\s*else\s*%\}$/);
      if (elsifM) {
        branches.push({ cond: pendingCond, body: buf });
        pendingCond = elsifM[1];
        buf = '';
      } else if (elseM) {
        branches.push({ cond: pendingCond, body: buf });
        pendingCond = '__else__';
        buf = '';
      } else {
        buf += seg;
      }
    }
    branches.push({ cond: pendingCond, body: buf });
    for (const b of branches) {
      if (b.cond === '__else__') return b.body;
      if (evalIfCond(b.cond, ctx)) return b.body;
    }
    return '';
  });
}

function applyFilter(value, filter) {
  // Supports `default: <literal>` only.
  const m = filter.match(/^\s*default:\s*(.+)\s*$/);
  if (!m) return value;
  if (value != null && value !== '') return value;
  let lit = m[1].trim();
  if (/^['"].*['"]$/.test(lit)) return lit.slice(1, -1);
  if (/^-?\d+(\.\d+)?$/.test(lit)) return Number(lit);
  return lit;
}

function renderInterpolations(tpl, ctx) {
  return tpl.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_full, expr) => {
    const [pathRaw, ...filters] = expr.split('|').map(s => s.trim());
    let val = lookupPath(ctx, pathRaw);
    for (const f of filters) val = applyFilter(val, f);
    if (val == null) return '';
    if (typeof val === 'object') {
      try { return JSON.stringify(val); } catch { return String(val); }
    }
    return String(val);
  });
}

function renderTemplate(tpl, ctx) {
  try {
    const afterCond = renderConditionals(tpl, ctx);
    return renderInterpolations(afterCond, ctx);
  } catch (err) {
    apiLogger.warn({ err: err.message }, 'tableMutationService: template render failed');
    return tpl;
  }
}

function buildRowRef(tableId, rowId, data) {
  if (!data || typeof data !== 'object') return null;
  const title = data.what || data.name || data.title || `Row #${rowId}`;
  const icon = data.emoji || data.icon || null;
  return {
    table_id: Number(tableId),
    row_id: Number(rowId),
    title: String(title),
    icon,
  };
}

async function ensureParticipant(conversationId, userId) {
  if (!conversationId || !userId) return;
  try {
    await dbRun(
      `INSERT INTO conversation_participants (conversation_id, user_id, role)
       VALUES (?, ?, 'member')
       ON CONFLICT (conversation_id, user_id) DO NOTHING`,
      [Number(conversationId), Number(userId)]
    );
  } catch (err) {
    apiLogger.warn(
      { err: err.message, conversationId, userId },
      'tableMutationService: ensureParticipant failed'
    );
  }
}

function buildRowTitle(tableId, data) {
  if (!data || typeof data !== 'object') return null;
  if (Number(tableId) === 7256 && data.title) return `Criterion: ${data.title}`;
  return data.what || data.name || data.title || null;
}

async function getOrCreateConversationForRow(tableId, rowId, actorId, opts = {}) {
  const existing = await dbGet(
    `SELECT id FROM conversations
      WHERE bound_table_id = ? AND bound_row_id = ?
      ORDER BY updated_at DESC LIMIT 1`,
    [Number(tableId), Number(rowId)]
  );
  if (existing) {
    if (actorId != null) await ensureParticipant(existing.id, actorId);
    return existing;
  }
  const title = opts.title || null;
  const spaceId = opts.spaceId != null ? Number(opts.spaceId) : null;
  const result = await dbRun(
    `INSERT INTO conversations
       (type, title, space_id, bound_table_id, bound_row_id, created_by, created_at, updated_at)
     VALUES ('row', ?, ?, ?, ?, ?, ${sqlNow()}, ${sqlNow()})`,
    [title, spaceId, Number(tableId), Number(rowId), actorId || null]
  );
  const insertedId = result?.lastInsertRowid || result?.rows?.[0]?.id || null;
  if (!insertedId) return null;
  if (actorId != null) await ensureParticipant(insertedId, actorId);
  return { id: insertedId };
}

/**
 * Public helper for the ensure-chat endpoint (frontend Discuss button).
 * Returns the conversation row for (tableId, rowId), creating it lazily with
 * a meaningful title + space_id + caller as participant. Idempotent.
 */
export async function ensureRowChat({ tableId, rowId, actorId, titleHint = null }) {
  const spaceId = await getTableSpaceId(tableId);
  let title = titleHint;
  if (!title) {
    const row = await dbGet(
      `SELECT data FROM table_rows WHERE id = ? AND table_id = ?`,
      [Number(rowId), Number(tableId)]
    );
    const data = row ? safeJsonParse(row.data) || {} : {};
    title = buildRowTitle(tableId, data);
  }
  return await getOrCreateConversationForRow(tableId, rowId, actorId, { title, spaceId });
}

/**
 * Diff old vs new, look up matching rules, render templates, and post one
 * `system` message per changed configured column into the row's attached chat.
 *
 * Always best-effort: any failure is logged and swallowed. Caller MUST still
 * complete the underlying UPDATE — this is a post-commit hook.
 */
export async function emitRowMutationEvents({ tableId, rowId, oldData, newData, actor, ctx = {} }) {
  try {
    if (ctx && ctx.suppress_mutation_log === true) return;

    const enabledSpaces = getEnabledSpaces();
    if (enabledSpaces.size === 0) return; // global kill-switch — flag OFF

    const spaceId = await getTableSpaceId(tableId);
    if (spaceId == null || !enabledSpaces.has(spaceId)) return;

    const config = await getConfig();
    if (!config.size) return;

    const allKeys = new Set([
      ...Object.keys(oldData || {}),
      ...Object.keys(newData || {}),
    ]);

    const events = [];
    for (const key of allKeys) {
      if (ALWAYS_EXCLUDED_COLUMNS.has(key)) continue;
      const oldVal = oldData ? oldData[key] : undefined;
      const newVal = newData ? newData[key] : undefined;
      if (deepEqual(oldVal, newVal)) continue;
      const rule = config.get(`${Number(tableId)}::${key}`);
      if (!rule) continue;
      events.push({ rule, oldVal, newVal, columnKey: key });
    }
    if (!events.length) return;

    const titleHint = buildRowTitle(tableId, newData) || buildRowTitle(tableId, oldData);
    const conversation = await getOrCreateConversationForRow(tableId, rowId, actor?.id, {
      title: titleHint,
      spaceId,
    });
    if (!conversation || !conversation.id) {
      apiLogger.warn({ tableId, rowId }, 'tableMutationService: could not resolve conversation');
      return;
    }

    const actorObj = {
      id: actor?.id ?? null,
      name: actor?.name || actor?.username || 'system',
    };
    const rowRef = buildRowRef(tableId, rowId, newData);

    for (const ev of events) {
      const displayOld = await resolveDisplay(tableId, ev.columnKey, ev.oldVal);
      const displayNew = await resolveDisplay(tableId, ev.columnKey, ev.newVal);

      const renderCtx = {
        old: oldData || {},
        new: newData || {},
        actor: actorObj,
        row: { id: Number(rowId), title: rowRef?.title || `Row #${rowId}` },
        ts: new Date().toISOString(),
        display: { old: displayOld, new: displayNew },
      };
      const content = renderTemplate(ev.rule.template, renderCtx);

      const metadata = {
        event_type: ev.rule.event_type,
        table_id: Number(tableId),
        row_id: Number(rowId),
        column_key: ev.columnKey,
        old: ev.oldVal,
        new: ev.newVal,
        actor: actorObj,
        rule_id: ev.rule.id,
        row_ref: rowRef,
      };

      await dbRun(
        `INSERT INTO messages
           (conversation_id, sender_id, sender_type, role, content, content_type,
            metadata, bound_table_id, bound_row_id, created_at, updated_at)
         VALUES (?, ?, 'system', 'system', ?, 'row_mutation', ?, ?, ?, ${sqlNow()}, ${sqlNow()})`,
        [
          conversation.id,
          actorObj.id,
          content,
          JSON.stringify(metadata),
          Number(tableId),
          Number(rowId),
        ]
      );
    }
  } catch (err) {
    apiLogger.warn({ err: err.message, tableId, rowId }, 'tableMutationService: emit failed');
  }
}
