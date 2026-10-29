import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import type { PropsWithChildren } from 'react';
import { PublicLayout } from '../PublicLayout';
import { PublicSpaceSidebar } from '../PublicSpaceSidebar';
import type { PublicTree } from '../publicApi';

vi.mock('@/features/ai-chat', () => ({
  AIChatStubProvider: ({ children }: PropsWithChildren) => children,
}));
vi.mock('@/shared/components/layout/Sidebar', () => ({ Sidebar: () => null }));
vi.mock('@/shared/components/layout/ThemeToggle', () => ({ ThemeToggle: () => null }));
vi.mock('@/shared/components/layout/LanguageSwitcher', () => ({ LanguageSwitcher: () => null }));

const tree: PublicTree = {
  space: { id: 1, name: 'Public space', icon: null, public_slug: 'demo' },
  projects: [{
    id: 2, name: 'Project', icon: null, is_public: true, tables: [],
    dashboards: [{ id: 3, name: 'Dashboard', icon: null }],
    widgets: [{ id: 4, name: 'Documents', icon: null }],
  }],
};

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it.each(['Project', 'Dashboard', 'Documents'])('keeps the drawer open on project toggle, closes on %s navigation', async name => {
  vi.stubGlobal('matchMedia', () => ({ addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  const user = userEvent.setup();
  render(<MemoryRouter><PublicSpaceSidebar tree={tree} slug="demo" /></MemoryRouter>);
  await user.click(screen.getByRole('button', { name: 'Open navigation' }));
  const drawer = screen.getByRole('dialog');
  const toggle = within(drawer).getByRole('button', { name: 'Collapse project Project' });
  toggle.focus();
  await user.keyboard('{Enter}');
  expect(drawer).toBeInTheDocument();
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await user.keyboard(' ');
  expect(toggle).toHaveAttribute('aria-expanded', 'true');
  const link = within(drawer).getByRole('link', { name: new RegExp(name) });
  link.focus();
  await user.keyboard('{Enter}');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

it('closes the public layout mobile backdrop with the keyboard', async () => {
  vi.stubGlobal('innerWidth', 390);
  const client = new QueryClient();
  client.setQueryData(['publicTree', 'demo'], tree);
  const user = userEvent.setup();
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/s/demo']}>
        <Routes><Route path="/s/:slug" element={<PublicLayout />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await user.click(screen.getByRole('button', { name: 'Show menu' }));
  const backdrop = screen.getByRole('button', { name: 'Close menu' });
  backdrop.focus();
  await user.keyboard(' ');
  expect(screen.getByRole('button', { name: 'Show menu' })).toHaveAttribute('aria-expanded', 'false');
  expect(backdrop).not.toBeInTheDocument();
  client.clear();
});
