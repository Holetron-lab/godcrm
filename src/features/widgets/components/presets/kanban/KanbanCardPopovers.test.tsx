import { LanguageProvider } from '@/shared/i18n/LanguageContext';
import { useEffect, useRef, useState } from 'react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render as rtlRender, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AssignedUsersRow, CardStatusBar } from './KanbanCardExpanded';
import type { FieldValue } from './kanban-types';

afterEach(cleanup);

const options = [{ value: 'alice', label: 'Алиса' }, { value: 'bob', label: 'Боб' }];

function Fixture({ edit, submit, click, empty = false }: {
  edit: (field: string, value: FieldValue) => void;
  submit: () => void;
  click: () => void;
  empty?: boolean;
}) {
  const [typeOpen, setTypeOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState(true);
  useEffect(() => {
    document.addEventListener('click', click);
    return () => document.removeEventListener('click', click);
  }, [click]);
  const typeRef = useRef<HTMLButtonElement>(null);
  const assignedRef = useRef<HTMLDivElement>(null);
  return <form onSubmit={event => { event.preventDefault(); submit(); }}>
    <CardStatusBar itemId={42} adrLabel={null} adrValue={null} typeLabel="Задача" typeValue="task"
      typeRelation={null} typeRelOptions={empty ? [] : [{ value: 'task', label: 'Задача' }, { value: 'bug', label: 'Ошибка' }]}
      showTypeSelect={typeOpen} setShowTypeSelect={setTypeOpen} typeButtonRef={typeRef} onQuickEdit={edit} />
    <AssignedUsersRow assignedResolved={[options[0]]} assignedArray={['alice']} assignedFieldName="assigned_to"
      allAssignedOptions={empty ? [] : options} showAssignedEditor={editing} setShowAssignedEditor={setEditing}
      showAssignedAddSelect={addOpen} setShowAssignedAddSelect={setAddOpen} assignedButtonRef={assignedRef}
      itemId={42} onQuickEdit={edit} />
  </form>;
}

function setup(empty = false) {
  const edit = vi.fn();
  const submit = vi.fn();
  const click = vi.fn();
  render(<Fixture edit={edit} submit={submit} click={click} empty={empty} />);
  return { user: userEvent.setup(), edit, submit, click };
}

describe('Kanban card popovers', () => {
  it('opens type choices by keyboard, selects once and returns focus without submitting or opening the card', async () => {
    const { user, edit, submit, click } = setup();
    const trigger = screen.getByRole('button', { name: 'Тип: Задача' });
    trigger.focus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('dialog', { name: 'Тип тикета' })).toBeInTheDocument();
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await user.click(screen.getByRole('button', { name: 'Ошибка' }));
    expect(edit).toHaveBeenCalledExactlyOnceWith('type', 'bug');
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(submit).not.toHaveBeenCalled();
    expect(click).not.toHaveBeenCalled();
  });

  it('dismisses both pickers with Escape and restores focus', async () => {
    const { user, edit } = setup();
    for (const name of ['Тип: Задача', 'Добавить']) {
      const trigger = screen.getByRole('button', { name });
      trigger.focus();
      await user.keyboard(' ');
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      await user.keyboard('{Escape}');
      await waitFor(() => expect(trigger).toHaveFocus());
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    }
    expect(edit).not.toHaveBeenCalled();
  });

  it('adds only an unassigned user and labels removal and completion controls', async () => {
    const { user, edit, submit, click } = setup();
    await user.click(screen.getByRole('button', { name: 'Добавить' }));
    expect(screen.getByRole('dialog', { name: 'Добавить ответственного' })).toBeInTheDocument();
    const choice = screen.getByRole('button', { name: 'Боб' });
    choice.focus();
    await user.keyboard('{Enter}');
    expect(edit).toHaveBeenCalledExactlyOnceWith('assigned_to', ['alice', 'bob']);
    await user.click(screen.getByRole('button', { name: 'Убрать Алиса' }));
    expect(edit).toHaveBeenLastCalledWith('assigned_to', null);
    await user.click(screen.getByRole('button', { name: 'Завершить редактирование ответственных' }));
    expect(screen.getByRole('button', { name: 'Редактировать' })).toBeInTheDocument();
    expect(submit).not.toHaveBeenCalled();
    expect(click).not.toHaveBeenCalled();
  });

  it('disables empty pickers without creating a blank overlay', () => {
    setup(true);
    expect(screen.getByRole('button', { name: 'Тип: Задача' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Добавить' })).toBeDisabled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

beforeEach(() => localStorage.setItem('god-crm-language', 'ru'));
function render(ui: Parameters<typeof rtlRender>[0]) { return rtlRender(ui, { wrapper: LanguageProvider }); }
