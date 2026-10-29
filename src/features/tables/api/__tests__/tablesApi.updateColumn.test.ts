import { afterEach, describe, expect, it, vi } from 'vitest';
import { tablesApi } from '../tablesApi';

const okResponse = (data: Record<string, unknown>) =>
  ({ ok: true, json: async () => ({ data }) }) as unknown as Response;

describe('tablesApi.updateColumn key rename', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('maps name to column_name only when a key is provided', async () => {
    const fetchMock = vi.fn(async () => okResponse({ id: 59493, table_id: 100684, name: 'efefef', display_name: 'efefef', column_type: 'text' }));
    vi.stubGlobal('fetch', fetchMock);

    await tablesApi.updateColumn('100684', '59493', { name: 'efefef', displayName: 'efefef' });
    const renameBody = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(renameBody).toMatchObject({ column_name: 'efefef', display_name: 'efefef' });

    await tablesApi.updateColumn('100684', '59493', { displayName: 'only title' });
    const titleBody = JSON.parse((fetchMock.mock.calls[1] as unknown as [string, RequestInit])[1].body as string);
    expect(titleBody).not.toHaveProperty('column_name');
  });
});
