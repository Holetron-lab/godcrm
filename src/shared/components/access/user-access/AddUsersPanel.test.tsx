import { act, fireEvent, screen } from '@testing-library/react';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/tests/renderWithProviders';
import { AddUsersPanel } from './AddUsersPanel';

let intersect: () => void;
beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', class {
    constructor(callback: IntersectionObserverCallback) { intersect = () => callback([{ isIntersecting: true } as IntersectionObserverEntry], this as unknown as IntersectionObserver); }
    observe() {}
    disconnect() {}
  });
});
afterEach(() => vi.unstubAllGlobals());

const props = {
  systemUsers: Array.from({ length: 101 }, (_, i) => ({ id: i + 1, name: `Person ${i + 1}`, email: `p${i + 1}@test.local`, color: '#14b8a6' })),
  usersTableRows: [], selectedUsersToAdd: [], selectedLevel: 'viewer' as const,
  setSelectedLevel: vi.fn(), addUserSearchQuery: '', setAddUserSearchQuery: vi.fn(),
  availableLevels: [{ value: 'viewer' as const, label: 'Viewer' }], isAddingUser: false,
  onToggleUser: vi.fn(), onUpdateSelectedLevel: vi.fn(), onRemoveSelected: vi.fn(),
  onConfirm: vi.fn(), onCancel: vi.fn(),
};

it('reveals all candidates in batches of 50, retaining selection and searching beyond the first batch', () => {
  const { rerender } = renderWithProviders(<AddUsersPanel {...props} />, { language: 'en' });
  expect(screen.getAllByRole('button', { pressed: false })).toHaveLength(50);
  expect(screen.queryByText('Person 51')).not.toBeInTheDocument();
  act(() => intersect());
  expect(screen.getAllByRole('button', { pressed: false })).toHaveLength(100);
  fireEvent.click(screen.getByText('Person 51'));
  expect(props.onToggleUser).toHaveBeenCalledWith(51);
  rerender(<AddUsersPanel {...props} selectedUsersToAdd={[{ userId: 51, level: 'viewer' }]} />);
  expect(screen.getByRole('button', { pressed: true })).toHaveTextContent('Person 51');
  act(() => intersect());
  expect(screen.getByText('Person 101')).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Load 50 more' })).not.toBeInTheDocument();
  rerender(<AddUsersPanel {...props} addUserSearchQuery="p101@" />);
  expect(screen.getAllByRole('button', { pressed: false })).toHaveLength(1);
  expect(screen.getByText('Person 101')).toBeVisible();
  rerender(<AddUsersPanel {...props} addUserSearchQuery="missing" />);
  expect(screen.getByText('No matching users')).toBeVisible();
});

it('distinguishes loading and failed requests from an empty directory and offers retry', () => {
  const onRetry = vi.fn();
  const { rerender } = renderWithProviders(<AddUsersPanel {...props} systemUsers={[]} isLoading />, { language: 'en' });
  expect(screen.getByRole('status')).toHaveTextContent('Loading users');
  expect(screen.queryByText('All system users are already added')).not.toBeInTheDocument();
  rerender(<AddUsersPanel {...props} systemUsers={[]} isError onRetry={onRetry} />);
  expect(screen.getByRole('alert')).toHaveTextContent('Unable to load users');
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(onRetry).toHaveBeenCalledOnce();
});


it('filters agents and humans across all batches without dropping selected users', () => {
  const systemUsers = [
    { id: 1, name: 'Person', email: 'person@test.local' },
    { id: 2, name: 'Agent', email: 'agent@test.local', user_type: 'agent' },
    { id: 3, name: 'Passport', email: 'passport@test.local', managed_by_agent_table_id: 12 },
    { id: 4, name: 'Bot', email: 'bot@test.local', user_type: 'bot' },
    { id: 5, name: 'Service', email: 'svc@test.local', user_type: 'service' },
  ];
  renderWithProviders(<AddUsersPanel {...props} systemUsers={systemUsers}
    selectedUsersToAdd={[{ userId: 1, level: 'viewer' }]} />, { language: 'en' });
  fireEvent.change(screen.getByRole('combobox', { name: 'User type' }), { target: { value: 'agents' } });
  expect(screen.getAllByRole('button', { pressed: false })).toHaveLength(4);
  expect(screen.getByRole('button', { name: 'Remove: Person' })).toBeVisible();
  fireEvent.change(screen.getByRole('combobox', { name: 'User type' }), { target: { value: 'humans' } });
  expect(screen.getAllByRole('button', { pressed: true })).toHaveLength(1);
  expect(screen.queryByRole('button', { pressed: false })).not.toBeInTheDocument();
});
