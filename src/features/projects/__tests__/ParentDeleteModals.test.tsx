import { useState } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '@/shared/i18n/LanguageContext';
import { DropdownMenu } from '@/shared/components/ui/DropdownMenu';
import { DeleteProjectModal } from '../components/DeleteProjectModal';
import { DeleteSpaceModal } from '@/features/spaces/components/DeleteSpaceModal';

type Kind = 'project' | 'space';

function Harness({ kind }: { kind: Kind }) {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  return <>
    <output aria-label="Location">{location.pathname}</output>
    <DropdownMenu trigger={<button>Actions</button>} items={[
      { label: 'Delete', value: 'delete', onSelect: () => setOpen(true) },
    ]} />
    {kind === 'project'
      ? <DeleteProjectModal open={open} onOpenChange={setOpen} project={{ id: 42, name: 'Example', space_id: 7 }} />
      : <DeleteSpaceModal open={open} onOpenChange={setOpen} space={{ id: 42, name: 'Example' }} />}
  </>;
}

function setup(kind: Kind) {
  localStorage.setItem('god-crm-language', 'en');
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  render(<LanguageProvider><QueryClientProvider client={client}>
    <MemoryRouter initialEntries={['/original']}><Harness kind={kind} /></MemoryRouter>
  </QueryClientProvider></LanguageProvider>);
  return userEvent.setup();
}

afterEach(() => vi.unstubAllGlobals());

describe.each(['project', 'space'] as const)('%s deletion', kind => {
  it('announces the server refusal, keeps focus inside, and restores the surviving menu trigger', async () => {
    let respond!: (value: Response) => void;
    const request = vi.fn(() => new Promise<Response>(resolve => { respond = resolve; }));
    vi.stubGlobal('fetch', request);
    const user = setup(kind);
    const opener = screen.getByRole('button', { name: 'Actions' });
    await user.click(opener);
    await user.click(screen.getByRole('menuitem', { name: 'Delete' }));
    const input = screen.getByRole('textbox');
    expect(input).toHaveAccessibleName(/To confirm deletion, type delete below/);
    await user.type(input, 'delete');
    await user.click(screen.getByRole('button', { name: /Delete Forever/ }));
    expect(screen.getByRole('dialog')).toContainElement(document.activeElement as HTMLElement);
    const message = kind === 'project'
      ? 'Remove tables and dashboards before deleting this project'
      : 'Remove projects and dashboards before deleting this space';
    await act(async () => respond(new Response(JSON.stringify({ error: { code: `${kind.toUpperCase()}_NOT_EMPTY`, message } }), {
      status: 409, headers: { 'Content-Type': 'application/json' },
    })));
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(screen.getByRole('dialog')).toContainElement(document.activeElement as HTMLElement);
    expect(screen.getByLabelText('Location')).toHaveTextContent('/original');
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith(`/api/v3/${kind}s/42`, expect.objectContaining({ method: 'DELETE' }));
    await user.keyboard('{Escape}');
    await waitFor(() => expect(opener).toHaveFocus());
    await user.click(opener);
    await user.click(screen.getByRole('menuitem', { name: 'Delete' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('textbox')).toHaveValue('');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(opener).toHaveFocus());
  });

  it('explains empty-only deletion and navigates only after success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json' },
    })));
    const user = setup(kind);
    await user.click(screen.getByRole('button', { name: 'Actions' }));
    await user.click(screen.getByRole('menuitem', { name: 'Delete' }));
    expect(screen.getByRole('dialog')).toHaveTextContent(/Only empty/);
    const submit = screen.getByRole('button', { name: /Delete Forever/ });
    expect(submit).toBeDisabled();
    await user.type(screen.getByRole('textbox'), 'delete');
    await user.click(submit);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByLabelText('Location')).toHaveTextContent(kind === 'project' ? '/spaces/7/dashboard' : '/spaces');
  });
});
