import { expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/tests/renderWithProviders';
import { UserCard } from './UserCard';

it.each(['project', 'table', 'column'] as const)('preserves %s role editing inside the expanded map', async entityType => {
  const update = vi.fn().mockResolvedValue(undefined);
  renderWithProviders(<UserCard
    user={{ row_id: '7', id: 24, system_user_id: 24, name: 'Architect', email: 'architect@example.test', avatar: null, active: true, role: 'viewer', [`${entityType}_viewer`]: ['44'] }}
    entityType={entityType} entityId={44} spaceId={11} projectId={10}
    isExpanded onToggleExpanded={vi.fn()}
    availableLevels={[{ value: 'viewer', label: 'Viewer' }, { value: 'editor', label: 'Editor' }]}
    updatingRoleRowId={null} onUpdateUserRole={vi.fn()}
    isDeletingUser={null} onDeleteUserFromTable={vi.fn()}
    onUpdateGranularAccess={update}
  />, { language: 'en' });
  expect(screen.getByLabelText('Architect').parentElement?.parentElement?.style.boxShadow).toBe('');
  fireEvent.change(screen.getByRole('combobox', { name: 'Entity role: Architect' }), { target: { value: 'editor' } });
  await waitFor(() => expect(update).toHaveBeenCalledTimes(2));
  expect(update).toHaveBeenNthCalledWith(1, '7', entityType, 'viewer', []);
  expect(update).toHaveBeenNthCalledWith(2, '7', entityType, 'editor', ['44']);
});
