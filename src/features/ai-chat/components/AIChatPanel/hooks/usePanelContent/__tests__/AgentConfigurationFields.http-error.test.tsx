import { fireEvent, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { createTestQueryClient, renderWithProviders } from '@/tests/renderWithProviders';
import { apiClient } from '@/shared/utils/apiClient';
import type { AIAgent } from '@/features/ai-chat/types';
import { AgentConfigurationFields } from '../AgentConfigurationFields';

vi.mock('@/features/ai-chat/context/AIChatContext', () => ({ useAIChat: () => ({ loadAgents: vi.fn(), spaceId: 11 }) }));
afterEach(() => vi.restoreAllMocks());

it.each([409, 403])('keeps the complete draft and cached row when real apiClient receives HTTP %s', async status => {
  apiClient.setAccessToken(null);
  const original = { name: 'Reviewer', slug: 'reviewer', color: '#334455', icon: '🤖', main_instructions: 'Original', crm_instructions: 'Original CRM' };
  const message = status === 409 ? "Slug 'frontend-qa' is already used by another agent in this table" : 'Permission denied';
  const writes: Array<{ url: string; body: unknown }> = [];
  vi.spyOn(global, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    const headers = { 'content-type': 'application/json' };
    if (init?.method === 'PUT') {
      writes.push({ url, body: JSON.parse(String(init.body)) });
      return new Response(JSON.stringify({ success: false, error: { code: status === 409 ? 'CONFLICT' : 'FORBIDDEN', message }, timestamp: '2026-09-30' }), { status, headers });
    }
    if (url.includes('passport-authority')) return new Response(JSON.stringify({ success: true, data: { allowed: false, reason: 'global_role_required', space: { id: 11 } } }), { headers });
    if (url === '/api/v3/tables/1784/rows/12') return new Response(JSON.stringify({ success: true, data: { row: { data: original } } }), { headers });
    throw new Error(`Unexpected request: ${url}`);
  });
  const queryClient = createTestQueryClient();
  const dirty = vi.fn();
  renderWithProviders(<AgentConfigurationFields agent={{ id: 12, table_id: 1784, name: 'Reviewer' } as AIAgent} operators={[]} disabled={false} onDirtyChange={dirty} />, { queryClient });
  const draft = [
    ['Имя агента', 'Conflict draft'], ['Slug агента', 'frontend-qa'], ['Цвет аватара', '#556677'],
    ['Эмодзи аватара', '🐈'], ['Основная инструкция', 'Draft instructions'], ['CRM-инструкция', 'Draft CRM'],
  ];
  await screen.findByLabelText('Имя агента');
  for (const [label, value] of draft) fireEvent.change(screen.getByLabelText(label), { target: { value } });
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
  expect((await screen.findByRole('alert')).textContent).toBe(message);
  for (const [label, value] of draft) expect(screen.getByLabelText(label)).toHaveValue(value);
  expect(screen.getByRole('button', { name: 'Сохранить' })).toBeEnabled();
  expect(dirty).not.toHaveBeenCalledWith(false);
  expect(queryClient.getQueryData(['agent-configuration', 1784, 12])).toEqual(original);
  expect(writes).toEqual([{ url: '/api/v3/ai/agents/12/configuration', body: { data: {
    name: 'Conflict draft', slug: 'frontend-qa', color: '#556677', icon: '🐈', main_instructions: 'Draft instructions', crm_instructions: 'Draft CRM',
  } } }]);
});
