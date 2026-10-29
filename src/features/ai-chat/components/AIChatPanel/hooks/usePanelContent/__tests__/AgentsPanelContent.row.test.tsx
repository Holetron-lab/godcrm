import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/tests/renderWithProviders';
import { AgentsPanelContent } from '../AgentsPanelContent';
import type { PanelContentDeps } from '../PanelContentTypes';
import type { AIAgent } from '../../../../../types';

beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', class {
    observe() { /* noop */ }
    disconnect() { /* noop */ }
  });
});
afterEach(() => vi.unstubAllGlobals());

const evoke = { id: 1, name: 'Evoke', description: 'Image agent', icon: '🎨', color: '#22c55e', is_active: true } as unknown as AIAgent;
const locked = { id: 2, name: 'Frontend Developer', description: 'React 19 UI', icon: '🖌️', color: '#14b8a6', is_active: true, visibility: 'locked' } as unknown as AIAgent;

function makeDeps(overrides: Partial<PanelContentDeps> = {}) {
  return {
    filteredAgents: [evoke], agentsSearch: '', setAgentsSearch: vi.fn(), setVectorSearchResults: vi.fn(),
    showFavoriteAgents: false, setShowFavoriteAgents: vi.fn(), favoriteAgents: [], setFavoriteAgents: vi.fn(),
    isLoadingAgents: false, operators: [], defaultAgentId: null, summaryAgentId: null, translationAgentId: null,
    handleAgentSelect: vi.fn(), unlockAgent: vi.fn().mockResolvedValue(undefined), isAdminOrOwner: false,
    createTablesMutation: { mutate: vi.fn() },
    ...overrides,
  } as unknown as PanelContentDeps;
}

describe('AgentsPanelContent row', () => {
  it('tints the avatar backing with the agent colour and marks the row with a bot icon instead of an "Agent" pill', () => {
    renderWithProviders(<AgentsPanelContent {...makeDeps()} />, { language: 'en' });
    const avatar = screen.getByLabelText('Evoke');
    expect(avatar.style.backgroundColor).toMatch(/#22c55e33|rgba\(34, 197, 94/);
    expect(screen.getByRole('img', { name: 'Agent' })).toBeInTheDocument();
    expect(screen.queryByText('Agent')).toBeNull();
  });

  it('shows a locked Tier-B agent with a lock and lets the owner unlock it instead of selecting it', async () => {
    const deps = makeDeps({ filteredAgents: [evoke, locked], isAdminOrOwner: true });
    renderWithProviders(<AgentsPanelContent {...deps} />, { language: 'en' });
    expect(screen.getByRole('img', { name: 'Locked — unlock to use' })).toBeInTheDocument();
    fireEvent.click(screen.getByText('Frontend Developer'));
    expect(deps.handleAgentSelect).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTitle('Unlock agent'));
    await waitFor(() => expect(deps.unlockAgent).toHaveBeenCalledWith(locked));
    fireEvent.click(screen.getByText('Evoke'));
    expect(deps.handleAgentSelect).toHaveBeenCalledWith(evoke);
  });
});
