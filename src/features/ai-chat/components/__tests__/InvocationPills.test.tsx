import { ProvidersWrapper } from '@/tests/renderWithProviders';
import React from 'react';
import { render, fireEvent, screen } from '@testing-library/react';
import { renderWithProviders } from '@/tests/renderWithProviders';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { MentionUsersProvider } from '../MentionUsersContext';
import { HighlightedText } from '../HighlightedText';
import { MentionPill, CommandPill } from '../InvocationPills';
import { MarkdownPreview } from '@/shared/components/MarkdownPreview';

const agents = [{ id: 1, name: 'Display Name', agent_slug: 'developer-ralph', color: '#f80', icon: '🔧' }];
const wrapper = ({ children }: { children: React.ReactNode }) => (
  <ProvidersWrapper><MemoryRouter><MentionUsersProvider agents={agents}>{children}</MentionUsersProvider></MemoryRouter></ProvidersWrapper>
);

describe('agent mention appearance', () => {
  it('preserves the frontend-developer accent and icon in both renderers', () => {
    renderWithProviders(<MemoryRouter><MentionUsersProvider agents={[
      { id: 31114, name: 'Frontend Developer', agent_slug: 'frontend-developer', color: '#22c55e', icon: '🎨' },
    ]}>
      <HighlightedText text={'<<@frontend-developer>> @frontend-developer'} />
      <MarkdownPreview content={'<</frontend-developer>> @frontend-developer'} />
    </MentionUsersProvider></MemoryRouter>);
    const pills = screen.getAllByTitle(/^(Вызов|Упоминание):/);
    expect(pills).toHaveLength(4);
    for (const pill of pills) {
      expect(pill).toHaveTextContent('🎨');
      expect(pill.style.borderColor).toBe('rgb(34, 197, 94)');
      expect(pill.style.backgroundColor).toBe(pill.title.startsWith('Упоминание:')
        ? 'transparent' : 'rgba(34, 197, 94, 0.2)');
    }
  });

  it('uses canonical slug and valid short-hex tint for both invocation forms', () => {
    render(<><MentionPill slug="developer-ralph" /><CommandPill slug="developer-ralph" /></>, { wrapper });
    for (const pill of screen.getAllByRole('button')) {
      expect(pill).toHaveStyle({ borderWidth: '0px' });
      expect(pill.style.backgroundColor).not.toBe('');
      expect(pill).toHaveTextContent('🔧');
    }
  });

  it('renders a plain mention with an outline and no invocation action', () => {
    render(<MarkdownPreview content={'<<@developer-ralph>> @developer-ralph'} />, { wrapper });
    expect(screen.getAllByRole('button')).toHaveLength(1);
    const reference = screen.getByTitle('Упоминание: @developer-ralph');
    expect(reference).toHaveStyle({ borderWidth: '0px', boxShadow: 'inset 0 0 0 0.5px #f80' });
    expect(reference.style.backgroundColor).toBe('transparent');
    expect(reference).not.toHaveAttribute('role', 'button');
  });

  it('keeps tokens inside code and email addresses unchanged', () => {
    render(<MarkdownPreview content={'`<<@developer-ralph>>` user@example.com'} />, { wrapper });
    expect(screen.queryByRole('button', { name: /developer-ralph/ })).not.toBeInTheDocument();
    expect(screen.getByText('<<@developer-ralph>>').tagName).toBe('CODE');
    expect(screen.getByText(/user@example.com/)).toBeInTheDocument();
  });

  it('uses an outlined reference in plain-text chat rendering too', () => {
    render(<HighlightedText text={'<<@developer-ralph>> @developer-ralph'} />, { wrapper });
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(screen.getByTitle('Упоминание: @developer-ralph').style.backgroundColor).toBe('transparent');
  });

  it('resolves display-name aliases and underscore variants in both renderers', () => {
    render(<><HighlightedText text={'<<@display-name>> @developer_ralph'} />
      <MarkdownPreview content={'<</display-name>> @developer_ralph'} /></>, { wrapper });
    for (const pill of screen.getAllByTitle(/^(Вызов|Упоминание):/)) {
      expect(pill).toHaveTextContent('🔧');
      expect(pill.style.borderColor).toBe('rgb(255, 136, 0)');
    }
  });

  it('keeps canonical slugs ahead of conflicting display names', () => {
    renderWithProviders(<MemoryRouter><MentionUsersProvider agents={[
      ...agents, { id: 2, name: 'Developer Ralph', agent_slug: 'another-agent', icon: '🎨' },
    ]}><MentionPill slug="developer-ralph" /></MentionUsersProvider></MemoryRouter>);
    expect(screen.getByRole('button')).toHaveTextContent('🔧');
  });

  it('retains invocation callbacks', () => {
    const onClick = vi.fn();
    render(<MentionPill slug="developer-ralph" onClick={onClick} />, { wrapper });
    fireEvent.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledWith('<<@developer-ralph>>');
  });
});
