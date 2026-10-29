// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
const fetchRelay = vi.hoisted(() => vi.fn());
vi.mock('../../services/connectors/remoteMcp.js', async (original) => ({
  ...await original(), remoteMcpFetch: fetchRelay,
}));
import { getConnectorType, listConnectorTypes, validateConnectorTypeBody } from '../../services/connectors/catalogue/index.js';

const fields = { url: 'https://relay.example.com/mj/', access_token: 'test-relay-secret' };
beforeEach(() => vi.clearAllMocks());
describe('Midjourney relay connector', () => {
  it('exposes only URL and password fields through the existing space catalogue', () => {
    const type = listConnectorTypes().find(t => t.slug === 'midjourney');
    expect(type).toMatchObject({ auth_kind: 'api_key', refresh_supported: false });
    expect(type.fields.map(f => [f.key, f.type])).toEqual([['url', 'url'], ['access_token', 'password']]);
    expect(validateConnectorTypeBody('midjourney', { fields })).toEqual({ ok: true });
  });
  it.each([
    { ...fields, url: 'http://relay.example.com/mj' },
    { ...fields, url: 'https://127.0.0.1/mj' },
    { ...fields, url: 'https://user:password@relay.example.com/mj' },
    { ...fields, url: 'https://relay.example.com/mj?secret=x' },
    { ...fields, access_token: '' },
    { ...fields, access_token: 'secret\r\nInjected: yes' },
    { ...fields, discord_token: 'not-a-crm-setting' },
  ])('rejects invalid credentials or URLs: %j', (invalid) => {
    expect(validateConnectorTypeBody('midjourney', { fields: invalid }).ok).toBe(false);
  });
  it('checks the queue with the relay header without creating an image', async () => {
    fetchRelay.mockResolvedValue(new Response('[]'));
    expect(await getConnectorType('midjourney').test(fields)).toEqual({ ok: true });
    expect(fetchRelay).toHaveBeenCalledWith('https://relay.example.com/mj/task/queue', expect.objectContaining({
      method: 'GET', headers: { 'mj-api-secret': fields.access_token, 'Content-Type': 'application/json' },
    }));
  });
  it.each(['<html>login</html>', '{"code":401}', '[{"unexpected":true}]'])('rejects an invalid relay response', async (body) => {
    fetchRelay.mockResolvedValue(new Response(body));
    expect((await getConnectorType('midjourney').test(fields)).ok).toBe(false);
  });
  it('never exposes the upstream error or secret', async () => {
    fetchRelay.mockRejectedValue(new Error(fields.access_token));
    const result = await getConnectorType('midjourney').test(fields);
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain(fields.access_token);
  });
});
