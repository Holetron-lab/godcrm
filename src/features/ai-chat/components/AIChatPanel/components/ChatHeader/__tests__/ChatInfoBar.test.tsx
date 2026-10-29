import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders as render } from '@/tests/renderWithProviders';
import { ChatInfoBar } from '../ChatHeaderFull';

vi.mock('lucide-react', async () => (await import('@/tests/lucideMock')).lucideMock());

const props = {
  chatMode: 'people' as const,
  togglePanel: vi.fn(),
  chatPartner: { type: 'group' as const, id: 1, name: 'Команда' },
  setChatPartner: vi.fn(),
  chatParticipants: [{ id: 1, name: 'Владелец' }, { id: 2, name: 'Frontend' }, { id: 3, name: 'QA' }],
  resolvedConvTitle: 'Команда',
  currentConversationId: null,
  userConversationId: 3660,
  renameConversation: vi.fn(),
  conversationMode: 'group' as const,
};

describe('ChatInfoBar agent presence', () => {
  it('highlights running participants and clears them when they finish', () => {
    const { rerender } = render(<ChatInfoBar {...props} activeAgents={[
      { agent_user_id: 2, agent_name: 'Frontend', inflight_status: 'running' },
      { agent_user_id: 3, agent_name: 'QA', inflight_status: 'paused' },
    ]} />);
    expect(screen.getByText('Frontend').className).toContain('text-green-600');
    expect(screen.getByText('Frontend').querySelector('[aria-hidden]')?.className).toContain('motion-safe:animate-pulse');
    expect(screen.getByText('QA').className).not.toContain('text-green');
    expect(screen.getByText('Владелец').className).not.toContain('text-green');
    rerender(<ChatInfoBar {...props} activeAgents={[]} isAgentProcessing={false} />);
    expect(screen.getByText('Frontend').className).not.toContain('text-green');
  });

  it('uses the legacy processing name when the active-agent list is unavailable', () => {
    render(<ChatInfoBar {...props} isAgentProcessing processingAgentName="Frontend" />);
    expect(screen.getByText('Frontend').className).toContain('text-green-600');
    expect(screen.queryByText('Frontend работает...')).toBeNull();
  });
});
