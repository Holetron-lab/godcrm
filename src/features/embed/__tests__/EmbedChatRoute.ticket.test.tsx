import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SpaceModel } from '@/features/spaces/types/space.types';
import { EmbedChatRoute } from '../EmbedChatRoute';

const mocks = vi.hoisted(() => ({
  setActiveSpaceId: vi.fn(),
  ticketAuth: {
    status: 'ready' as 'loading' | 'ready' | 'error',
    error: null as string | null,
    retry: vi.fn(),
    session: {
      spaceId: 35,
      expiresIn: 900,
      user: { id: '77', email: 'admin@example.test', name: 'Admin', role: 'admin' as const },
    } as null | {
      spaceId: number;
      expiresIn: number;
      user: { id: string; email: string; name: string; role: 'admin' };
    },
  },
}));

vi.mock('../useEmbedTicketAuth', () => ({ useEmbedTicketAuth: () => mocks.ticketAuth }));
vi.mock('@/features/auth/store/authStore', () => ({
  useAuthStore: (selector: (state: unknown) => unknown) => selector({
    user: { id: '1', email: 'cookie@example.test', name: 'Cookie', role: 'member' }, initialized: true,
  }),
}));
vi.mock('@/features/spaces/hooks/useSpacesQuery', () => ({
  useSpacesQuery: () => ({ isLoading: false, isError: false }),
}));
vi.mock('@/features/spaces/store/spacesStore', () => ({
  useSpaces: () => [{ id: 11, name: 'Eleven' }, { id: 35, name: 'Level' }] as SpaceModel[],
  useActiveSpaceId: () => 11,
  useSpacesStore: (selector: (state: { setActiveSpaceId: typeof mocks.setActiveSpaceId }) => unknown) =>
    selector({ setActiveSpaceId: mocks.setActiveSpaceId }),
}));
vi.mock('@/features/ai-chat', () => ({
  AIChatProvider: ({ spaceId, children }: { spaceId?: number; children: React.ReactNode }) =>
    <div data-testid="chat-provider" data-space-id={spaceId}>{children}</div>,
  AIChatPanel: () => <div>Chat</div>,
  useAIChat: () => ({ isOpen: true, openChat: vi.fn() }),
}));
vi.mock('../EmbedHeader', () => ({
  EmbedHeader: ({ spaces }: { spaces: SpaceModel[] }) =>
    <div data-testid="embed-header" data-space-ids={spaces.map((space) => space.id).join(',')} />,
}));

function renderRoute(entry: string) {
  return render(<MemoryRouter initialEntries={[entry]}><EmbedChatRoute /></MemoryRouter>);
}

describe('ADR-210 EmbedChatRoute ticket mode', () => {
  beforeEach(() => {
    mocks.setActiveSpaceId.mockClear();
    mocks.ticketAuth.status = 'ready';
    mocks.ticketAuth.error = null;
    mocks.ticketAuth.session = {
      spaceId: 35, expiresIn: 900,
      user: { id: '77', email: 'admin@example.test', name: 'Admin', role: 'admin' },
    };
  });

  it('ignores ?space= tampering and renders only redemption Space 35', () => {
    renderRoute('/embed/chat?auth=ticket&client_id=level&space=11');
    expect(screen.getByTestId('chat-provider')).toHaveAttribute('data-space-id', '35');
    expect(screen.getByTestId('embed-header')).toHaveAttribute('data-space-ids', '35');
    expect(mocks.setActiveSpaceId).toHaveBeenCalledWith(35);
    expect(screen.queryByText('Login')).not.toBeInTheDocument();
  });

  it('shows a controlled ticket error with retry instead of generic login', () => {
    mocks.ticketAuth.status = 'error';
    mocks.ticketAuth.error = 'Ticket rejected';
    mocks.ticketAuth.session = null;
    renderRoute('/embed/chat?auth=ticket&client_id=level');
    expect(screen.getByRole('alert')).toHaveTextContent('Ticket rejected');
    screen.getByRole('button', { name: 'Retry connection' }).click();
    expect(mocks.ticketAuth.retry).toHaveBeenCalledTimes(1);
  });

  it('preserves the existing cookie route and requested space', () => {
    renderRoute('/embed/chat?space=11&mode=overlay');
    expect(screen.getByTestId('chat-provider')).toHaveAttribute('data-space-id', '11');
    expect(screen.getByTestId('embed-header')).toHaveAttribute('data-space-ids', '11,35');
  });
});
