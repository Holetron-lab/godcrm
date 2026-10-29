import type { ReactNode } from 'react';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '@/shared/utils/apiClient';
import { useMailMessagesMulti, useUpdateMessage } from './useMail';
import { mailApi } from '../api/mailApi';
import type { MailFolderId, MailMessage } from '../types';

const message = (n: number, folder: MailFolderId = 'inbox'): MailMessage => ({
  id: `${folder}-${n}`, folder, fromName: 'Sender', fromAddress: 'sender@example.test',
  to: [], subject: `Message ${n}`, preview: '', body: '', read: false,
  date: new Date(Date.UTC(2026, 0, 1, 0, -n)).toISOString(),
});

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, wrapper };
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('mail pagination', () => {
  it('sends the page offset and limit to the existing endpoint', async () => {
    const get = vi.spyOn(apiClient, 'get').mockResolvedValue({ data: { messages: [] } });
    await mailApi.messages(11, 'inbox', 7, 50);
    expect(get).toHaveBeenCalledWith('/spaces/11/mail/messages?folder=inbox&limit=50&offset=50&connector_id=7');
  });

  it('loads beyond 50, stops at the last page, and isolates mailbox/folder/space', async () => {
    const get = vi.spyOn(mailApi, 'messages').mockImplementation(async (_space, folder, _conn, offset = 0) =>
      Array.from({ length: 73 }, (_, n) => message(n, folder)).slice(offset, offset + 50));
    const { wrapper } = setup();
    const { result, rerender } = renderHook(
      ({ space, folders, connector }: { space: number; folders: MailFolderId[]; connector: number }) =>
        useMailMessagesMulti(space, folders, connector),
      { wrapper, initialProps: { space: 11, folders: ['inbox'], connector: 7 } }
    );
    await waitFor(() => expect(result.current.data).toHaveLength(50));
    expect(result.current.hasNextPage).toBe(true);
    await act(async () => { await result.current.fetchNextPage(); });
    await waitFor(() => expect(result.current.data).toHaveLength(73));
    expect(result.current.data[50].id).toBe('inbox-50');
    expect(result.current.hasNextPage).toBe(false);
    expect(get).toHaveBeenCalledWith(11, 'inbox', 7, 50);
    for (const props of [
      { space: 11, folders: ['inbox'] as MailFolderId[], connector: 8 },
      { space: 11, folders: ['sent'] as MailFolderId[], connector: 8 },
      { space: 12, folders: ['sent'] as MailFolderId[], connector: 8 },
    ]) {
      rerender(props);
      await waitFor(() => expect(result.current.data).toHaveLength(50));
      expect(get).toHaveBeenCalledWith(props.space, props.folders[0], props.connector, 0);
    }
  });

  it('paginates selected folders independently and sorts without duplicates', async () => {
    const get = vi.spyOn(mailApi, 'messages').mockImplementation(async (_space, folder, _conn, offset = 0) => {
      const rows = Array.from({ length: folder === 'inbox' ? 51 : 2 }, (_, n) => message(n, folder));
      if (folder === 'sent') rows[0] = message(0);
      return rows.slice(offset, offset + 50);
    });
    const { wrapper } = setup();
    const { result } = renderHook(() => useMailMessagesMulti(11, ['inbox', 'sent'], 7), { wrapper });
    await waitFor(() => expect(result.current.data).toHaveLength(51));
    await act(async () => { await result.current.fetchNextPage(); });
    await waitFor(() => expect(result.current.data).toHaveLength(52));
    expect(result.current.hasNextPage).toBe(false);
    expect(get).not.toHaveBeenCalledWith(11, 'sent', 7, 50);
    expect(result.current.data.map(m => m.date)).toEqual(result.current.data.map(m => m.date).sort().reverse());
  });

  it('preserves loaded rows on a page error and retries the same offset', async () => {
    vi.spyOn(mailApi, 'messages')
      .mockResolvedValueOnce(Array.from({ length: 50 }, (_, n) => message(n)))
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce([message(50)]);
    const { wrapper } = setup();
    const { result } = renderHook(() => useMailMessagesMulti(11, ['inbox'], 7), { wrapper });
    await waitFor(() => expect(result.current.data).toHaveLength(50));
    await act(async () => { await result.current.fetchNextPage(); });
    await waitFor(() => expect(result.current.isFetchNextPageError).toBe(true));
    expect(result.current.data).toHaveLength(50);
    await act(async () => { await result.current.fetchNextPage(); });
    await waitFor(() => expect(result.current.data).toHaveLength(51));
    expect(result.current.isFetchNextPageError).toBe(false);
  });

  it('optimistically updates later pages and rolls back a failed mutation', async () => {
    vi.spyOn(mailApi, 'messages').mockImplementation(async (_space, folder, _conn, offset = 0) =>
      Array.from({ length: 51 }, (_, n) => message(n, folder)).slice(offset, offset + 50));
    let rejectUpdate!: (error: Error) => void;
    vi.spyOn(mailApi, 'update').mockImplementation(() => new Promise((_resolve, reject) => { rejectUpdate = reject; }));
    const { wrapper } = setup();
    const { result } = renderHook(() => ({ list: useMailMessagesMulti(11, ['inbox'], 7), update: useUpdateMessage(11) }), { wrapper });
    await waitFor(() => expect(result.current.list.data).toHaveLength(50));
    await act(async () => { await result.current.list.fetchNextPage(); });
    act(() => result.current.update.mutate({ id: 'inbox-50', patch: { starred: true } }));
    await waitFor(() => expect(result.current.list.data[50].starred).toBe(true));
    act(() => rejectUpdate(new Error('offline')));
    await waitFor(() => expect(result.current.list.data[50].starred).not.toBe(true));
  });
});
