// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const post = vi.hoisted(() => vi.fn());
vi.mock('axios', () => ({ default: { post } }));

const { getConnectorType, listConnectorTypes, validateConnectorTypeBody } = await import(
  '../../services/connectors/catalogue/index.js'
);
const { connectorRequirements, connectorToolHandlers: handlers } = await import(
  '../../services/agent-tools/connector-tools.js'
);
const { buildToolList } = await import('../../services/mcp/buildToolList.js');

const token = '123456:telegram-fixture-secret';
const context = {
  spaceId: 11,
  injected_connector: {
    type_slug: 'telegram',
    access_token: token,
    account_label: 'Fixture bot',
    custom_fields: { default_chat_id: '-1001234567890' },
  },
};

beforeEach(() => vi.clearAllMocks());

describe('Telegram connector catalogue', () => {
  it('registers an api_key connector with a token and optional default chat', () => {
    const type = getConnectorType('telegram');
    expect(type).toMatchObject({ slug: 'telegram', auth_kind: 'api_key', refresh_supported: false });
    expect(type.fields.map(field => field.key)).toEqual(['access_token', 'default_chat_id']);
    expect(listConnectorTypes().map(item => item.slug)).toContain('telegram');
  });

  it('validates the token and accepts numeric IDs and @channel usernames', () => {
    expect(validateConnectorTypeBody('telegram', { fields: { access_token: token } })).toEqual({ ok: true });
    for (const default_chat_id of ['-1001234567890', '@fixture_channel']) {
      expect(validateConnectorTypeBody('telegram', { fields: { access_token: token, default_chat_id } })).toEqual({ ok: true });
    }
    expect(validateConnectorTypeBody('telegram', {}).ok).toBe(false);
    expect(validateConnectorTypeBody('telegram', { fields: { access_token: '' } }).ok).toBe(false);
    expect(validateConnectorTypeBody('telegram', { fields: { access_token: token, default_chat_id: '' } }).ok).toBe(false);
  });

  it('checks the token with getMe and returns only public bot identity', async () => {
    post.mockResolvedValueOnce({ data: { ok: true, result: { id: 42, first_name: 'Fixture', username: 'fixture_bot' } } });
    const result = await getConnectorType('telegram').test({ access_token: token });
    expect(result).toEqual({ ok: true, account_label: '@fixture_bot' });
    expect(post).toHaveBeenCalledWith(`https://api.telegram.org/bot${token}/getMe`, {}, expect.objectContaining({ timeout: 10_000 }));
    expect(JSON.stringify(result)).not.toContain(token);
  });

  it('reports Telegram authentication failures without exposing the token', async () => {
    post.mockResolvedValueOnce({ data: { ok: false, error_code: 401, description: 'Unauthorized' } });
    expect(await getConnectorType('telegram').test({ access_token: token })).toEqual({ ok: false, error: 'Unauthorized' });
    post.mockRejectedValueOnce(new Error(`request to bot${token} failed`));
    const result = await getConnectorType('telegram').test({ access_token: token });
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain(token);
  });
});

describe('telegram_send_message tool', () => {
  it('is advertised on the canonical MCP surface with a connector requirement', () => {
    expect(buildToolList().find(tool => tool.name === 'telegram_send_message')).toBeDefined();
    expect(connectorRequirements.telegram_send_message).toBe('telegram');
  });

  it('sends to an explicit chat with the requested parse mode', async () => {
    post.mockResolvedValueOnce({ data: { ok: true, result: { message_id: 91, date: 1780000000, chat: { id: 472071862, type: 'private' } } } });
    const result = await handlers.telegram_send_message({ chat_id: 472071862, text: '<b>Hello</b>', parse_mode: 'HTML' }, 1, context);
    expect(result).toMatchObject({ ok: true, message_id: 91, chat_id: 472071862, account_label: 'Fixture bot' });
    expect(post).toHaveBeenCalledWith(`https://api.telegram.org/bot${token}/sendMessage`, {
      chat_id: 472071862,
      text: '<b>Hello</b>',
      parse_mode: 'HTML',
    }, expect.objectContaining({ timeout: 10_000 }));
    expect(JSON.stringify(result)).not.toContain(token);
  });

  it('uses the connector default chat when chat_id is omitted', async () => {
    post.mockResolvedValueOnce({ data: { ok: true, result: { message_id: 92, chat: { id: -1001234567890 } } } });
    const result = await handlers.telegram_send_message({ text: 'Hello' }, 1, context);
    expect(result).toMatchObject({ ok: true, message_id: 92, chat_id: -1001234567890 });
    expect(post.mock.calls[0][1]).toEqual({ chat_id: '-1001234567890', text: 'Hello' });
  });

  it.each([
    {},
    { text: '' },
    { text: 'x'.repeat(4097) },
    { text: 'Hello', parse_mode: 'markdown' },
    { text: 'Hello', chat_id: '' },
  ])('rejects invalid input before network: %j', async args => {
    expect(await handlers.telegram_send_message(args, 1, context)).toHaveProperty('error', 'bad_args');
    expect(post).not.toHaveBeenCalled();
  });

  it('requires server-injected Telegram credentials', async () => {
    for (const ctx of [{}, { injected_connector: { ...context.injected_connector, type_slug: 'slack' } }]) {
      expect(await handlers.telegram_send_message({ text: 'Hello' }, 1, ctx)).toEqual({
        error: 'connector_not_injected', expected: 'telegram',
      });
    }
    expect(post).not.toHaveBeenCalled();
  });

  it('normalizes API errors and redacts tokens from network failures', async () => {
    post.mockResolvedValueOnce({ data: { ok: false, error_code: 403, description: 'Forbidden: bot was blocked by the user' } });
    expect(await handlers.telegram_send_message({ text: 'Hello' }, 1, context)).toEqual({
      error: 'telegram_api_403', message: 'Forbidden: bot was blocked by the user',
    });
    post.mockRejectedValueOnce(new Error(`request to bot${token} failed`));
    const result = await handlers.telegram_send_message({ text: 'Hello' }, 1, context);
    expect(result).toHaveProperty('error', 'telegram_request_failed');
    expect(JSON.stringify(result)).not.toContain(token);
  });
});
