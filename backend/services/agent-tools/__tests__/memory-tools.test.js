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
const { memory_retain, memory_recall } = memoryToolHandlers;

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
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(lastBody().room).toEqual(['auth']);
  });

  it('honours an explicit room and skips the router even with auto_scope', async () => {
    fetchMock.mockResolvedValue(recallResponse([{ id: 'm1', text: 'x' }]));
    await memory_recall({ query: 'jwt login token', room: 'pipeline', auto_scope: true }, 1, {});
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(lastBody().room).toEqual(['pipeline']);
  });

  it('widens by one level: a routed room that returns nothing retries unscoped', async () => {
    fetchMock
      .mockResolvedValueOnce(recallResponse([]))                       // routed room → empty
      .mockResolvedValueOnce(recallResponse([{ id: 'm9', text: 'y' }])); // widened → hit
    const res = await memory_recall({ query: 'jwt login token session', auto_scope: true }, 1, {});
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).room).toEqual(['auth']);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).room).toBeUndefined();
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
