// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
const fetchRelay = vi.hoisted(() => vi.fn());
vi.mock('../../connectors/remoteMcp.js', async (original) => ({ ...await original(), remoteMcpFetch: fetchRelay }));
import { connectorToolHandlers as handlers, connectorRequirements } from '../connector-tools.js';
import { buildToolList } from '../../mcp/buildToolList.js';

const context = { spaceId: 11, injected_connector: {
  type_slug: 'midjourney', access_token: 'relay-fixture-secret', custom_fields: { url: 'https://relay.example.com/mj' },
} };
const json = body => new Response(JSON.stringify(body));
beforeEach(() => vi.clearAllMocks());
describe('Midjourney MCP generation', () => {
  it('advertises both tools on the canonical MCP surface with a connector requirement', () => {
    const tools = buildToolList();
    for (const name of ['midjourney_image_generate', 'midjourney_check_task']) {
      expect(tools.find(t => t.name === name)).toBeDefined();
      expect(connectorRequirements[name]).toBe('midjourney');
    }
  });
  it.each([1, 21, 22])('accepts relay submission code %s and returns a scoped task handle', async code => {
    fetchRelay.mockResolvedValue(json({ code, result: '12345' }));
    const result = await handlers.midjourney_image_generate({ prompt: 'A sailboat' }, 1, context);
    expect(result).toMatchObject({ async: true, status: 'SUBMITTED', task_id: expect.any(String) });
    expect(JSON.stringify(result)).not.toContain(context.injected_connector.access_token);
    expect(fetchRelay).toHaveBeenCalledTimes(1);
    expect(fetchRelay).toHaveBeenCalledWith('https://relay.example.com/mj/submit/imagine', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ prompt: 'A sailboat' }),
      headers: { 'Content-Type': 'application/json', 'mj-api-secret': 'relay-fixture-secret' },
    }));
  });
  it.each([{ prompt: '' }, { prompt: 'hi', space_id: 12 }, { prompt: 'hi', url: 'https://other.example' }])('rejects invalid input before any network call', async args => {
    expect(await handlers.midjourney_image_generate(args, 1, context)).toHaveProperty('error');
    expect(fetchRelay).not.toHaveBeenCalled();
  });
  it('requires server-injected credentials and space context', async () => {
    for (const ctx of [{}, { spaceId: 11 }, { injected_connector: context.injected_connector }]) {
      expect(await handlers.midjourney_image_generate({ prompt: 'hi' }, 1, ctx)).toHaveProperty('error');
    }
    expect(fetchRelay).not.toHaveBeenCalled();
  });
  it('polls once and returns only validated output', async () => {
    fetchRelay.mockResolvedValueOnce(json({ code: 1, result: '12345' }));
    const started = await handlers.midjourney_image_generate({ prompt: 'hi' }, 1, context);
    fetchRelay.mockResolvedValueOnce(json({ id: '12345', status: 'IN_PROGRESS', progress: '50%', imageUrl: null }));
    expect(await handlers.midjourney_check_task({ task_id: started.task_id }, 1, context))
      .toMatchObject({ status: 'IN_PROGRESS', progress: '50%', async: true });
    fetchRelay.mockResolvedValueOnce(json({ id: '12345', status: 'SUCCESS', imageUrl: 'https://cdn.example.com/image.png?signature=abc', properties: { token: 'private' } }));
    const done = await handlers.midjourney_check_task({ task_id: started.task_id }, 1, context);
    expect(done).toMatchObject({ status: 'SUCCESS', async: false, image_url: 'https://cdn.example.com/image.png?signature=abc' });
    expect(done).not.toHaveProperty('properties');
    expect(fetchRelay.mock.lastCall[0]).toBe('https://relay.example.com/mj/task/12345/fetch');
  });
  it('rejects a task from another space, changed relay, or forged handle before network', async () => {
    fetchRelay.mockResolvedValueOnce(json({ code: 1, result: '12345' }));
    const started = await handlers.midjourney_image_generate({ prompt: 'hi' }, 1, context);
    fetchRelay.mockClear();
    for (const ctx of [{ ...context, spaceId: 12 }, { ...context, injected_connector: {
      ...context.injected_connector, custom_fields: { url: 'https://other.example.com/mj' },
    } }]) {
      expect(await handlers.midjourney_check_task({ task_id: started.task_id }, 1, ctx)).toHaveProperty('error');
    }
    expect(await handlers.midjourney_check_task({ task_id: '12345' }, 1, context)).toHaveProperty('error');
    expect(fetchRelay).not.toHaveBeenCalled();
  });
  it.each([{ code: 23, result: null }, { code: 1, result: '../secret' }, '<html>error</html>'])('rejects errors and malformed submission responses', async body => {
    fetchRelay.mockResolvedValueOnce(json(body));
    expect(await handlers.midjourney_image_generate({ prompt: 'hi' }, 1, context)).toHaveProperty('error');
  });
  it('does not leak network errors or retry a possibly accepted generation', async () => {
    fetchRelay.mockRejectedValueOnce(new Error('relay-fixture-secret'));
    const result = await handlers.midjourney_image_generate({ prompt: 'hi' }, 1, context);
    expect(result).toHaveProperty('error');
    expect(JSON.stringify(result)).not.toContain('relay-fixture-secret');
    expect(fetchRelay).toHaveBeenCalledTimes(1);
  });
  it.each([
    { id: 'different-task', status: 'SUCCESS', imageUrl: 'https://cdn.example.com/image.png' },
    { id: '12345', status: 'SUCCESS', imageUrl: 'javascript:alert(1)' },
    { id: '12345', status: 'SUCCESS', imageUrl: null },
    { id: '12345', status: 'UNKNOWN' },
  ])('rejects malformed or mismatched task output', async task => {
    fetchRelay.mockResolvedValueOnce(json({ code: 1, result: '12345' }));
    const started = await handlers.midjourney_image_generate({ prompt: 'hi' }, 1, context);
    fetchRelay.mockResolvedValueOnce(json(task));
    expect(await handlers.midjourney_check_task({ task_id: started.task_id }, 1, context)).toHaveProperty('error');
  });
  it('stops polling on FAILURE and never echoes upstream private details', async () => {
    fetchRelay.mockResolvedValueOnce(json({ code: 1, result: '12345' }));
    const started = await handlers.midjourney_image_generate({ prompt: 'hi' }, 1, context);
    fetchRelay.mockResolvedValueOnce(json({ id: '12345', status: 'FAILURE', failReason: 'private relay diagnostics' }));
    const result = await handlers.midjourney_check_task({ task_id: started.task_id }, 1, context);
    expect(result).toMatchObject({ status: 'FAILURE', async: false });
    expect(JSON.stringify(result)).not.toContain('private relay diagnostics');
  });
});
