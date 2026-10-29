// @vitest-environment node
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ dbGet: vi.fn(), key: vi.fn(), fetch: vi.fn(), warn: vi.fn() }));
vi.mock('../../../database/connection.js', () => ({ dbGet: mocks.dbGet, withTransactionAsync: vi.fn() }));
vi.mock('../../secrets/SecretsVault.js', () => ({ default: { getSecret: mocks.key } }));
vi.mock('../../../utils/logger.js', () => ({ aiLogger: { warn: mocks.warn, info: vi.fn() } }));
import { generateVideo } from '../seedance-video.js';
const context = { spaceId: 7828, conversationId: 3761 };
const key = 'r8_fixture_private_token';
const run = () => generateVideo({ prompt: 'fixture' }, 1, context);
beforeEach(() => {
  vi.clearAllMocks();
  mocks.dbGet.mockResolvedValue({ id: 3761, space_id: 7828 });
  mocks.key.mockResolvedValue(key);
  vi.stubGlobal('fetch', mocks.fetch);
});
afterEach(() => vi.unstubAllGlobals());

describe('Seedance create failure diagnostics (offline)', () => {
  it('preserves a 402 explanation and request ID in the result and logger without retrying', async () => {
    mocks.fetch.mockResolvedValue(new Response(JSON.stringify({ detail: 'Credit limit reached', title: 'Payment required' }), {
      status: 402, headers: { 'x-request-id': 'req-402-test', 'content-type': 'application/json' },
    }));
    const result = await run();
    expect(result).toEqual({ error: 'VIDEO_CREATE_HTTP_402', provider_error: {
      stage: 'create', http_status: 402, detail: 'Credit limit reached', request_id: 'req-402-test',
    } });
    expect(mocks.warn).toHaveBeenCalledWith(expect.objectContaining({ provider_error: result.provider_error }), 'Seedance request failed');
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });
  it('removes echoed credentials and URLs before returning or logging diagnostics', async () => {
    mocks.fetch.mockResolvedValue(new Response(JSON.stringify({
      detail: `Denied ${key}; Bearer another-secret; token=hidden-token; https://files.test/private?signature=hidden-signature; r8_other_private`,
      input: { prompt: 'private-prompt' }, authorization: 'hidden-header',
    }), { status: 402, headers: { 'x-request-id': key, 'set-cookie': 'session=hidden-cookie' } }));
    const result = await run();
    expect(result.provider_error.detail).toContain('Denied');
    const output = JSON.stringify([result, mocks.warn.mock.calls]);
    for (const secret of [key, 'another-secret', 'hidden-token', 'hidden-signature', 'r8_other_private', 'private-prompt', 'hidden-header', 'hidden-cookie']) expect(output).not.toContain(secret);
    expect(result.provider_error.request_id).toBeUndefined();
  });
  it.each(['not json secret', '<html>secret</html>', JSON.stringify({ detail: { token: 'secret' }, title: 'Payment required' })])('keeps the HTTP code for an unexpected body: %s', async body => {
    mocks.fetch.mockResolvedValue(new Response(body, { status: 402, headers: { 'x-request-id': 'req-body' } }));
    const result = await run();
    expect(result.error).toBe('VIDEO_CREATE_HTTP_402');
    expect(result.provider_error.request_id).toBe('req-body');
    expect(JSON.stringify([result, mocks.warn.mock.calls])).not.toContain('secret');
    expect(result.submission_unknown).toBeUndefined();
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });
  it('caps the sanitized explanation and removes control characters', async () => {
    mocks.fetch.mockResolvedValue(new Response(JSON.stringify({ detail: 'Payment\n\u001b[31m ' + 'x'.repeat(1500) }), { status: 402 }));
    const result = await run();
    expect(result.provider_error.detail.length).toBeLessThanOrEqual(512);
    expect(result.provider_error.detail).not.toMatch(/[\u0000-\u001f\u007f]/);
  });
  it('stops reading oversized bodies and still retains the request ID', async () => {
    const cancel = vi.fn();
    const body = new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(9000)); }, cancel });
    mocks.fetch.mockResolvedValue(new Response(body, { status: 402, headers: { 'x-request-id': 'req-large' } }));
    expect(await run()).toMatchObject({ error: 'VIDEO_CREATE_HTTP_402', provider_error: { request_id: 'req-large' } });
    expect(cancel).toHaveBeenCalled();
  });
  it.each([402, 503])('preserves HTTP %s and ambiguity when reading diagnostics fails', async status => {
    const body = new ReadableStream({ start(controller) { controller.error(new Error(key)); } });
    mocks.fetch.mockResolvedValue(new Response(body, { status, headers: { 'x-request-id': 'req-read' } }));
    const result = await run();
    expect(result.error).toBe(`VIDEO_CREATE_HTTP_${status}`);
    expect(result.provider_error).toMatchObject({ http_status: status, request_id: 'req-read' });
    expect(result.submission_unknown).toBe(status >= 500 ? true : undefined);
    expect(JSON.stringify([result, mocks.warn.mock.calls])).not.toContain(key);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });
  it('retains submission_unknown for a network failure with no raw exception', async () => {
    mocks.fetch.mockRejectedValue(new Error(key));
    expect(await run()).toMatchObject({ error: 'VIDEO_REQUEST_FAILED', submission_unknown: true });
    expect(JSON.stringify(mocks.warn.mock.calls)).not.toContain(key);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });
});
