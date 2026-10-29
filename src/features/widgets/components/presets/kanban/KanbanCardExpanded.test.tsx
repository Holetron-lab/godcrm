import { LanguageProvider } from '@/shared/i18n/LanguageContext';
import { createRef } from 'react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render as rtlRender, screen, within } from '@testing-library/react';
import { AssignedUsersRow, SystemDatesRow } from './KanbanCardExpanded';
import type { FieldValue } from './kanban-types';

afterEach(cleanup);

describe('kanban assignee edits', () => {
  it.each([
    { assigned: ['alice', 'bob'], expected: ['bob'] },
    { assigned: ['alice'], expected: null },
  ])('preserves remaining assignees from $assigned', ({ assigned, expected }) => {
    const onQuickEdit = vi.fn<(field: string, value: FieldValue) => void>();
    render(<AssignedUsersRow
      assignedResolved={assigned.map(value => ({ value, label: value }))}
      assignedArray={assigned}
      assignedFieldName="assigned_to"
      allAssignedOptions={[]}
      showAssignedEditor
      setShowAssignedEditor={vi.fn()}
      showAssignedAddSelect={false}
      setShowAssignedAddSelect={vi.fn()}
      assignedButtonRef={createRef<HTMLDivElement>()}
      itemId={42}
      onQuickEdit={onQuickEdit}
    />);
    const chip = screen.getByText('alice').parentElement;
    if (!chip) throw new Error('Assignee chip missing');
    fireEvent.click(within(chip).getByRole('button'));
    expect(onQuickEdit).toHaveBeenCalledExactlyOnceWith('assigned_to', expected);
  });
});

it('does not render missing system dates as raw zero values', () => {
  const { container } = render(<SystemDatesRow createdAt={0} updatedAt={null} />);
  expect(container.textContent).toBe('');
});

beforeEach(() => localStorage.setItem('god-crm-language', 'ru'));
function render(ui: Parameters<typeof rtlRender>[0]) { return rtlRender(ui, { wrapper: LanguageProvider }); }
