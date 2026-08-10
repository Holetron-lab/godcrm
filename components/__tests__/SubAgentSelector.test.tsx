/**
 * SubAgentSelector Component Tests
 * Rewritten for database-driven agents with numeric row_ids
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SubAgentSelector, type AvailableAgent } from '../SubAgentSelector';

// Mock useLanguage
vi.mock('@/shared/i18n/LanguageContext', () => ({
  useLanguage: () => ({
    language: 'en',
    setLanguage: vi.fn(),
    t: (key: string) => {
      const map: Record<string, string> = {
        'chat.subAgents': 'Sub-agents',
        'chat.noAgentsAvailable': 'No agents available',
      };
      return map[key] ?? key;
    },
  }),
}));

const mockAgents: AvailableAgent[] = [
  { row_id: 1, name: 'Translator', icon: '\uD83C\uDF10', description: 'Translates messages automatically' },
  { row_id: 2, name: 'Summarizer', icon: '\uD83D\uDCC4', description: 'Creates summaries of long discussions' },
  { row_id: 3, name: 'Vector Search', icon: '\uD83D\uDD0D', description: 'Semantic search in knowledge base' },
];

describe('SubAgentSelector', () => {
  const mockOnChange = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders all available agents', () => {
    render(
      <SubAgentSelector
        value={[]}
        onChange={mockOnChange}
        availableAgents={mockAgents}
      />
    );

    expect(screen.getByText('Translator')).toBeInTheDocument();
    expect(screen.getByText('Summarizer')).toBeInTheDocument();
    expect(screen.getByText('Vector Search')).toBeInTheDocument();
  });

  it('shows header label', () => {
    render(
      <SubAgentSelector
        value={[]}
        onChange={mockOnChange}
        availableAgents={mockAgents}
      />
    );

    expect(screen.getByText('Sub-agents')).toBeInTheDocument();
  });

  it('shows descriptions for each agent', () => {
    render(
      <SubAgentSelector
        value={[]}
        onChange={mockOnChange}
        availableAgents={mockAgents}
      />
    );

    expect(screen.getByText('Translates messages automatically')).toBeInTheDocument();
    expect(screen.getByText('Creates summaries of long discussions')).toBeInTheDocument();
    expect(screen.getByText('Semantic search in knowledge base')).toBeInTheDocument();
  });

  it('shows agent icon emoji', () => {
    render(
      <SubAgentSelector
        value={[]}
        onChange={mockOnChange}
        availableAgents={mockAgents}
      />
    );

    expect(screen.getByText('\uD83C\uDF10')).toBeInTheDocument();
    expect(screen.getByText('\uD83D\uDCC4')).toBeInTheDocument();
    expect(screen.getByText('\uD83D\uDD0D')).toBeInTheDocument();
  });

  it('adds agent row_id when toggled on', () => {
    render(
      <SubAgentSelector
        value={[]}
        onChange={mockOnChange}
        availableAgents={mockAgents}
      />
    );

    fireEvent.click(screen.getByText('Translator').closest('button')!);

    expect(mockOnChange).toHaveBeenCalledWith([1]);
  });

  it('removes agent row_id when toggled off', () => {
    render(
      <SubAgentSelector
        value={[1, 2]}
        onChange={mockOnChange}
        availableAgents={mockAgents}
      />
    );

    fireEvent.click(screen.getByText('Translator').closest('button')!);

    expect(mockOnChange).toHaveBeenCalledWith([2]);
  });

  it('preserves other selected agents when toggling', () => {
    render(
      <SubAgentSelector
        value={[1]}
        onChange={mockOnChange}
        availableAgents={mockAgents}
      />
    );

    fireEvent.click(screen.getByText('Vector Search').closest('button')!);

    expect(mockOnChange).toHaveBeenCalledWith([1, 3]);
  });

  it('reflects selected state visually', () => {
    render(
      <SubAgentSelector
        value={[2]}
        onChange={mockOnChange}
        availableAgents={mockAgents}
      />
    );

    const summaryButton = screen.getByText('Summarizer').closest('button');
    expect(summaryButton).toHaveClass('bg-[var(--color-primary-500)]/10');
  });

  it('does not call onChange when disabled', () => {
    render(
      <SubAgentSelector
        value={[]}
        onChange={mockOnChange}
        availableAgents={mockAgents}
        disabled={true}
      />
    );

    fireEvent.click(screen.getByText('Translator').closest('button')!);

    expect(mockOnChange).not.toHaveBeenCalled();
  });

  it('shows loading state', () => {
    render(
      <SubAgentSelector
        value={[]}
        onChange={mockOnChange}
        availableAgents={[]}
        isLoading={true}
      />
    );

    expect(screen.getByTestId('sub-agent-loading')).toBeInTheDocument();
    expect(screen.queryByTestId('sub-agent-empty')).not.toBeInTheDocument();
  });

  it('shows empty state when no agents available', () => {
    render(
      <SubAgentSelector
        value={[]}
        onChange={mockOnChange}
        availableAgents={[]}
      />
    );

    expect(screen.getByTestId('sub-agent-empty')).toBeInTheDocument();
    expect(screen.getByText('No agents available')).toBeInTheDocument();
  });

  it('does not show empty state while loading', () => {
    render(
      <SubAgentSelector
        value={[]}
        onChange={mockOnChange}
        availableAgents={[]}
        isLoading={true}
      />
    );

    expect(screen.queryByTestId('sub-agent-empty')).not.toBeInTheDocument();
  });

  it('renders agent without description', () => {
    const agentNoDesc: AvailableAgent[] = [
      { row_id: 10, name: 'Simple Agent' },
    ];

    render(
      <SubAgentSelector
        value={[]}
        onChange={mockOnChange}
        availableAgents={agentNoDesc}
      />
    );

    expect(screen.getByText('Simple Agent')).toBeInTheDocument();
  });

  it('renders agent without icon using fallback Bot icon', () => {
    const agentNoIcon: AvailableAgent[] = [
      { row_id: 10, name: 'No Icon Agent', icon: null },
    ];

    render(
      <SubAgentSelector
        value={[]}
        onChange={mockOnChange}
        availableAgents={agentNoIcon}
      />
    );

    expect(screen.getByText('No Icon Agent')).toBeInTheDocument();
    // The button should exist and be clickable
    const button = screen.getByText('No Icon Agent').closest('button');
    expect(button).toBeInTheDocument();
  });

  it('has data-testid on each agent item', () => {
    render(
      <SubAgentSelector
        value={[]}
        onChange={mockOnChange}
        availableAgents={mockAgents}
      />
    );

    expect(screen.getByTestId('sub-agent-item-1')).toBeInTheDocument();
    expect(screen.getByTestId('sub-agent-item-2')).toBeInTheDocument();
    expect(screen.getByTestId('sub-agent-item-3')).toBeInTheDocument();
  });
});
