/**
 * Memory Tool Handlers — Hindsight integration
 *
 * Handles: memory_retain, memory_recall, memory_reflect, memory_bridge
 * Proxies to Hindsight API at localhost:5100
 */

import { aiLogger } from '../../utils/logger.js';
import { routeMemoryScope, ROUTE_CONFIDENCE_FLOOR } from '../dcd/scopeRouter.js';

// Origin is env-overridable so the same code works bare-metal (default
// localhost:5100) and in containers/compose (e.g. HINDSIGHT_URL=http://hindsight:5100).
const HINDSIGHT_ORIGIN = (process.env.HINDSIGHT_URL || 'http://127.0.0.1:5100').replace(/\/+$/, '');
const HINDSIGHT_BASE = `${HINDSIGHT_ORIGIN}/v1/default/banks`;
const DEFAULT_BANK = 'godcrm-main';

/**
 * Make a request to Hindsight API
 */
async function hindsightRequest(method, path, body = null) {
  const url = `${HINDSIGHT_BASE}${path}`;
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(url, opts);

  // Body may not be JSON (e.g. a 500/502 HTML page from the docker proxy or a
  // crashed worker). Parse defensively so a non-JSON error body doesn't surface
  // as an opaque SyntaxError.
  const raw = await res.text();
  let data;
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    data = { detail: raw };
  }

  if (!res.ok) {
    throw new Error(`Hindsight API ${res.status}: ${formatHindsightDetail(data, res.status)}`);
  }
  return data;
}

/**
 * Turn a Hindsight/FastAPI error body into a human-readable string.
 * FastAPI returns 422 validation errors as `detail: [{loc, msg, type}, ...]`,
 * which naively stringify to "[object Object]" — the bug this guards against.
 */
function formatHindsightDetail(data, status) {
  const detail = data?.detail;
  if (typeof detail === 'string' && detail) return detail;
  if (Array.isArray(detail)) {
    return detail
      .map((e) => {
        const loc = Array.isArray(e?.loc) ? e.loc.join('.') : '';
        const msg = e?.msg || e?.type || JSON.stringify(e);
        return loc ? `${loc}: ${msg}` : msg;
      })
      .join('; ');
  }
  if (detail && typeof detail === 'object') return JSON.stringify(detail);
  if (typeof data?.error === 'string' && data.error) return data.error;
  return `request failed (HTTP ${status})`;
}

export const memoryToolHandlers = {
  /**
   * Save facts/observations to long-term memory.
   */
  async memory_retain({ text, content, bank_id, context: ctx, document_id, tags, room, hall, layer }, userId, context = {}) {
    const bankId = bank_id || DEFAULT_BANK;

    // The memorized string. Hindsight's own field is `content`, so agents
    // routinely pass it under that name instead of the tool's `text` — that
    // mismatch shipped an empty item and 422'd as `body.items.0.content:
    // Field required`. Accept either, and fail fast locally on empty so we
    // never round-trip an empty item to the API.
    const memorized = (text ?? content ?? '').toString().trim();
    if (!memorized) {
      throw new Error('memory_retain: `text` is required and must be a non-empty string (the fact/observation to memorize).');
    }

    const item = { content: memorized };
    if (ctx) item.context = ctx;
    if (document_id) item.document_id = document_id;
    if (tags && Array.isArray(tags)) item.tags = tags;
    if (room) item.room = room;
    if (hall) item.hall = hall;
    if (layer) item.layer = layer;

    aiLogger.info({ bankId, textLen: memorized.length, room, hall, layer, agent: context.agentName }, 'memory_retain');

    const result = await hindsightRequest('POST', `/${bankId}/memories`, {
      items: [item],
    });

    const storedIds = (result.items || []).map(i => i.id || i.uuid).filter(Boolean);

    return {
      success: true,
      bank_id: bankId,
      items_stored: result.items_count || 1,
      ids: storedIds.length ? storedIds : null,
      usage: result.usage || null,
    };
  },

  /**
   * Search long-term memory for relevant facts.
   */
  async memory_recall({ query, bank_id, limit, room, hall, max_layer, auto_scope }, userId, context = {}) {
    const bankId = bank_id || DEFAULT_BANK;

    // ADR-157 DCD scope-router (Collection step). Opt-in via `auto_scope`, and
    // ONLY when the caller did not already scope the call — an explicit `room`
    // is always honoured (skip-router for already-scoped retrieval). A confident
    // route narrows BEFORE the search (+34% precision); a low-confidence route
    // widens to the domain (no room) rather than risk mis-scoping.
    let routedRoom = room;
    let routed = null;
    if (auto_scope && !room && query) {
      routed = routeMemoryScope(query);
      if (routed.confidence >= ROUTE_CONFIDENCE_FLOOR) routedRoom = routed.room;
      aiLogger.info(
        { bankId, query, routed, applied: routedRoom || null, agent: context.agentName },
        'memory_recall scope-router'
      );
    }

    const recall = async (roomArg) => {
      aiLogger.info({ bankId, query, room: roomArg, hall, max_layer, agent: context.agentName }, 'memory_recall');
      const body = { query, limit: limit || 10 };
      if (roomArg) body.room = Array.isArray(roomArg) ? roomArg : [roomArg];
      if (hall) body.hall = Array.isArray(hall) ? hall : [hall];
      if (max_layer) body.max_layer = max_layer;

      const result = await hindsightRequest('POST', `/${bankId}/memories/recall`, body);
      return (result.results || []).map(r => ({
        id: r.id || r.uuid || null,
        text: r.text,
        type: r.type,
        entities: r.entities,
        occurred: r.occurred_start || null,
        room: r.room || null,
        hall: r.hall || null,
      }));
    };

    let memories = await recall(routedRoom);

    // Widen-by-one-level fallback (ADR-157): a routed room that returns nothing
    // drops the Collection predicate and retries at the domain level, so the
    // router can never bury results that an unscoped search would have found.
    if (routed && routedRoom && memories.length === 0) {
      aiLogger.info({ bankId, room: routedRoom, agent: context.agentName }, 'memory_recall widen: routed room empty → drop room');
      memories = await recall(undefined);
    }

    return {
      success: true,
      bank_id: bankId,
      count: memories.length,
      memories,
    };
  },

  /**
   * Create a cross-bank memory bridge (tunnel) between two related memories.
   */
  async memory_bridge({ source_bank, source_memory, target_bank, target_memory, relation, confidence }, userId, context = {}) {
    aiLogger.info({ source_bank, target_bank, relation, agent: context.agentName }, 'memory_bridge');

    const body = {
      source_bank,
      source_memory,
      target_bank,
      target_memory,
      relation,
    };
    if (confidence !== undefined) body.confidence = confidence;
    if (context.agentName) body.created_by = context.agentName;

    const result = await hindsightRequest('POST', `/${source_bank}/tunnels`, body);

    return {
      success: true,
      tunnel: result.tunnel,
    };
  },

  /**
   * Deep reasoning over memory — synthesize patterns and insights.
   */
  async memory_reflect({ query, bank_id }, userId, context = {}) {
    const bankId = bank_id || DEFAULT_BANK;

    aiLogger.info({ bankId, query, agent: context.agentName }, 'memory_reflect');

    const result = await hindsightRequest('POST', `/${bankId}/reflect`, {
      query,
    });

    return {
      success: true,
      bank_id: bankId,
      answer: result.answer || result.response || result.text || JSON.stringify(result),
      citations: result.based_on || result.citations || [],
    };
  },

  /**
   * Create compressed memory summaries (closets) from stored facts.
   */
  async memory_compress({ bank_id, room, hall, min_sources, query }, userId, context = {}) {
    const bankId = bank_id || DEFAULT_BANK;
    aiLogger.info({ bankId, room, hall, min_sources, agent: context.agentName }, 'memory_compress');

    const body = {};
    if (room) body.room = room;
    if (hall) body.hall = hall;
    if (min_sources) body.min_sources = min_sources;
    if (query) body.query = query;

    const result = await hindsightRequest('POST', `/${bankId}/closets`, body);

    return {
      success: true,
      bank_id: bankId,
      closets_created: result.closets_created || 0,
      closets: result.closets || [],
    };
  },
};
