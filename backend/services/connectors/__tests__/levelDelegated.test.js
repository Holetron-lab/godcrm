// @vitest-environment node
import '../../../test/setup.js';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import {
  createLevelDelegatedConnector,
  LEVEL_AGENT_SECRET_REF,
} from '../levelDelegated.js';

const assertion = 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxMjMifQ.signature';
const delegatedToken = 'a'.repeat(43);
const clientSecret = 'level-agent-test-secret';
const tokenResponse = {
  access_token: delegatedToken,
  issued_token_type: 'urn:ietf:params:oauth:token-type:access_token',
  token_type: 'Bearer',
  expires_in: 60,
  scope: 'orders.view',
};

const fetchMock = vi.fn();
const getSecret = vi.fn();
let connector;

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function exchange(scopes = ['orders.view']) {
  return connector.exchange({ subjectToken: assertion, scopes });
}

beforeEach(() => {
  vi.restoreAllMocks();
  fetchMock.mockReset();
  getSecret.mockReset().mockResolvedValue(clientSecret);
  fetchMock.mockResolvedValue(jsonResponse(tokenResponse));
  connector = createLevelDelegatedConnector({
    fetchImpl: fetchMock,
    getSecret,
    allowedScopes: ['orders.view', 'orders.edit'],
    origin: 'https://level.test',
    timeoutMs: 1234,
  });
});

test('exchanges a job assertion with exact RFC 8693 fields and dedicated Basic credentials', async () => {
  const timeout = vi.spyOn(AbortSignal, 'timeout');
  await expect(exchange()).resolves.toEqual(tokenResponse);
  expect(getSecret).toHaveBeenCalledWith(LEVEL_AGENT_SECRET_REF, { spaceId: 11 });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [url, init] = fetchMock.mock.calls[0];
  expect(url).toBe('https://level.test/api/oauth/token-exchange');
  expect(url).not.toContain(assertion);
  expect(url).not.toContain(clientSecret);
  expect(init).toMatchObject({
    method: 'POST',
    redirect: 'error',
    headers: {
      Authorization: `Basic ${Buffer.from(`godcrm-agent:${clientSecret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
      'Cache-Control': 'no-store',
    },
  });
  expect(timeout).toHaveBeenCalledWith(1234);
  const body = new URLSearchParams(init.body);
  expect(Object.fromEntries(body)).toEqual({
    grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
    subject_token: assertion,
    subject_token_type: 'urn:ietf:params:oauth:token-type:jwt',
    requested_token_type: 'urn:ietf:params:oauth:token-type:access_token',
    audience: 'level-api',
    scope: 'orders.view',
  });
});

test('uses the authoritative downscoped response and removes duplicate requested scopes', async () => {
  fetchMock.mockResolvedValue(jsonResponse({ ...tokenResponse, scope: 'orders.view' }));
  const result = await exchange(['orders.view', 'orders.edit', 'orders.view']);
  expect(result.scope).toBe('orders.view');
  expect(new URLSearchParams(fetchMock.mock.calls[0][1].body).get('scope')).toBe('orders.view orders.edit');
});

test.each([
  ['*'],
  ['orders.*'],
  ['unknown.view'],
  [''],
  ['orders'],
])('does not request wildcard, malformed or unknown scope %j', async (scope) => {
  await expect(exchange([scope])).rejects.toThrow('LEVEL_SCOPE_FORBIDDEN');
  expect(fetchMock).not.toHaveBeenCalled();
  expect(getSecret).not.toHaveBeenCalled();
});

test.each([
  [{ ...tokenResponse, access_token: 'short' }],
  [{ ...tokenResponse, expires_in: 61 }],
  [{ ...tokenResponse, expires_in: 0 }],
  [{ ...tokenResponse, issued_token_type: 'wrong' }],
  [{ ...tokenResponse, token_type: 'bearer' }],
  [{ ...tokenResponse, scope: 'orders.edit' }],
  [{ ...tokenResponse, scope: '*' }],
  [{ ...tokenResponse, refresh_token: 'must-not-exist' }],
])('rejects an invalid or broader token response without exposing credentials', async (body) => {
  fetchMock.mockResolvedValue(jsonResponse(body));
  const error = await exchange().catch((value) => value);
  expect(error).toBeInstanceOf(Error);
  expect(error.message).toBe('LEVEL_TOKEN_RESPONSE_INVALID');
  expect(JSON.stringify(error)).not.toContain(clientSecret);
  expect(JSON.stringify(error)).not.toContain(assertion);
});

test('revokes through RFC 7009 with an access-token hint and no URL credentials', async () => {
  fetchMock.mockResolvedValue(new Response(null, { status: 200 }));
  await expect(connector.revoke(delegatedToken)).resolves.toBeUndefined();
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [url, init] = fetchMock.mock.calls[0];
  expect(url).toBe('https://level.test/api/oauth/revoke');
  expect(url).not.toContain(delegatedToken);
  expect(url).not.toContain(clientSecret);
  expect(Object.fromEntries(new URLSearchParams(init.body))).toEqual({
    token: delegatedToken,
    token_type_hint: 'access_token',
  });
  expect(init.headers.Authorization).toBe(`Basic ${Buffer.from(`godcrm-agent:${clientSecret}`).toString('base64')}`);
});

test('never retries an uncertain exchange and sanitizes transport failures', async () => {
  fetchMock.mockRejectedValue(new Error(`socket closed while sending ${assertion} ${clientSecret}`));
  const error = await exchange().catch((value) => value);
  expect(error.message).toBe('LEVEL_EXCHANGE_UNAVAILABLE');
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(error.message).not.toContain(assertion);
  expect(error.message).not.toContain(clientSecret);
});

test('does not retry revocation after an uncertain result', async () => {
  fetchMock.mockRejectedValue(new Error('connection reset'));
  await expect(connector.revoke(delegatedToken)).rejects.toThrow('LEVEL_REVOCATION_UNAVAILABLE');
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

describe('configuration and HTTP failures', () => {
  test('fails closed when the dedicated secret is unavailable', async () => {
    getSecret.mockResolvedValue(null);
    await expect(exchange()).rejects.toThrow('LEVEL_AGENT_CREDENTIALS_UNAVAILABLE');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('rejects non-HTTPS or credentialed connector origins before reading secrets', async () => {
    for (const origin of ['http://level.test', 'https://user:pass@level.test', 'https://level.test/path']) {
      connector = createLevelDelegatedConnector({ fetchImpl: fetchMock, getSecret, allowedScopes: ['orders.view'], origin });
      await expect(exchange()).rejects.toThrow('LEVEL_CONNECTOR_CONFIG_INVALID');
    }
    expect(fetchMock).not.toHaveBeenCalled();
    expect(getSecret).not.toHaveBeenCalled();
  });

  test('sanitizes HTTP error responses and performs no retry', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: 'invalid_grant', debug: `${assertion} ${clientSecret}` }, 403));
    const error = await exchange().catch((value) => value);
    expect(error.message).toBe('LEVEL_EXCHANGE_HTTP_403');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(error)).not.toContain(assertion);
    expect(JSON.stringify(error)).not.toContain(clientSecret);
  });
});
