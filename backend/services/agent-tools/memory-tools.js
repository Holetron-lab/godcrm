/**
 * Memory Tool Handlers — Hindsight integration
 *
 * Handles: memory_retain, memory_recall, memory_reflect, memory_bridge
 * Proxies to Hindsight API at localhost:5100
 */

import { aiLogger } from '../../utils/logger.js';
import { routeMemoryScope, ROUTE_CONFIDENCE_FLOOR, ROOMS } from '../dcd/scopeRouter.js';
import { resolveRoom, LIVE_ROOMS } from '../dcd/roomVocabulary.js';

// Origin is env-overridable so the same code works bare-metal (default
// localhost:5100) and in containers/compose (e.g. HINDSIGHT_URL=http://hindsight:5100).
const HINDSIGHT_ORIGIN = (process.env.HINDSIGHT_URL || 'http://127.0.0.1:5100').replace(/\/+$/, '');
const HINDSIGHT_BASE = `${HINDSIGHT_ORIGIN}/v1/default/banks`;
const DEFAULT_BANK = 'godcrm-main';

// ── Author attribution ───────────────────────────────────────────────────
// Every retain records WHO wrote it, on two carriers, because they survive
// different things (verified against the live engine, not assumed):
//
//   • tag `author:<slug>` — carried by BOTH the extracted facts and the
//     observations consolidation later derives from them, and it is the only
//     author field recall can filter on (RecallRequest.tags / tags_match).
//     This is the filter vehicle.
//   • metadata {author, author_kind, author_source} — lands on the extracted
//     facts only; consolidation-derived observations do NOT inherit it. This
//     is the display vehicle, and the reason it is not the filter one.
//
// `room` is deliberately NOT used as the personal room. Room is the topic
// axis: the live store has 17 topical rooms, the DCD scope-router routes
// queries onto them, and closets group by room+hall. Overwriting it with an
// agent slug would collapse topic and identity into one column and break all
// three. Kept apart, both axes filter independently — "sysadmin's memories
// about infrastructure" is a single call.
const AUTHOR_TAG_PREFIX = 'author:';

// ── Room aliasing (ADR-193) ──────────────────────────────────────────────
// The room an agent types is canonicalised into the column, and what they
// actually typed rides along as a tag. Same carrier as the author tag, and for
// the same measured reason: the `room` COLUMN does not survive consolidation
// (4 075 of 8 823 rows are `room IS NULL`, every one of them an observation),
// while tags do — `merged_tags = existing | source`. So the tag is what makes
// room survivable AND enumerable; the column stays the engine's own filter.
//
//   room: "деплой"  →  column room = "deployment"
//                      tag  room:deployment       (durable carrier)
//                      tag  room-alias:деплой     (what was really typed)
//
// A room nobody recognises still stores — losing the fact is worse — but it is
// tagged `room-new:` and warns, so creating a room stops being silent.
const ROOM_TAG_PREFIX = 'room:';
const ROOM_ALIAS_TAG_PREFIX = 'room-alias:';
const ROOM_NEW_TAG_PREFIX = 'room-new:';
const ROOM_TAG_PREFIXES = [ROOM_TAG_PREFIX, ROOM_ALIAS_TAG_PREFIX, ROOM_NEW_TAG_PREFIX];

// Fuzzy resolution (ADR-193 ladder step 5) is off unless explicitly switched
// on: room resolution is irreversible at write time, so the typo distribution
// gets collected via `room-alias:` before a threshold is guessed at.
const ROOM_FUZZY = process.env.MEMORY_ROOM_FUZZY === '1';

/** Resolve one or many room arguments into deduped canonical rooms. */
function resolveRoomList(raw) {
  const arr = Array.isArray(raw) ? raw : [raw];
  return [...new Set(arr.map((r) => resolveRoom(r, { fuzzy: ROOM_FUZZY }).room).filter(Boolean))];
}

/**
 * Normalise any identifier into the same slug shape agent-users.js uses,
 * so `@SysAdmin`, `SysAdmin` and `sysadmin` all attribute to one author.
 */
function normaliseAuthor(raw) {
  if (!raw || typeof raw !== 'string') return '';
  return raw
    .trim()
    .replace(/^[@/]+/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Resolve who is writing/reading, with the trust order made explicit in the
 * stored row rather than left implicit:
 *
 *   1. `context.agentName` — set server-side by the agent loop from the
 *      resolved agent row. Authoritative; an agent cannot forge another's.
 *   2. explicit `author` argument — only consulted when there is NO
 *      server-side identity (MCP/CLI callers, where the process is the
 *      client). Self-declared, and recorded as such.
 *
 * There is deliberately no `userId` fallback. The MCP bridge hardcodes
 * userId=1 for every caller, so deriving an author from it would stamp the
 * human owner's identity onto writes they never made — a false attribution is
 * worse than a missing one. No identity → unattributed, and the write warns.
 *
 * `author_source` is stored alongside the name so a reader can tell a
 * server-derived attribution from a self-declared one without guessing.
 */
function resolveAuthor(explicit, context = {}) {
  const fromContext = normaliseAuthor(context.agentName);
  if (fromContext) return { author: fromContext, source: 'agent-loop', kind: 'agent' };

  const declared = normaliseAuthor(explicit);
  if (declared) return { author: declared, source: 'declared', kind: 'agent' };

  return { author: null, source: 'none', kind: null };
}

/** `author:sysadmin` → `sysadmin`; anything else → null. */
function authorFromTags(tags) {
  if (!Array.isArray(tags)) return null;
  const hit = tags.find((t) => typeof t === 'string' && t.startsWith(AUTHOR_TAG_PREFIX));
  return hit ? hit.slice(AUTHOR_TAG_PREFIX.length) || null : null;
}

/** Normalise a string-or-array author filter into a list of slugs. */
function authorList(raw) {
  const arr = Array.isArray(raw) ? raw : [raw];
  return [...new Set(arr.map(normaliseAuthor).filter(Boolean))];
}

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
  async memory_retain({ text, content, bank_id, context: ctx, document_id, tags, room, hall, layer, author }, userId, context = {}) {
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

    // ADR-193: the typed room is canonicalised before it reaches the column.
    // A room that normalises to nothing (whitespace, punctuation only) is
    // treated as absent rather than stored as an empty room.
    const whereTo = room ? resolveRoom(room, { fuzzy: ROOM_FUZZY }) : null;

    const item = { content: memorized };
    if (ctx) item.context = ctx;
    if (document_id) item.document_id = document_id;
    if (whereTo?.room) item.room = whereTo.room;
    if (hall) item.hall = hall;
    if (layer) item.layer = layer;

    // Caller tags are kept, but any `author:` or `room*:` tag among them is
    // dropped: both are minted here from resolved values, so neither can be
    // forged by hand-writing a tag.
    const callerTags = (Array.isArray(tags) ? tags : [])
      .filter((t) => typeof t === 'string' && t.trim())
      .filter((t) => !t.startsWith(AUTHOR_TAG_PREFIX))
      .filter((t) => !ROOM_TAG_PREFIXES.some((p) => t.startsWith(p)));

    const who = resolveAuthor(author, context);
    const itemTags = [...callerTags];
    if (who.author) {
      itemTags.push(`${AUTHOR_TAG_PREFIX}${who.author}`);
      // MemoryItem.metadata is dict[str, str] on the API side — values must
      // be strings, not nested objects, or the item 422s.
      item.metadata = {
        author: who.author,
        author_kind: who.kind,
        author_source: who.source,
      };
    } else {
      // An unattributed write is the exact gap this closes, so it is a warning,
      // not a silent pass. It still stores — losing the fact would be worse.
      aiLogger.warn(
        { bankId, source: context.source || null },
        'memory_retain: no author could be resolved — storing unattributed'
      );
    }

    if (whereTo?.room) {
      itemTags.push(`${ROOM_TAG_PREFIX}${whereTo.room}`);
      // Only on divergence: an exact canonical write leaves no alias trail, so
      // `room-alias:*` stays a clean census of what agents actually mistype.
      if (whereTo.alias) itemTags.push(`${ROOM_ALIAS_TAG_PREFIX}${whereTo.alias}`);
      if (whereTo.source === 'new') {
        itemTags.push(`${ROOM_NEW_TAG_PREFIX}${whereTo.room}`);
        aiLogger.warn(
          { bankId, roomTyped: room, roomResolved: whereTo.room },
          'memory_retain: unrecognised room — stored as a new room (call memory_rooms for the floor plan)'
        );
      }
    }
    if (itemTags.length) item.tags = [...new Set(itemTags)];

    aiLogger.info(
      {
        bankId,
        textLen: memorized.length,
        roomTyped: room || null,
        roomResolved: whereTo?.room || null,
        roomSource: whereTo?.source || null,
        hall,
        layer,
        author: who.author,
        authorSource: who.source,
      },
      'memory_retain'
    );

    const result = await hindsightRequest('POST', `/${bankId}/memories`, {
      items: [item],
    });

    const storedIds = (result.items || []).map(i => i.id || i.uuid).filter(Boolean);

    return {
      success: true,
      bank_id: bankId,
      items_stored: result.items_count || 1,
      ids: storedIds.length ? storedIds : null,
      author: who.author,
      // Echoed so a caller who typed `деплой` learns where it actually landed
      // instead of discovering it on the next recall that returns nothing.
      room: whereTo?.room || null,
      usage: result.usage || null,
    };
  },

  /**
   * Search long-term memory for relevant facts.
   */
  async memory_recall(
    { query, bank_id, limit, room, hall, max_layer, auto_scope, author, mine, include_unattributed },
    userId,
    context = {}
  ) {
    const bankId = bank_id || DEFAULT_BANK;

    // Personal-room recall. `mine` resolves to the caller's own identity;
    // `author` addresses someone else's (or several). Both narrow by author
    // tag, which is orthogonal to `room` — so "my memories about deployment"
    // is one call, not a choice between the two.
    let authors = authorList(author);
    if (mine) {
      const self = resolveAuthor(undefined, context);
      if (!self.author) {
        throw new Error(
          'memory_recall: `mine` was requested but the caller has no resolvable identity. ' +
          'Pass `author: "<your-slug>"` explicitly instead.'
        );
      }
      authors = [...new Set([...authors, self.author])];
    }
    const authorTags = authors.map((a) => `${AUTHOR_TAG_PREFIX}${a}`);
    // 'any_strict' = OR over the tags AND exclude untagged. Untagged matters
    // here: every memory written before author attribution shipped carries no
    // author tag, so plain 'any' would drag the whole legacy corpus into a
    // request for one agent's memories. `include_unattributed` opts back in.
    const tagsMatch = include_unattributed ? 'any' : 'any_strict';

    // ADR-157 DCD scope-router (Collection step). Opt-in via `auto_scope`, and
    // ONLY when the caller did not already scope the call — an explicit `room`
    // is always honoured (skip-router for already-scoped retrieval). A confident
    // route narrows BEFORE the search (+34% precision); a low-confidence route
    // widens to the domain (no room) rather than risk mis-scoping.
    //
    // ADR-193: the requested room goes through the same resolver the write side
    // uses, so a recall for `деплой` finds what was filed under `deployment`.
    let routedRoom = room ? resolveRoomList(room) : undefined;
    let routed = null;
    if (auto_scope && !room && query) {
      routed = routeMemoryScope(query);
      if (routed.confidence >= ROUTE_CONFIDENCE_FLOOR && routed.room) routedRoom = [routed.room];
      aiLogger.info(
        { bankId, query, routed, applied: routedRoom || null, agent: context.agentName },
        'memory_recall scope-router'
      );
    }

    const cap = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 10;

    // `roomTags` = the tag pass. `authorTags` = the author filter. They cannot
    // share one request: `tags_match` is a single mode for the whole tag list
    // (engine/interface.py:392), so "(author:a OR author:b) AND room:x" is not
    // expressible in one call. Hence two calls and a client-side join — the
    // same shape the ADR-157 widen fallback already uses.
    const recall = async (roomArg, roomTags = null) => {
      aiLogger.info(
        { bankId, query, room: roomArg, roomTags, hall, max_layer, authors, agent: context.agentName },
        'memory_recall'
      );
      const body = { query, limit: cap };
      if (roomArg) body.room = Array.isArray(roomArg) ? roomArg : [roomArg];
      if (hall) body.hall = Array.isArray(hall) ? hall : [hall];
      if (max_layer) body.max_layer = max_layer;
      if (roomTags) {
        body.tags = roomTags;
        body.tags_match = 'any_strict';
      } else if (authorTags.length) {
        body.tags = authorTags;
        body.tags_match = tagsMatch;
      }

      const result = await hindsightRequest('POST', `/${bankId}/memories/recall`, body);
      // The engine treats `limit` as a retrieval hint, not a cap on the
      // response: a recall asking for 5 comes back with 112. The tool's own
      // contract says "maximum number of results", and an agent that asked
      // for 5 just spent ~10k tokens of its context on 112. Enforce the cap
      // where the contract is stated.
      return (result.results || []).slice(0, cap).map(r => ({
        id: r.id || r.uuid || null,
        text: r.text,
        type: r.type,
        entities: r.entities,
        occurred: r.occurred_start || null,
        room: r.room || null,
        hall: r.hall || null,
        // Metadata carries the author on extracted facts; the tag carries it
        // on consolidation-derived observations. Read both, so every result
        // says who wrote it — including when nobody filtered by author.
        author: r.metadata?.author || authorFromTags(r.tags) || null,
      }));
    };

    // The author filter the tag pass cannot express server-side, applied here
    // instead. Same semantics as `any_strict`/`any`: with no author asked for
    // everything passes; with one asked for, unattributed rows are excluded
    // unless `include_unattributed` opts them back in.
    const authorAllowed = (m) => {
      if (!authors.length) return true;
      if (!m.author) return Boolean(include_unattributed);
      return authors.includes(m.author);
    };

    // ADR-193: a room lives on two carriers that disagree on old rows — the
    // column (which consolidation drops, hence 46% of the store is NULL) and
    // the `room:` tag (which it inherits). Until the backfill lands, recall has
    // to union them rather than pick one, or it goes blind on observations.
    const scopedRecall = async (rooms) => {
      if (!rooms || !rooms.length) return recall(undefined);
      const [byColumn, byTag] = await Promise.all([
        recall(rooms),
        recall(undefined, rooms.map((r) => `${ROOM_TAG_PREFIX}${r}`)),
      ]);
      const seen = new Set();
      const merged = [];
      for (const m of [...byColumn, ...byTag.filter(authorAllowed)]) {
        const key = m.id || m.text;
        if (seen.has(key)) continue;
        seen.add(key);
        merged.push(m);
      }
      return merged.slice(0, cap);
    };

    let memories = await scopedRecall(routedRoom);

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
      // Echoed so the caller can tell "nobody wrote that" from "the author
      // filter I did not realise was on".
      authors: authors.length ? authors : null,
      // Same reason, for the room axis: canonicalisation is invisible on the
      // read side otherwise, and a caller who typed `деплой` cannot tell
      // deployment results from a lucky semantic hit.
      rooms: routedRoom?.length ? routedRoom : null,
      memories,
    };
  },

  /**
   * List the rooms a bank actually has — the floor plan, before you write.
   *
   * No new engine endpoint: `GET /tags?q=room:*` is the same wildcard census
   * that already answers `author:*`. The room axis was the one axis nobody
   * could enumerate, which is precisely why agents kept inventing synonyms for
   * rooms that already existed.
   *
   * Counts come from the `room:` tag, which only exists on writes made since
   * ADR-193 plus whatever the Phase 4 backfill has reached — today that census
   * is empty while ~4 748 rows carry a non-empty room COLUMN. A thin
   * pass-through would therefore hand back an empty floor plan and defeat the
   * whole point of the tool, so the known vocabulary is unioned in at
   * `facts: 0` and every entry says whether it is `known`.
   *
   * `known: false` is the interesting row: somebody minted that room by typing
   * it. `known: true, facts: 0` means the room is safe to write to and simply
   * has no tagged facts yet.
   */
  async memory_rooms({ bank_id, limit }, userId, context = {}) {
    const bankId = bank_id || DEFAULT_BANK;
    const cap = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 100;

    aiLogger.info({ bankId, agent: context.agentName }, 'memory_rooms');

    const data = await hindsightRequest(
      'GET',
      `/${bankId}/tags?q=${encodeURIComponent(`${ROOM_TAG_PREFIX}*`)}&limit=${cap}`
    );

    const vocabulary = [...ROOMS, ...LIVE_ROOMS];
    const byRoom = new Map(vocabulary.map((r) => [r, { room: r, facts: 0, known: true }]));

    for (const item of data.items || []) {
      const room = String(item.tag || '').slice(ROOM_TAG_PREFIX.length);
      if (!room) continue;
      const known = byRoom.get(room);
      if (known) known.facts = item.count || 0;
      else byRoom.set(room, { room, facts: item.count || 0, known: false });
    }

    const rooms = [...byRoom.values()].sort(
      (a, b) => b.facts - a.facts || a.room.localeCompare(b.room)
    );

    return {
      success: true,
      bank_id: bankId,
      count: rooms.length,
      rooms,
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

    // ADR-193: the typed room goes through the same resolver the write side
    // uses. `room` here is a single string (not a list, as on recall), so this
    // mirrors retain — without it, `room: "деплой"` compresses nothing at all,
    // because what is in the column is `deployment`.
    //
    // The one place this must NOT copy retain: on retain, a room that
    // normalises to nothing legitimately means "no room" and the fact is
    // simply written without one. Here, an absent `room` means "compress every
    // eligible room" — so dropping an unresolvable one would silently widen the
    // operation to the whole bank instead of being a no-op. Explicitly passed
    // and unresolvable is an error, not an omission.
    const whereTo = room === undefined || room === null
      ? null
      : resolveRoom(room, { fuzzy: ROOM_FUZZY });
    if (whereTo && !whereTo.room) {
      throw new Error(
        `memory_compress: room ${JSON.stringify(room)} is not a usable room name — it is empty, ` +
        'whitespace-only, or not a string. Note `room` here is a single room name, NOT a list like ' +
        'memory_recall takes. Pass a real room, or omit `room` entirely to compress every eligible room.'
      );
    }

    aiLogger.info(
      { bankId, room: whereTo?.room ?? null, typed: room, hall, min_sources, agent: context.agentName },
      'memory_compress'
    );

    const body = {};
    if (whereTo?.room) body.room = whereTo.room;
    if (hall) body.hall = hall;
    if (min_sources) body.min_sources = min_sources;
    if (query) body.query = query;

    const result = await hindsightRequest('POST', `/${bankId}/closets`, body);

    return {
      success: true,
      bank_id: bankId,
      // Echo the room actually compressed: a caller who typed `деплой` and got
      // zero closets otherwise cannot tell canonicalisation from an empty room.
      room: whereTo?.room ?? null,
      closets_created: result.closets_created || 0,
      closets: result.closets || [],
    };
  },
};
