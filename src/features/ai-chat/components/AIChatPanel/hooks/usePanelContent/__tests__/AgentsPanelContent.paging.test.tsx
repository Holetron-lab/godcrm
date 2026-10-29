import { act, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/tests/renderWithProviders';
import { AgentsPanelContent } from '../AgentsPanelContent';
import type { PanelContentDeps } from '../PanelContentTypes';
import type { AIAgent } from '../../../../../types';

// jsdom has no IntersectionObserver; capture the callback so the test can scroll the sentinel into view.
let intersect: (() => void) | undefined;
beforeEach(() => {
  intersect = undefined;
  vi.stubGlobal('IntersectionObserver', class {
    constructor(callback: (entries: { isIntersecting: boolean }[]) => void) { intersect = () => callback([{ isIntersecting: true }]); }
    observe() { /* captured above */ }
    disconnect() { /* noop */ }
  });
});
afterEach(() => vi.unstubAllGlobals());

const agents = Array.from({ length: 45 }, (_, index) => ({ id: index + 1, name: `Agent ${index + 1}`, is_active: true })) as unknown as AIAgent[];
const deps = {
  filteredAgents: agents, agentsSearch: '', setAgentsSearch: vi.fn(), setVectorSearchResults: vi.fn(),
  showFavoriteAgents: false, setShowFavoriteAgents: vi.fn(), favoriteAgents: [], setFavoriteAgents: vi.fn(),
  isLoadingAgents: false, operators: [], defaultAgentId: null, summaryAgentId: null, translationAgentId: null,
  handleAgentSelect: vi.fn(), isAdminOrOwner: false, createTablesMutation: { mutate: vi.fn() },
} as unknown as PanelContentDeps;

it('reveals agents in pages as the sentinel scrolls into view, like contacts', () => {
  renderWithProviders(<AgentsPanelContent {...deps} />);
  expect(screen.getAllByText(/^Agent \d+$/)).toHaveLength(30);
  expect(screen.getByText('30 / 45')).toBeInTheDocument();
  act(() => intersect?.());
  expect(screen.getAllByText(/^Agent \d+$/)).toHaveLength(45);
  expect(screen.queryByText(/\/ 45/)).not.toBeInTheDocument();
  expect(screen.getByText('45')).toBeInTheDocument();
});
