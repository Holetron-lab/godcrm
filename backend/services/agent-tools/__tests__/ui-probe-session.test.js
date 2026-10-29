import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const page = { on: vi.fn(), goto: vi.fn(async () => ({ status: () => 200 })), url: () => 'https://devcrm.hltrn.cc/spaces', title: async () => 'CRM' };
  const ctx = { setDefaultTimeout: vi.fn(), addCookies: vi.fn(), addInitScript: vi.fn(), newPage: vi.fn(async () => page) };
  const browser = { newContext: vi.fn(async () => ctx), close: vi.fn(async () => {}) };
  return { ctx, browser, launch: vi.fn(async () => browser) };
});
vi.mock('playwright', () => ({ chromium: { launch: mocks.launch } }));
vi.mock('../../../utils/logger.js', () => ({ aiLogger: { info: vi.fn() } }));
vi.mock('../../../database/connection.js', () => ({ dbRun: vi.fn(), sqlNow: vi.fn() }));
import { uiToolHandlers } from '../ui-tools.js';

beforeEach(() => vi.clearAllMocks());
describe('ui_probe session bootstrap', () => {
  it('hydrates the CRM store before navigation and scopes credentials to the starting origin', async () => {
    const result = await uiToolHandlers.ui_probe({ url: 'https://devcrm.hltrn.cc/spaces', auth_token: 'qa-test-token', screenshot: false }, 8974, {});
    expect(result.ok).toBe(true);
    const { storageState } = mocks.browser.newContext.mock.calls[0][0];
    expect(storageState.origins).toEqual([{ origin: 'https://devcrm.hltrn.cc', localStorage: [{ name: 'god-crm-auth', value: JSON.stringify({ state: { token: 'qa-test-token', user: null }, version: 0 }) }] }]);
    expect(storageState.cookies).toEqual([]);
    expect(mocks.ctx.addInitScript).not.toHaveBeenCalled();
    expect(mocks.ctx.addCookies).toHaveBeenCalledWith([{ name: 'access_token', value: 'qa-test-token', url: 'https://devcrm.hltrn.cc' }]);
    expect(JSON.stringify(result)).not.toContain('qa-test-token');
  });
  it('leaves unauthenticated runs with an empty browser context', async () => {
    await uiToolHandlers.ui_probe({ url: 'https://devcrm.hltrn.cc/', screenshot: false }, 8974, {});
    expect(mocks.browser.newContext.mock.calls[0][0].storageState).toBeUndefined();
    expect(mocks.ctx.addCookies).not.toHaveBeenCalled();
    expect(mocks.ctx.addInitScript).not.toHaveBeenCalled();
  });
});
