import { fireEvent, screen, waitFor } from '@testing-library/react';
import { expect, it, vi, beforeEach } from 'vitest';
import { renderWithProviders } from '@/tests/renderWithProviders';
import { apiClient } from '@/shared/utils/apiClient';
import { ConversationDescription } from '../ConversationDescription';
vi.mock('@/shared/utils/apiClient', () => ({ apiClient: { get: vi.fn(), patch: vi.fn(), post: vi.fn() } }));
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(apiClient.get).mockResolvedValue({ success: true, data: { settings: { description: 'Existing description' } } });
  vi.mocked(apiClient.patch).mockResolvedValue({ success: true });
  vi.mocked(apiClient.post).mockResolvedValue({ success: true, data: { summary: { summary: 'Generated description' } } });
});
it('autofills a draft using the summary agent, then saves only the description', async () => {
  renderWithProviders(<ConversationDescription conversationId={7} summaryAgentId={22} onSaved={vi.fn()} />);
  const field = await screen.findByDisplayValue('Existing description');
  fireEvent.click(screen.getByRole('button', { name: 'Заполнить через саммари-агента' }));
  await waitFor(() => expect(field).toHaveValue('Generated description'));
  expect(apiClient.post).toHaveBeenCalledWith('/chat/conversations/7/summaries', { summary_agent_id: 22 });
  expect(apiClient.patch).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
  await waitFor(() => expect(apiClient.patch).toHaveBeenCalledWith('/chat/conversations/7/settings', { description: 'Generated description' }));
});
it('preserves a description draft when saving fails', async () => {
  vi.mocked(apiClient.patch).mockRejectedValue(new Error('Offline'));
  renderWithProviders(<ConversationDescription conversationId={7} onSaved={vi.fn()} />);
  const field = await screen.findByDisplayValue('Existing description');
  fireEvent.change(field, { target: { value: 'Keep draft' } });
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Offline');
  expect(field).toHaveValue('Keep draft');
});

it('saves the chat emoji without overwriting its description and retains drafts on failure', async () => {
  vi.mocked(apiClient.patch).mockRejectedValueOnce(new Error('Offline'));
  renderWithProviders(<ConversationDescription conversationId={7} onSaved={vi.fn()} />);
  const emoji = await screen.findByLabelText('Эмодзи аватара');
  fireEvent.change(emoji, { target: { value: '🌟' } });
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Offline');
  expect(emoji).toHaveValue('🌟');
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
  await waitFor(() => expect(apiClient.patch).toHaveBeenLastCalledWith('/chat/conversations/7/settings', { icon: '🌟' }));
});

it('loads and saves chat color independently and preserves it on a failed save', async () => {
  vi.mocked(apiClient.get).mockResolvedValue({ success: true, data: { settings: JSON.stringify({ description: 'Existing description', icon: '🌍', color: '#123456' }) } });
  vi.mocked(apiClient.patch).mockRejectedValueOnce(new Error('Offline'));
  const onSaved = vi.fn();
  renderWithProviders(<ConversationDescription conversationId={7} onSaved={onSaved} />);
  const color = await screen.findByLabelText('Цвет аватара');
  expect(color).toHaveValue('#123456');
  fireEvent.change(color, { target: { value: '#abcdef' } });
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Offline');
  expect(color).toHaveValue('#abcdef');
  expect(onSaved).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
  await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
  expect(apiClient.patch).toHaveBeenLastCalledWith('/chat/conversations/7/settings', { color: '#abcdef' });
  expect(screen.getByDisplayValue('Existing description')).toBeInTheDocument();
});
