import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/tests/renderWithProviders';
import { apiClient } from '@/shared/utils/apiClient';
import { AgentConfigurationFields } from '../AgentConfigurationFields';
import type { AIAgent } from '@/features/ai-chat/types';
vi.mock('@/features/ai-chat/context/AIChatContext', () => ({ useAIChat: () => ({ loadAgents: vi.fn(), spaceId: 11 }) }));
vi.mock('@/shared/utils/apiClient', () => ({ apiClient: { get: vi.fn(), put: vi.fn() } }));
const agent = { id: 12, table_id: 1784, name: 'Agent', model: 'old', operator_id: 1 } as AIAgent;
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(apiClient.get).mockImplementation(async url => url.includes('passport-authority')
    ? { success: true, data: { allowed: false, reason: 'global_role_required', space: { id: 11 } } }
    : url.includes('/rows/')
    ? { success: true, data: { row: { data: { operator_id: 1, model: 'old', crm_instructions: 'CRM original', main_instructions: 'Main original' } } } }
    : { success: true, data: { models: [{ id: 1, model_id: 'old', name: 'Old' }] } });
  vi.mocked(apiClient.put).mockResolvedValue({ success: true });
});
it('loads authoritative instructions and saves only edited fields on the expanded agent', async () => {
  renderWithProviders(<AgentConfigurationFields agent={agent} operators={[{ id: 1, name: 'Provider' }]} disabled={false} />);
  const field = await screen.findByLabelText('CRM-инструкция');
  expect(field).toHaveValue('CRM original');
  expect(screen.getByLabelText('Основная инструкция')).toHaveValue('Main original');
  fireEvent.change(field, { target: { value: 'Updated CRM' } });
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
  await waitFor(() => expect(apiClient.put).toHaveBeenCalledWith('/ai/agents/12', { crm_instructions: 'Updated CRM' }));
});
it('keeps the edited text available after a failed save', async () => {
  vi.mocked(apiClient.put).mockRejectedValue(new Error('Save failed'));
  renderWithProviders(<AgentConfigurationFields agent={agent} operators={[]} disabled={false} />);
  fireEvent.change(await screen.findByLabelText('Основная инструкция'), { target: { value: 'Unsaved draft' } });
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Save failed');
  expect(screen.getByLabelText('Основная инструкция')).toHaveValue('Unsaved draft');
});

it('shows main instructions before CRM instructions', async () => {
  renderWithProviders(<AgentConfigurationFields agent={agent} operators={[]} disabled={false} />);
  const main = await screen.findByLabelText('Основная инструкция');
  const crm = screen.getByLabelText('CRM-инструкция');
  expect(main.compareDocumentPosition(crm) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

it('saves avatar emoji and color without overwriting instructions', async () => {
  renderWithProviders(<AgentConfigurationFields agent={agent} operators={[]} disabled={false} />);
  fireEvent.change(await screen.findByLabelText('Эмодзи аватара'), { target: { value: '🌟' } });
  fireEvent.change(screen.getByLabelText('Цвет аватара'), { target: { value: '#123456' } });
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
  await waitFor(() => expect(apiClient.put).toHaveBeenCalledWith('/ai/agents/12', { icon: '🌟', color: '#123456' }));
});


it('resolves a numeric model relation in the agent space and saves the selected model slug', async () => {
  vi.mocked(apiClient.get).mockImplementation(async url => url.includes('passport-authority')
    ? { success: true, data: { allowed: false, reason: 'global_role_required', space: { id: 11 } } }
    : url.includes('/rows/')
    ? { success: true, data: { row: { data: { operator_id: 31089, model: 186067 } } } }
    : { success: true, data: { models: [{ id: 186067, model_id: 'claude-fable-5', name: 'Claude Fable 5' }, { id: 186068, model_id: 'another-model', name: 'Another model' }] } });
  renderWithProviders(<AgentConfigurationFields agent={{ ...agent, space_id: 12 }} operators={[{ id: 31089, name: 'Claude Code CLI' }]} disabled={false} />);
  await waitFor(() => expect(screen.getByLabelText('Модель')).toHaveDisplayValue('Claude Fable 5'));
  expect(apiClient.get).toHaveBeenCalledWith('/ai/providers/31089/models?spaceId=12');
  expect(screen.getByLabelText('Оператор')).toHaveDisplayValue('Claude Code CLI');
  expect(screen.getByRole('button', { name: 'Сохранить' })).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Модель'), { target: { value: 'another-model' } });
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
  await waitFor(() => expect(apiClient.put).toHaveBeenCalledWith('/ai/agents/12', { model: 'another-model' }));
});

it('keeps the configured operator visible while the provider list loads', async () => {
  const configuredAgent = { ...agent, provider_id: 1, provider_name: 'Configured provider' };
  const { rerender } = renderWithProviders(<AgentConfigurationFields agent={configuredAgent} operators={[]} disabled={false} />);
  expect(await screen.findByLabelText('Оператор')).toHaveDisplayValue('Configured provider');
  rerender(<AgentConfigurationFields agent={configuredAgent} operators={[{ id: 1, name: 'Configured provider' }]} disabled={false} />);
  expect(screen.getByLabelText('Оператор')).toHaveValue('1');
  await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith('/ai/providers/1/models?spaceId=11'));
});
