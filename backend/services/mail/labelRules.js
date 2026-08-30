/**
 * ADR-173 §B.2/B.3 — mail label rule evaluator.
 *
 * A label may carry a `rules` JSONB spec that auto-applies it to messages on
 * inbound sync (and on the opt-in backfill `/apply`). This module is the ONE
 * place that decides "does this message match this label's rules?" — pure,
 * side-effect free, and unit-tested, so the route code just wires it to the DB.
 *
 * Rule shape (mail_labels.rules):
 *   {
 *     "match": "any" | "all",              // OR (default) vs AND across conditions
 *     "conditions": [
 *       { "field": "from"|"to"|"subject"|"body"|"any",
 *         "op":    "contains"|"in_list"|"equals"|"regex",
 *         "value": string | string[] },
 *       // ADR-158 §P4 — live value list pulled from a CRM table at match time:
 *       { "field": "body"|"subject"|"any"|…,
 *         "op":    "in_table",
 *         "source": { "tableId": number, "column": string,
 *                     "filter"?: { "column": string, "op": "equals"|"contains", "value": string } } }
 *     ]
 *   }
 *
 * `in_table` is spec-only: the route resolves `SELECT DISTINCT <column>` (scoped
 * to the message's OWN space, optional sub-filter) into a concrete `in_list`
 * before evaluation — this module stays pure/sync. See resolveTableRefs below.
 *
 * Empty/absent conditions ⇒ never auto-applies (manual-only label).
 *
 * `regex` is UNTRUSTED input (owner-authored, but still a DoS vector). Node's
 * RegExp has no execution timeout, so we defend by construction (Ponytail: no
 * new dep like re2 — bound the work instead):
 *   - pattern length capped (REGEX_MAX_PATTERN)
 *   - obvious nested-quantifier ReDoS shapes rejected (looksCatastrophic)
 *   - the tested input is truncated hard for regex (REGEX_MAX_INPUT)
 *   - a throwing/invalid pattern is treated as "no match", never a 500
 */

const FIELDS = new Set(['from', 'to', 'subject', 'body', 'any']);
// Ops the PURE evaluator handles. `in_table` is deliberately NOT here: it is a
// spec-only op that the route pre-resolves into `in_list` (its live values come
// from a DB query) BEFORE this module ever evaluates it. So a raw, unresolved
// `in_table` condition falls through evalCondition's guard → no match, never a
// throw — exactly the "saved but inert until backend resolves it" behavior.
const OPS = new Set(['contains', 'in_list', 'equals', 'regex']);
// Ops that may be PERSISTED on a label (validated by normalizeRules). Superset
// of OPS by `in_table` (ADR-158 §P4 — "информация из таблицы").
const SPEC_OPS = new Set([...OPS, 'in_table']);
// Operators allowed on an in_table sub-filter (`WHERE <col> = / ILIKE <val>`).
const FILTER_OPS = new Set(['equals', 'contains']);

const REGEX_MAX_PATTERN = 200; // chars — reject anything longer outright
const REGEX_MAX_INPUT = 10_000; // chars — cap the haystack a bad regex can chew

/**
 * Normalize a message (either the imapFetch shape or a mail_messages DB row)
 * into the lowercased field strings the operators test against.
 * @returns {{from:string,to:string,subject:string,body:string,any:string}}
 */
export function buildMatchFields(msg = {}) {
  const from = [msg.from_address, msg.from_name].filter(Boolean).join(' ');
  const toRaw = msg.to_addresses;
  const to = Array.isArray(toRaw)
    ? toRaw.join(' ')
    : typeof toRaw === 'string'
      ? toRaw
      : '';
  const subject = msg.subject || '';
  const body = msg.body_text || msg.body_html || msg.preview || '';
  const fields = {
    from: from.toLowerCase(),
    to: to.toLowerCase(),
    subject: subject.toLowerCase(),
    body: body.toLowerCase(),
  };
  fields.any = `${fields.from} ${fields.to} ${fields.subject} ${fields.body}`;
  return fields;
}

// Very cheap ReDoS heuristic: a quantifier applied to a group/class that itself
// contains a quantifier — e.g. (a+)+, (a*)*, [a-z]+*. Not exhaustive, but kills
// the textbook catastrophic-backtracking shapes without a parser.
function looksCatastrophic(pattern) {
  return /(\([^)]*[+*][^)]*\)\s*[+*])|(\[[^\]]*\]\s*[+*]\s*[+*])/.test(pattern);
}

function safeRegexTest(pattern, haystack) {
  if (typeof pattern !== 'string' || pattern.length === 0) return false;
  if (pattern.length > REGEX_MAX_PATTERN) return false;
  if (looksCatastrophic(pattern)) return false;
  let re;
  try {
    re = new RegExp(pattern, 'i');
  } catch {
    return false; // invalid pattern → no match, never throw
  }
  try {
    return re.test(haystack.slice(0, REGEX_MAX_INPUT));
  } catch {
    return false;
  }
}

// An `in_list` value beginning with '@' matches the whole domain; otherwise it's
// a plain case-insensitive substring match (an address or fragment).
function matchInList(haystack, values) {
  const list = (Array.isArray(values) ? values : [values])
    .map((v) => String(v).trim().toLowerCase())
    .filter(Boolean);
  return list.some((v) => haystack.includes(v));
}

function evalCondition(cond, fields) {
  if (!cond || !FIELDS.has(cond.field) || !OPS.has(cond.op)) return false;
  const haystack = fields[cond.field] ?? '';
  const value = cond.value;

  switch (cond.op) {
    case 'contains':
      return typeof value === 'string' && value.length > 0
        ? haystack.includes(value.toLowerCase())
        : false;
    case 'equals':
      return typeof value === 'string'
        ? haystack.trim() === value.trim().toLowerCase()
        : false;
    case 'in_list':
      return matchInList(haystack, value);
    case 'regex':
      return safeRegexTest(value, haystack);
    default:
      return false;
  }
}

/**
 * Does a message match a label's rule spec?
 * @param {object} rules   mail_labels.rules JSONB (may be {} / null)
 * @param {object} msg     message (imapFetch shape or DB row)
 * @returns {boolean}
 */
export function matchesRules(rules, msg) {
  if (!rules || typeof rules !== 'object') return false;
  const conditions = Array.isArray(rules.conditions) ? rules.conditions : [];
  if (conditions.length === 0) return false; // manual-only

  const fields = buildMatchFields(msg);
  const results = conditions.map((c) => evalCondition(c, fields));
  return rules.match === 'all' ? results.every(Boolean) : results.some(Boolean);
}

/**
 * Given the space's labels and one message, return the ids of labels whose
 * rules match. Labels with empty/no conditions never match (manual-only).
 * @param {Array<{id:number, rules:object, enabled?:boolean}>} labels
 * @param {object} msg
 * @returns {number[]} matching label ids
 */
export function matchingLabelIds(labels, msg) {
  const out = [];
  for (const label of labels || []) {
    if (label.enabled === false) continue;
    const rules =
      typeof label.rules === 'string' ? safeParse(label.rules) : label.rules;
    if (matchesRules(rules, msg)) out.push(label.id);
  }
  return out;
}

function safeParse(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

// ─── in_table pre-resolution (ADR-158 §P4) ─────────────────────────────
//
// The evaluator above is pure and sync. An `in_table` condition needs a live
// list of values from a CRM table, which is a DB read — so the ROUTE resolves
// it first (space-scoped, cached per batch) and hands us back a value map. These
// three helpers are the pure glue: extract the refs to resolve, key them for
// dedupe, and rewrite `in_table` → `in_list` once the values are in hand. No DB,
// no async here — that stays in the route (mail.js), keeping this module the one
// pure decision point it advertises.

/** Canonical dedupe key for a table ref, so a batch runs each query once. */
export function tableRefKey(source) {
  const f = source && source.filter;
  return f
    ? `${source.tableId}::${source.column}::${f.column}::${f.op}::${f.value}`
    : `${source && source.tableId}::${source && source.column}`;
}

/**
 * Walk a set of labels and return the unique `in_table` sources to resolve.
 * @param {Array<{rules:object|string}>} labels
 * @returns {Array<{key:string, source:{tableId:number,column:string,filter?:object}}>}
 */
export function collectTableRefs(labels) {
  const byKey = new Map();
  for (const label of labels || []) {
    const rules =
      typeof label?.rules === 'string' ? safeParse(label.rules) : label?.rules;
    const conds = rules && Array.isArray(rules.conditions) ? rules.conditions : [];
    for (const c of conds) {
      if (c && c.op === 'in_table' && c.source) {
        const key = tableRefKey(c.source);
        if (!byKey.has(key)) byKey.set(key, c.source);
      }
    }
  }
  return [...byKey.entries()].map(([key, source]) => ({ key, source }));
}

/**
 * Rewrite every `in_table` condition into a concrete `in_list` using a resolved
 * value map. A missing/empty entry becomes an empty `in_list` → never matches
 * (fail-closed). Pure: returns a NEW rules object, leaves the input untouched.
 * @param {object} rules
 * @param {Map<string,string[]>} valuesByKey
 */
export function resolveTableRefs(rules, valuesByKey) {
  if (!rules || typeof rules !== 'object') return rules;
  const conds = Array.isArray(rules.conditions) ? rules.conditions : [];
  if (!conds.some((c) => c && c.op === 'in_table')) return rules; // nothing to do
  const conditions = conds.map((c) => {
    if (c && c.op === 'in_table' && c.source) {
      const value = valuesByKey.get(tableRefKey(c.source)) || [];
      return { field: c.field, op: 'in_list', value };
    }
    return c;
  });
  return { ...rules, conditions };
}

/** Convenience: resolve a whole list of rule-labels (parses string rules too). */
export function resolveLabels(labels, valuesByKey) {
  return (labels || []).map((label) => {
    const rules =
      typeof label.rules === 'string' ? safeParse(label.rules) : label.rules;
    return { ...label, rules: resolveTableRefs(rules, valuesByKey) };
  });
}

export const __testables = { buildMatchFields, looksCatastrophic, safeRegexTest, evalCondition };

// ─── input validation (API boundary — B.4 label CRUD) ───────────────
//
// `matchesRules` above is deliberately tolerant (malformed → non-match, never
// throws) because it runs on the hot inbound-sync path. The CRUD layer is the
// opposite: reject a bad `rules` payload with a 400 up front, so a user can't
// save a label whose rule silently never fires. This is that boundary check —
// it reuses the same FIELDS/OPS/regex guards, so the evaluator and the
// validator can never disagree about what a legal rule is.

/** Distinguishable so the route maps a bad `rules` payload to 400, not 500. */
export class RuleError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RuleError';
    this.status = 400;
  }
}

/**
 * Validate + normalize a `rules` object from create/patch. Returns a clean
 * object safe to persist as JSONB. `null`/`undefined`/`{}` normalize to a
 * manual-only label (`{ match:'any', conditions:[] }`).
 * @param {*} rules
 * @returns {{ match:'any'|'all', conditions:Array<{field:string,op:string,value:string|string[]}> }}
 * @throws {RuleError}
 */
const MAX_CONDITIONS = 50; // a label with more rows than this is almost surely a mistake

/**
 * Validate + normalize an `in_table` condition's `source`. Rejects a bad shape
 * with 400 (RuleError) so a label can't be saved with an unresolvable ref.
 * NOTE: tableId is trusted only as a positive int here; the ROUTE additionally
 * space-scopes the actual query (a label can only pull from its own space's
 * tables), so a cross-space id simply resolves to zero values.
 */
function normalizeTableSource(source, i) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    throw new RuleError(`Condition ${i}: in_table needs a source object`);
  }
  const tableId = Number(source.tableId);
  if (!Number.isInteger(tableId) || tableId <= 0) {
    throw new RuleError(`Condition ${i}: in_table source.tableId must be a positive integer`);
  }
  const column = String(source.column ?? '').trim();
  if (column.length === 0) throw new RuleError(`Condition ${i}: in_table source.column is required`);

  const out = { tableId, column };
  if (source.filter != null) {
    const f = source.filter;
    if (typeof f !== 'object' || Array.isArray(f)) {
      throw new RuleError(`Condition ${i}: in_table source.filter must be an object`);
    }
    const fColumn = String(f.column ?? '').trim();
    if (fColumn.length === 0) throw new RuleError(`Condition ${i}: in_table filter.column is required`);
    if (!FILTER_OPS.has(f.op)) {
      throw new RuleError(`Condition ${i}: in_table filter.op must be one of ${[...FILTER_OPS].join(', ')}`);
    }
    const fValue = String(f.value ?? '');
    if (fValue.length === 0) throw new RuleError(`Condition ${i}: in_table filter.value is required`);
    out.filter = { column: fColumn, op: f.op, value: fValue };
  }
  return out;
}

export function normalizeRules(rules) {
  if (rules == null) return { match: 'any', conditions: [] };
  if (typeof rules !== 'object' || Array.isArray(rules)) {
    throw new RuleError('`rules` must be an object');
  }

  const match = rules.match === 'all' ? 'all' : 'any';
  const raw = rules.conditions;
  if (raw != null && !Array.isArray(raw)) {
    throw new RuleError('`rules.conditions` must be an array');
  }
  const conds = Array.isArray(raw) ? raw : [];
  if (conds.length > MAX_CONDITIONS) {
    throw new RuleError(`Too many conditions (max ${MAX_CONDITIONS})`);
  }

  const conditions = conds.map((c, i) => {
    if (!c || typeof c !== 'object') throw new RuleError(`Condition ${i} must be an object`);
    if (!FIELDS.has(c.field)) {
      throw new RuleError(`Condition ${i}: field must be one of ${[...FIELDS].join(', ')}`);
    }
    if (!SPEC_OPS.has(c.op)) {
      throw new RuleError(`Condition ${i}: op must be one of ${[...SPEC_OPS].join(', ')}`);
    }

    if (c.op === 'in_table') {
      return { field: c.field, op: 'in_table', source: normalizeTableSource(c.source, i) };
    }

    if (c.op === 'in_list') {
      const arr = (Array.isArray(c.value) ? c.value : [c.value])
        .map((v) => String(v ?? '').trim())
        .filter(Boolean);
      if (arr.length === 0) throw new RuleError(`Condition ${i}: in_list needs at least one value`);
      return { field: c.field, op: c.op, value: arr };
    }

    const value = String(c.value ?? '');
    if (value.length === 0) throw new RuleError(`Condition ${i}: value is required`);
    if (c.op === 'regex') {
      if (value.length > REGEX_MAX_PATTERN) {
        throw new RuleError(`Condition ${i}: regex too long (max ${REGEX_MAX_PATTERN})`);
      }
      if (looksCatastrophic(value)) {
        throw new RuleError(`Condition ${i}: regex looks catastrophic (nested quantifier)`);
      }
      try {
        new RegExp(value, 'i');
      } catch {
        throw new RuleError(`Condition ${i}: invalid regex`);
      }
    }
    return { field: c.field, op: c.op, value };
  });

  return { match, conditions };
}
