// @vitest-environment node
/**
 * Unit guard for the Hindsight memory_retain wrapper.
 *
 * Pins the bug @marketer hit live: a retain call 422'd with
 * `body.items.0.content: Field required`. Root cause = the memorized string
 * arrived under the API's own field name `content` (not the tool's `text`),
 * so `item.content` was undefined and an empty item shipped to FastAPI.
 *
 * Pins:
 *  - happy path: `text` → POST { items: [{ content }] }
 *  - alias: `content` (no `text`) is accepted as the memorized string
 *  - empty/missing content → fail fast LOCALLY, never round-trip an empty item
 *  - 422 array `detail` surfaces as a human string, not "[object Object]"
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../../utils/logger.js', () => ({
  aiLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { memoryToolHandlers } = await import('../memory-tools.js');
const { memory_retain, memory_recall, memory_rooms, memory_compress } = memoryToolHandlers;
const { aiLogger } = await import('../../../utils/logger.js');

function recallResponse(results = []) {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ results }),
  };
}

function okResponse(body = { items: [{ id: 'm1' }], items_count: 1 }) {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify(body),
  };
}

function errResponse(status, body) {
  return {
    ok: false,
    status,
    text: async () => JSON.stringify(body),
  };
}

let fetchMock;
beforeEach(() => {
  fetchMock = vi.fn().mockResolvedValue(okResponse());
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

function lastBody() {
  return JSON.parse(fetchMock.mock.calls.at(-1)[1].body);
}

describe('memory_retain', () => {
  it('wraps `text` into items:[{ content }] and reports success', async () => {
    const res = await memory_retain({ text: 'a fact worth keeping', bank_id: 'godcrm-main' }, 1, {});
    expect(res.success).toBe(true);
    expect(lastBody()).toEqual({ items: [{ content: 'a fact worth keeping' }] });
  });

  it('accepts the memorized string under the `content` alias (the live 422 bug)', async () => {
    const res = await memory_retain({ content: 'stored under the api field name' }, 1, {});
    expect(res.success).toBe(true);
    expect(lastBody().items[0].content).toBe('stored under the api field name');
  });

  it('fails fast locally on empty content — never ships an empty item to the API', async () => {
    await expect(memory_retain({ text: '   ' }, 1, {})).rejects.toThrow(/text.*required|required.*text/i);
    await expect(memory_retain({}, 1, {})).rejects.toThrow(/required/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('surfaces a FastAPI 422 array `detail` as a human string, not [object Object]', async () => {
    fetchMock.mockResolvedValueOnce(
      errResponse(422, { detail: [{ loc: ['body', 'items', 0, 'content'], msg: 'Field required', type: 'missing' }] })
    );
    await expect(memory_retain({ text: 'x' }, 1, {})).rejects.toThrow('body.items.0.content: Field required');
  });
});

describe('memory_retain — author attribution', () => {
  it('stamps the agent-loop identity as an author tag AND metadata', async () => {
    const res = await memory_retain({ text: 'a fact' }, 1, { agentName: 'SysAdmin' });
    const item = lastBody().items[0];
    expect(item.tags).toEqual(['author:sysadmin']);
    expect(item.metadata).toEqual({ author: 'sysadmin', author_kind: 'agent', author_source: 'agent-loop' });
    expect(res.author).toBe('sysadmin');
  });

  it('keeps caller tags and adds the author tag alongside them', async () => {
    await memory_retain({ text: 'a fact', tags: ['release', 'rcll'] }, 1, { agentName: 'marketer' });
    expect(lastBody().items[0].tags).toEqual(['release', 'rcll', 'author:marketer']);
  });

  it('cannot be forged: a hand-written author: tag is dropped in favour of the resolved identity', async () => {
    await memory_retain({ text: 'a fact', tags: ['author:architect'] }, 1, { agentName: 'sysadmin' });
    expect(lastBody().items[0].tags).toEqual(['author:sysadmin']);
  });

  it('server identity outranks a self-declared author argument', async () => {
    await memory_retain({ text: 'a fact', author: 'architect' }, 1, { agentName: 'sysadmin' });
    expect(lastBody().items[0].metadata.author).toBe('sysadmin');
    expect(lastBody().items[0].metadata.author_source).toBe('agent-loop');
  });

  it('accepts a declared author only when there is no server identity (MCP/CLI), and records it as declared', async () => {
    await memory_retain({ text: 'a fact', author: '@Architect' }, 1, { source: 'mcp' });
    expect(lastBody().items[0].tags).toEqual(['author:architect']);
    expect(lastBody().items[0].metadata.author_source).toBe('declared');
  });

  it('never derives an author from userId — an unidentified caller stores unattributed, not as the owner', async () => {
    const res = await memory_retain({ text: 'a fact' }, 1, {});
    expect(lastBody().items[0].tags).toBeUndefined();
    expect(lastBody().items[0].metadata).toBeUndefined();
    expect(res.author).toBeNull();
  });
});

describe('memory_recall — personal room', () => {
  it('`mine` filters to the caller\'s own author tag, excluding untagged legacy memories', async () => {
    fetchMock.mockResolvedValue(recallResponse([{ id: 'm1', text: 'x' }]));
    const res = await memory_recall({ query: 'what did I learn', mine: true }, 1, { agentName: 'sysadmin' });
    expect(lastBody().tags).toEqual(['author:sysadmin']);
    expect(lastBody().tags_match).toBe('any_strict');
    expect(res.authors).toEqual(['sysadmin']);
  });

  it('`include_unattributed` widens to the pre-attribution corpus', async () => {
    fetchMock.mockResolvedValue(recallResponse([{ id: 'm1', text: 'x' }]));
    await memory_recall({ query: 'q', mine: true, include_unattributed: true }, 1, { agentName: 'sysadmin' });
    expect(lastBody().tags_match).toBe('any');
  });

  it('author and room are independent axes — the column pass carries both', async () => {
    fetchMock.mockResolvedValue(recallResponse([{ id: 'm1', text: 'x' }]));
    await memory_recall({ query: 'q', author: ['marketer', 'Architect'], room: 'deployment' }, 1, {});
    // ADR-193: a scoped recall is two calls (column ∪ room-tag). The author
    // filter rides the column pass; the tag pass cannot express it server-side
    // (one tags_match per request) and filters authors on the client.
    const column = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(column.tags).toEqual(['author:marketer', 'author:architect']);
    expect(column.room).toEqual(['deployment']);
  });

  it('sends no tag filter at all when no author was asked for (default behaviour unchanged)', async () => {
    fetchMock.mockResolvedValue(recallResponse([{ id: 'm1', text: 'x' }]));
    const res = await memory_recall({ query: 'q' }, 1, { agentName: 'sysadmin' });
    expect(lastBody().tags).toBeUndefined();
    expect(lastBody().tags_match).toBeUndefined();
    expect(res.authors).toBeNull();
  });

  it('refuses `mine` when the caller has no resolvable identity instead of silently returning everything', async () => {
    await expect(memory_recall({ query: 'q', mine: true }, 1, {})).rejects.toThrow(/no resolvable identity/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports the author on every result — from metadata, and from the tag when consolidation dropped metadata', async () => {
    fetchMock.mockResolvedValue(recallResponse([
      { id: 'm1', text: 'fact', metadata: { author: 'sysadmin' }, tags: ['author:sysadmin'] },
      { id: 'm2', text: 'observation', metadata: {}, tags: ['author:marketer'] },
      { id: 'm3', text: 'legacy', metadata: {}, tags: [] },
    ]));
    const res = await memory_recall({ query: 'q' }, 1, {});
    expect(res.memories.map((m) => m.author)).toEqual(['sysadmin', 'marketer', null]);
  });

  it('keeps the author filter when the scope-router widens the room', async () => {
    fetchMock
      .mockResolvedValueOnce(recallResponse([]))                        // column pass → empty
      .mockResolvedValueOnce(recallResponse([]))                        // room-tag pass → empty
      .mockResolvedValueOnce(recallResponse([{ id: 'm9', text: 'y' }])); // widened → hit
    await memory_recall({ query: 'jwt login token session', auto_scope: true, mine: true }, 1, { agentName: 'sysadmin' });
    const widened = JSON.parse(fetchMock.mock.calls[2][1].body);
    expect(widened.room).toBeUndefined();
    expect(widened.tags).toEqual(['author:sysadmin']);
  });
});

describe('memory_recall — limit is a cap, not a hint', () => {
  const many = (n) => Array.from({ length: n }, (_, i) => ({ id: `m${i}`, text: `fact ${i}` }));

  it('caps the returned list at the requested limit even when the engine over-returns', async () => {
    fetchMock.mockResolvedValue(recallResponse(many(112)));
    const res = await memory_recall({ query: 'q', limit: 5 }, 1, {});
    expect(lastBody().limit).toBe(5);
    expect(res.count).toBe(5);
    expect(res.memories).toHaveLength(5);
  });

  it('falls back to 10 for a missing or nonsensical limit', async () => {
    fetchMock.mockResolvedValue(recallResponse(many(112)));
    expect((await memory_recall({ query: 'q' }, 1, {})).count).toBe(10);
    expect((await memory_recall({ query: 'q', limit: 0 }, 1, {})).count).toBe(10);
    expect((await memory_recall({ query: 'q', limit: -3 }, 1, {})).count).toBe(10);
  });
});

describe('memory_retain — ADR-193 room aliasing', () => {
  const tagsOf = () => lastBody().items[0].tags || [];

  it('AC1: a Russian synonym is canonicalised into the column and leaves an alias trail', async () => {
    await memory_retain({ text: 'a fact', room: 'деплой' }, 1, {});
    expect(lastBody().items[0].room).toBe('deployment');
    expect(tagsOf()).toEqual(expect.arrayContaining(['room:deployment', 'room-alias:деплой']));
  });

  it('AC1b: an English synonym resolves through ROOM_HINTS — the map that already routes reads', async () => {
    await memory_retain({ text: 'a fact', room: 'deploy' }, 1, {});
    expect(lastBody().items[0].room).toBe('deployment');
    expect(tagsOf()).toEqual(expect.arrayContaining(['room:deployment', 'room-alias:deploy']));
  });

  it('AC2: an exact canonical room leaves NO alias trail', async () => {
    await memory_retain({ text: 'a fact', room: 'deployment' }, 1, {});
    expect(lastBody().items[0].room).toBe('deployment');
    expect(tagsOf()).toContain('room:deployment');
    expect(tagsOf().some((t) => t.startsWith('room-alias:'))).toBe(false);
    expect(tagsOf().some((t) => t.startsWith('room-new:'))).toBe(false);
  });

  it('AC2b: a room that is live but outside the hardcoded vocabulary is not treated as new', async () => {
    // `shared` holds 1350 facts. Flagging every write to it as a new room would
    // make room-new: useless noise.
    await memory_retain({ text: 'a fact', room: 'shared' }, 1, {});
    expect(lastBody().items[0].room).toBe('shared');
    expect(tagsOf()).toContain('room:shared');
    expect(tagsOf().some((t) => t.startsWith('room-new:'))).toBe(false);
  });

  it('AC3: an unrecognised room still STORES, tagged room-new: and warned about', async () => {
    aiLogger.warn.mockClear();
    const res = await memory_retain({ text: 'a fact', room: 'неведомая-зона' }, 1, {});
    expect(res.success).toBe(true);
    expect(lastBody().items[0].room).toBe('неведомая-зона');
    expect(tagsOf()).toEqual(expect.arrayContaining(['room:неведомая-зона', 'room-new:неведомая-зона']));
    expect(aiLogger.warn).toHaveBeenCalled();
  });

  it('AC4: case and spacing collapse to one room — no ADR-165/adr-165 twins', async () => {
    await memory_retain({ text: 'a fact', room: 'Деплой' }, 1, {});
    const upper = tagsOf();
    await memory_retain({ text: 'a fact', room: '  деплой ' }, 1, {});
    expect(tagsOf()).toEqual(upper);
    expect(upper).toEqual(expect.arrayContaining(['room:deployment', 'room-alias:деплой']));
  });

  it('AC5: hand-written room tags cannot be forged — the resolver overwrites them', async () => {
    await memory_retain(
      { text: 'a fact', room: 'деплой', tags: ['room:auth', 'room-alias:nope', 'room-new:invented', 'keepme'] },
      1,
      {}
    );
    expect(tagsOf()).toEqual(['keepme', 'room:deployment', 'room-alias:деплой']);
  });

  it('a room that normalises to nothing is treated as absent, not stored as an empty room', async () => {
    await memory_retain({ text: 'a fact', room: '   ' }, 1, {});
    expect(lastBody().items[0].room).toBeUndefined();
    expect(lastBody().items[0].tags).toBeUndefined();
  });

  it('does not resolve a room to an inherited Object property (`constructor` is reachable input)', async () => {
    await memory_retain({ text: 'a fact', room: 'constructor' }, 1, {});
    // Without prototype-free lookups this resolved to the Object constructor,
    // JSON.stringify dropped the function, and the write landed with no room.
    expect(lastBody().items[0].room).toBe('constructor');
    expect(tagsOf()).toContain('room:constructor');
  });

  it('echoes where the memory actually landed', async () => {
    const res = await memory_retain({ text: 'a fact', room: 'инфра' }, 1, {});
    expect(res.room).toBe('infrastructure');
  });
});

describe('memory_recall — ADR-193 room aliasing', () => {
  it('AC6: unions the column pass and the room-tag pass, deduped by id and capped', async () => {
    fetchMock
      .mockResolvedValueOnce(recallResponse([{ id: 'f1', text: 'fact' }, { id: 'both', text: 'dup' }]))
      .mockResolvedValueOnce(recallResponse([{ id: 'both', text: 'dup' }, { id: 'o1', text: 'observation' }]));
    const res = await memory_recall({ query: 'q', room: 'деплой', limit: 10 }, 1, {});

    expect(JSON.parse(fetchMock.mock.calls[0][1].body).room).toEqual(['deployment']);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).tags).toEqual(['room:deployment']);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).tags_match).toBe('any_strict');
    expect(res.memories.map((m) => m.id)).toEqual(['f1', 'both', 'o1']);
    expect(res.rooms).toEqual(['deployment']);
  });

  it('AC6b: the union is capped at limit, not limit×2', async () => {
    const many = (p, n) => Array.from({ length: n }, (_, i) => ({ id: `${p}${i}`, text: 'x' }));
    fetchMock
      .mockResolvedValueOnce(recallResponse(many('c', 5)))
      .mockResolvedValueOnce(recallResponse(many('t', 5)));
    const res = await memory_recall({ query: 'q', room: 'deployment', limit: 5 }, 1, {});
    expect(res.count).toBe(5);
  });

  it('AC7: author + room does not break on the one-mode tags_match limit — two calls, author joined client-side', async () => {
    fetchMock
      .mockResolvedValueOnce(recallResponse([{ id: 'f1', text: 'mine', tags: ['author:sysadmin'] }]))
      .mockResolvedValueOnce(recallResponse([
        { id: 'o1', text: 'mine too', tags: ['author:sysadmin'] },
        { id: 'o2', text: 'someone else', tags: ['author:marketer'] },
        { id: 'o3', text: 'legacy', tags: [] },
      ]));
    const res = await memory_recall({ query: 'q', room: 'deployment', mine: true }, 1, { agentName: 'sysadmin' });

    // Column pass carries the author filter server-side...
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).tags).toEqual(['author:sysadmin']);
    // ...the tag pass spends its single tags_match on the room, so the author
    // filter is applied here instead. Unattributed rows stay out by default.
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).tags).toEqual(['room:deployment']);
    expect(res.memories.map((m) => m.id)).toEqual(['f1', 'o1']);
  });

  it('AC7b: include_unattributed lets the pre-attribution corpus back through the tag pass', async () => {
    fetchMock
      .mockResolvedValueOnce(recallResponse([]))
      .mockResolvedValueOnce(recallResponse([{ id: 'o3', text: 'legacy', tags: [] }]));
    const res = await memory_recall(
      { query: 'q', room: 'deployment', mine: true, include_unattributed: true },
      1,
      { agentName: 'sysadmin' }
    );
    expect(res.memories.map((m) => m.id)).toEqual(['o3']);
  });

  it('a room that normalises to nothing sends no room predicate at all — and says so', async () => {
    fetchMock.mockResolvedValue(recallResponse([{ id: 'm1', text: 'x' }]));
    const res = await memory_recall({ query: 'q', room: '   ' }, 1, {});
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(lastBody().room).toBeUndefined();
    expect(res.rooms).toBeNull();
  });
});

describe('memory_rooms — the floor plan', () => {
  it('AC8: reports the room: tag census with counts', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ items: [{ tag: 'room:deployment', count: 163 }] }),
    });
    const res = await memory_rooms({}, 1, {});
    const url = fetchMock.mock.calls.at(-1)[0];
    expect(url).toContain('/tags?q=');
    expect(decodeURIComponent(url)).toContain('room:*');
    expect(res.rooms.find((r) => r.room === 'deployment')).toEqual({ room: 'deployment', facts: 163, known: true });
  });

  it('is useful on day one: the known vocabulary is listed at facts 0, not omitted', async () => {
    // The tag census is empty until the Phase 4 backfill runs, so a thin
    // pass-through would hand an agent an empty floor plan.
    fetchMock.mockResolvedValue({
      ok: true, status: 200, text: async () => JSON.stringify({ items: [] }),
    });
    const res = await memory_rooms({}, 1, {});
    const names = res.rooms.map((r) => r.room);
    expect(names).toEqual(expect.arrayContaining(['deployment', 'auth', 'shared', 'marketing']));
    expect(res.rooms.every((r) => r.facts === 0 && r.known === true)).toBe(true);
  });

  it('flags a room nobody recognises — the ones an agent minted by typing', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ items: [{ tag: 'room:неведомая-зона', count: 2 }] }),
    });
    const res = await memory_rooms({}, 1, {});
    expect(res.rooms[0]).toEqual({ room: 'неведомая-зона', facts: 2, known: false });
  });
});

describe('memory_compress — ADR-193 room aliasing', () => {
  it('AC1: a typed synonym is canonicalised before it reaches the engine', async () => {
    await memory_compress({ room: 'деплой' }, 1, {});
    expect(lastBody().room).toBe('deployment');
  });

  it('AC2: an explicitly passed room that resolves to nothing is an error, not a dropped filter', async () => {
    // Dropping it would not be a no-op: no `room` means "compress every
    // eligible room", so a silent drop widens an expensive closet job to the
    // whole bank. Whitespace and empty string alike.
    await expect(memory_compress({ room: '  ' }, 1, {})).rejects.toThrow(/not a usable room name/);
    await expect(memory_compress({ room: '' }, 1, {})).rejects.toThrow(/not a usable room name/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects the list shape memory_recall teaches, and says which shape this tool wants', async () => {
    // `memory_recall` takes a room LIST; this tool takes one string. An agent
    // that just learned the list shape next door passes ["деплой"] here, and a
    // bare "unusable room" message would explain nothing.
    await expect(memory_compress({ room: ['деплой'] }, 1, {})).rejects.toThrow(/single room name, NOT a list/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('AC3: no room at all still means "every eligible room" — unchanged', async () => {
    await memory_compress({}, 1, {});
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(lastBody().room).toBeUndefined();
  });

  it('AC4: an exact canonical room passes through untouched', async () => {
    await memory_compress({ room: 'deployment' }, 1, {});
    expect(lastBody().room).toBe('deployment');
  });

  it('echoes the room the job actually ran against', async () => {
    // Typed `деплой`, zero closets: without the echo the caller cannot tell
    // canonicalisation from an empty room. Same reason retain echoes it.
    expect((await memory_compress({ room: 'деплой' }, 1, {})).room).toBe('deployment');
    expect((await memory_compress({}, 1, {})).room).toBeNull();
  });
});

describe('memory_recall — ADR-157 scope-router', () => {
  it('does NOT route when auto_scope is off (default behaviour unchanged)', async () => {
    fetchMock.mockResolvedValue(recallResponse([{ id: 'm1', text: 'x' }]));
    await memory_recall({ query: 'how does jwt login token session work' }, 1, {});
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(lastBody().room).toBeUndefined();
  });

  it('routes a confident query to its room when auto_scope is on', async () => {
    fetchMock.mockResolvedValue(recallResponse([{ id: 'm1', text: 'x' }]));
    await memory_recall({ query: 'how does jwt login token session work', auto_scope: true }, 1, {});
    // Two calls, not one: a routed room is still a scoped recall, so it unions
    // the column pass with the room-tag pass (ADR-193).
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).room).toEqual(['auth']);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).tags).toEqual(['room:auth']);
  });

  it('honours an explicit room and skips the router even with auto_scope', async () => {
    fetchMock.mockResolvedValue(recallResponse([{ id: 'm1', text: 'x' }]));
    await memory_recall({ query: 'jwt login token', room: 'pipeline', auto_scope: true }, 1, {});
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).room).toEqual(['pipeline']);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).tags).toEqual(['room:pipeline']);
  });

  it('widens by one level: a routed room that returns nothing retries unscoped', async () => {
    fetchMock
      .mockResolvedValueOnce(recallResponse([]))                       // routed room, column → empty
      .mockResolvedValueOnce(recallResponse([]))                       // routed room, tag → empty
      .mockResolvedValueOnce(recallResponse([{ id: 'm9', text: 'y' }])); // widened → hit
    const res = await memory_recall({ query: 'jwt login token session', auto_scope: true }, 1, {});
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).room).toEqual(['auth']);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).tags).toEqual(['room:auth']);
    // Widening means "no room predicate at all", so it drops the tag pass too —
    // deliberate: the union only exists to reconcile the two room carriers.
    const widened = JSON.parse(fetchMock.mock.calls[2][1].body);
    expect(widened.room).toBeUndefined();
    expect(widened.tags).toBeUndefined();
    expect(res.count).toBe(1);
  });

  it('does not widen when a low-confidence query was never scoped', async () => {
    fetchMock.mockResolvedValue(recallResponse([]));
    await memory_recall({ query: 'what about the api', auto_scope: true }, 1, {});
    // single weak hit → widened up front (no room), so no second retry call
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(lastBody().room).toBeUndefined();
  });
});
