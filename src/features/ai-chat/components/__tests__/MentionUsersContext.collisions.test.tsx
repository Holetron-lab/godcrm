import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, screen } from '@testing-library/react';
import { renderWithProviders } from '@/tests/renderWithProviders';
import { apiClient } from '@/shared/utils/apiClient';
import { MentionUsersProvider, useMentionUsers } from '../MentionUsersContext';
import { HighlightedText } from '../HighlightedText';
import { MarkdownPreview } from '@/shared/components/MarkdownPreview';
import { MemoryRouter } from 'react-router-dom';

const smith = { id: 110507, name: 'Agent Smith', agent_slug: 'agent-smith', icon: '🕴️', color: '#10b981' };
const clone = { ...smith, id: 111778, icon: '🤖', color: '#3B82F6' };
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function IdentityProbe() {
  const { getByAgentId, getByUserId } = useMentionUsers();
  return <output aria-label="identities">{JSON.stringify({
    original: getByAgentId(smith.id)?.icon,
    clone: getByAgentId(clone.id)?.icon,
    user: getByUserId(79)?.icon,
  })}</output>;
}

it.each([true, false])('preserves linked Smith identity despite duplicate slugs (local: %s)', async local => {
  vi.spyOn(apiClient, 'get').mockImplementation(async url => {
    if (url === '/users') return { success: true, data: [{ id: 79, name: smith.name, managed_by_agent_row_id: smith.id }] };
    if (url.startsWith('/ai/agents?')) return { success: true, data: { agents: [smith, clone], total: 2 } };
    throw new Error(`Unexpected request: ${url}`);
  });
  renderWithProviders(<MemoryRouter><MentionUsersProvider agents={local ? [smith] : []}>
    <HighlightedText text={'<<@agent-smith>> @agent-smith'} />
    <MarkdownPreview content={'<</agent-smith>> @agent-smith'} />
    <IdentityProbe />
  </MentionUsersProvider></MemoryRouter>);
  await screen.findByText(/"clone":"🤖"/);
  const pills = screen.getAllByTitle(/^(Вызов|Упоминание):/);
  expect(pills).toHaveLength(4);
  for (const pill of pills) {
    expect(pill).toHaveTextContent('🕴️');
    expect(pill.style.borderColor).toBe('rgb(16, 185, 129)');
    if (pill.title.startsWith('Упоминание:')) expect(pill.style.boxShadow).toContain('#10b981');
  }
  expect(screen.getByLabelText('identities')).toHaveTextContent('"user":"🕴️"');
});

it('prefers a space-specific agent over a linked global namesake', async () => {
  vi.spyOn(apiClient, 'get').mockImplementation(async url => {
    if (url === '/users') return { success: true, data: [{ id: 79, name: smith.name, managed_by_agent_row_id: smith.id }] };
    if (url.startsWith('/ai/agents?')) return { success: true, data: { agents: [clone, smith], total: 2 } };
    throw new Error(`Unexpected request: ${url}`);
  });
  renderWithProviders(<MentionUsersProvider agents={[clone]}>
    <HighlightedText text="<<@agent-smith>>" /><IdentityProbe />
  </MentionUsersProvider>);
  await screen.findByText(/"user":"🕴️"/);
  expect(screen.getByRole('button')).toHaveTextContent('🤖');
});

it('resolves an issued passport handle to its user even when the local agent slug collides', async () => {
  vi.spyOn(apiClient, 'get').mockImplementation(async url => {
    if (url === '/users') return { success: true, data: [{ id: 79, name: smith.name, managed_by_agent_row_id: smith.id }] };
    if (url.startsWith('/ai/agents?')) return { success: true, data: { agents: [clone, smith], total: 2 } };
    throw new Error(`Unexpected request: ${url}`);
  });
  renderWithProviders(<MentionUsersProvider agents={[clone]} mentionUsers={[
    { id: 79, name: smith.name, type: 'bot', handle: 'agent-smith' },
  ]}><HighlightedText text="<<@agent-smith>>" /><IdentityProbe /></MentionUsersProvider>);
  await screen.findByText(/"user":"🕴️"/);
  expect(screen.getByRole('button')).toHaveTextContent('🕴️');
});
