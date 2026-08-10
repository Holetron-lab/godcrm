/**
 * agent-loop/messages.js — Message persistence and text helpers
 *
 * Extracted from AgentLoopService.js (ADR-094).
 *
 * ADR-0031 WP-20+21 (T-141237): saveStepMessage now accepts an optional
 * `attachments` array (parity with the human side, see
 * backend/routes/v3/chat/messageController.js:51) and, for assistant text
 * messages, runs an inline post-processor that extracts `[[row:T/R]]` tokens,
 * resolves them to row_reference attachments, and strips the tokens from text.
 */

import { dbRun, dbAll, isPostgres } from '../../database/connection.js';
import { apiLogger } from '../../utils/logger.js';

// ── Title resolution heuristics ──────────────────────────────────────
// Mirrors src/features/ai-chat/components/RowBindingV2.tsx TITLE_ALIASES (line 254)
// so the chip rendered for an agent-emitted [[row:T/R]] token shows the
// same title the user would see when binding the row from the UI.
const ROW_TITLE_ALIASES = ['title', 'what', 'name', 'subject', 'Название'];

// Token format: [[row:<table_id>/<row_id>]]  e.g. [[row:1708/140322]]
const ROW_REF_TOKEN_RE = /\[\[row:(\d+)\/(\d+)\]\]/g;

function pickRowTitleFromData(data) {
  if (!data || typeof data !== 'object') return null;
  for (const alias of ROW_TITLE_ALIASES) {
    const v = data[alias];
    if (v != null && String(v).trim() !== '') return String(v);
  }
  // Final fallback: first non-empty string-like value in the row data.
  for (const v of Object.values(data)) {
    if (typeof v === 'string' && v.trim() !== '') return v;
  }
  return null;
}

/**
 * ADR-0031 WP-20+21: Process `[[row:<table_id>/<row_id>]]` tokens in agent reply text.
 *
 * - Extracts every match in a SINGLE pass (deduplicated by table/row pair).
 * - Batch-resolves `universal_tables` and `table_rows` in TWO combined SELECTs
 *   (one for tables, one for rows). No N+1.
 * - For each resolved (table, row) pair, emits a row_reference attachment with
 *   the same shape used by the human-side BoundRowsStrip onCreateAndSend path
 *   (see src/features/ai-chat/components/AIChatPanel/components/BoundRowsStrip.tsx:107).
 * - Strips ALL tokens from the text — even unresolvable ones — so dangling
 *   syntax never reaches the renderer.
 * - Logs apiLogger.warn for unresolvable IDs but never throws.
 *
 * @param {string} text - Agent reply text potentially containing [[row:T/R]] tokens
 * @returns {Promise<{ cleanedText: string, attachments: Array<Object> }>}
 */
export async function processRowReferenceTokens(text) {
  if (!text || typeof text !== 'string') {
    return { cleanedText: text || '', attachments: [] };
  }

  // Step 1: Extract all unique (tableId, rowId) pairs in order of first appearance.
  const matches = [];
  const seen = new Set();
  ROW_REF_TOKEN_RE.lastIndex = 0;
  let m;
  while ((m = ROW_REF_TOKEN_RE.exec(text)) !== null) {
    const tableId = Number(m[1]);
    const rowId = Number(m[2]);
    if (!Number.isFinite(tableId) || !Number.isFinite(rowId)) continue;
    const key = `${tableId}/${rowId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    matches.push({ tableId, rowId });
  }

  if (matches.length === 0) {
    return { cleanedText: text, attachments: [] };
  }

  // Step 2: Batch-resolve in single SELECTs.
  // Schema: `universal_tables` holds table metadata (1474 rows), `table_rows`
  // holds row data (102k rows). The 16-row `tables` lookup table is unrelated.
  const uniqTableIds = [...new Set(matches.map(p => p.tableId))];
  const uniqRowIds = [...new Set(matches.map(p => p.rowId))];

  const tableMap = new Map();
  const rowMap = new Map(); // key: `${tableId}/${rowId}` → row data
  try {
    if (isPostgres()) {
      const tables = await dbAll(
        `SELECT id, name, icon FROM universal_tables WHERE id = ANY($1::int[])`,
        [uniqTableIds]
      );
      for (const t of tables) tableMap.set(Number(t.id), t);

      const rows = await dbAll(
        `SELECT id, table_id, data FROM table_rows
         WHERE table_id = ANY($1::int[]) AND id = ANY($2::int[])`,
        [uniqTableIds, uniqRowIds]
      );
      for (const r of rows) {
        const data = typeof r.data === 'string'
          ? (() => { try { return JSON.parse(r.data); } catch { return {}; } })()
          : (r.data || {});
        rowMap.set(`${Number(r.table_id)}/${Number(r.id)}`, { ...r, data });
      }
    } else {
      const tablePh = uniqTableIds.map(() => '?').join(',');
      const tables = await dbAll(
        `SELECT id, name, icon FROM universal_tables WHERE id IN (${tablePh})`,
        uniqTableIds
      );
      for (const t of tables) tableMap.set(Number(t.id), t);

      const rowPh = uniqRowIds.map(() => '?').join(',');
      const rows = await dbAll(
        `SELECT id, table_id, data FROM table_rows
         WHERE table_id IN (${tablePh}) AND id IN (${rowPh})`,
        [...uniqTableIds, ...uniqRowIds]
      );
      for (const r of rows) {
        const data = typeof r.data === 'string'
          ? (() => { try { return JSON.parse(r.data); } catch { return {}; } })()
          : (r.data || {});
        rowMap.set(`${Number(r.table_id)}/${Number(r.id)}`, { ...r, data });
      }
    }
  } catch (err) {
    // DB failure must NEVER block agent reply. Strip tokens, no chips.
    apiLogger.warn(
      { err: err.message, pairCount: matches.length },
      'ADR-0031 WP-20: row-reference batch resolve failed; stripping tokens without chips'
    );
    const cleanedOnError = text
      .replace(ROW_REF_TOKEN_RE, '')
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/[ \t]+\n/g, '\n')
      .trimEnd();
    return { cleanedText: cleanedOnError, attachments: [] };
  }

  // Step 3: Build attachments[] only for resolvable references; warn (do NOT crash) on misses.
  const attachments = [];
  for (const { tableId, rowId } of matches) {
    const table = tableMap.get(tableId);
    const row = rowMap.get(`${tableId}/${rowId}`);
    if (!table || !row) {
      apiLogger.warn(
        { tableId, rowId, tableFound: !!table, rowFound: !!row },
        'ADR-0031 WP-20: unresolvable [[row:T/R]] token — skipping chip (token stripped from text)'
      );
      continue;
    }
    const tableName = table.name || `Table #${tableId}`;
    const rowTitle = pickRowTitleFromData(row.data) || `#${rowId}`;
    attachments.push({
      type: 'row_reference',
      name: rowTitle,
      size: 0,
      rowReference: {
        table_id: tableId,
        row_id: rowId,
        table_name: tableName,
        table_icon: table.icon || undefined,
        row_title: rowTitle,
      },
    });
  }

  // Step 4: Strip every [[row:T/R]] token (resolvable or not) from text.
  // Collapse runs of whitespace left behind to keep the rendered text clean.
  const cleanedText = text
    .replace(ROW_REF_TOKEN_RE, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .trimEnd();

  return { cleanedText, attachments };
}

/**
 * Save an intermediate step message (thinking, tool_call, tool_result, or final text)
 * during agent processing. Persisted to the messages table.
 *
 * ADR-0031 WP-20+21:
 *   - When opts.attachments is provided, it is written to the messages.attachments
 *     JSONB column verbatim (parity with human-side messageController.js:51).
 *   - When contentType==='text' AND content contains `[[row:T/R]]` tokens,
 *     the tokens are extracted into row_reference chips, the tokens are
 *     stripped from the persisted content, and the chips are PREPENDED to
 *     opts.attachments. This is fully backward-compatible: callers that don't
 *     emit tokens and don't pass attachments continue to behave exactly as before.
 *
 * @param {number} conversationId
 * @param {Object} opts
 * @param {Array}  [opts.attachments] - Optional pre-built attachments (ADR-0031 WP-20+21).
 *                                       Caller-supplied items are appended after
 *                                       any auto-extracted row_reference chips.
 * @returns {Promise<number>} lastInsertRowid
 */
export async function saveStepMessage(conversationId, opts) {
  const {
    content = '',
    contentType = 'text',
    role = 'assistant',
    senderType = 'agent',
    agentId = null,
    senderId = null,
    modelUsed = null,
    tokensIn = null,
    tokensOut = null,
    latencyMs = null,
    toolResults = null,
    metadata = null,
    attachments = null,
  } = opts;

  // ── ADR-0031 WP-20: token post-processor ──
  // Only runs for assistant text bodies (not thinking/tool_call/tool_result —
  // those bodies aren't user-facing prose and tokens there would be noise).
  let finalContent = content;
  let finalAttachments = Array.isArray(attachments) ? [...attachments] : [];
  const hasRowToken = contentType === 'text'
    && typeof content === 'string'
    && /\[\[row:\d+\/\d+\]\]/.test(content);
  if (hasRowToken) {
    const t0 = Date.now();
    try {
      const { cleanedText, attachments: rowAttachments } = await processRowReferenceTokens(content);
      finalContent = cleanedText;
      // Auto-resolved chips first; caller-supplied attachments after.
      finalAttachments = [...rowAttachments, ...finalAttachments];
      const dur = Date.now() - t0;
      if (rowAttachments.length > 0) {
        apiLogger.info(
          { conversationId, chipCount: rowAttachments.length, durationMs: dur },
          'ADR-0031 WP-20: row-reference tokens extracted and stripped'
        );
      }
    } catch (err) {
      // Defensive — never block save because of post-processor failure.
      apiLogger.error(
        { err: err.message, conversationId },
        'ADR-0031 WP-20: post-processor crashed — saving original content'
      );
      finalContent = content;
    }
  }

  const toolResultsJson = toolResults ? JSON.stringify(toolResults) : null;
  // Match the human-side default ('[]') so reads stay consistent with the
  // legacy default (knex migration 019 declares `attachments` jsonb DEFAULT '[]').
  const attachmentsJson = finalAttachments.length > 0
    ? JSON.stringify(finalAttachments)
    : '[]';

  const result = await dbRun(
    isPostgres()
      ? `INSERT INTO messages (conversation_id, sender_id, sender_type, role, content, content_type, agent_id, model_used, tokens_in, tokens_out, latency_ms, tool_results, attachments, metadata, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $14, NOW(), NOW())`
      : `INSERT INTO messages (conversation_id, sender_id, sender_type, role, content, content_type, agent_id, model_used, tokens_in, tokens_out, latency_ms, tool_results, attachments, metadata, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
    [conversationId, senderId, senderType, role, finalContent, contentType, agentId, modelUsed, tokensIn, tokensOut, latencyMs, toolResultsJson, attachmentsJson, metadata]
  );

  // Update conversation updated_at
  await dbRun(
    isPostgres()
      ? 'UPDATE conversations SET updated_at = NOW() WHERE id = $1'
      : `UPDATE conversations SET updated_at = datetime('now') WHERE id = ?`,
    [conversationId]
  );

  return result.lastInsertRowid;
}

/**
 * Extract text content from Anthropic content blocks.
 * @param {string|Array} content - Anthropic response content
 * @returns {string}
 */
export function getAnthropicText(content) {
  if (!content) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter(b => b?.type === 'text' && b.text)
      .map(b => b.text)
      .join('\n');
  }
  return '';
}

/**
 * Determine max output tokens for model.
 * @param {string} modelId - Model identifier
 * @param {Object} agentConfig - Agent configuration (may contain max_tokens)
 * @returns {number}
 */
export function getMaxOutputTokens(modelId, agentConfig = {}) {
  if (Number(agentConfig.max_tokens) > 0) return Number(agentConfig.max_tokens);
  if (modelId) {
    const id = modelId.toLowerCase();
    if (id.includes('claude-opus-4')) return 32000;
    if (id.includes('claude-sonnet-4')) return 16000;
    if (id.includes('claude-3-5-sonnet') || id.includes('claude-3.5-sonnet')) return 8192;
    if (id.includes('gpt-4o')) return 16384;
    if (id.includes('gpt-4')) return 8192;
    if (id.includes('o1') || id.includes('o3') || id.includes('o4')) return 100000;
  }
  return 8192;
}

/**
 * Sanitize tool result to prevent circular JSON and limit size.
 * @param {*} result
 * @returns {Object}
 */
export function sanitizeToolResult(result) {
  if (!result) return { success: false, error: 'No result' };
  try {
    const str = JSON.stringify(result);
    if (str.length > 50000) {
      return { ...result, _truncated: true, data: str.substring(0, 50000) + '...' };
    }
    return result;
  } catch {
    return { success: false, error: 'Result not serializable' };
  }
}
