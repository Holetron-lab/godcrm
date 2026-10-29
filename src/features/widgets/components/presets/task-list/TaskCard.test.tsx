import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TaskCard } from './TaskCard';

afterEach(cleanup);

describe('task card row values', () => {
  it('handles malformed title, subtitle, dates and color without crashing', () => {
    const { container } = render(<TaskCard item={{ id: '1', data: {
      title: { unexpected: true }, description: { text: 'nested' },
      scheduled: 42, due: {}, color: {},
    } }} isCompleted={false} scheduledDateColumn="scheduled" dueDateColumn="due" colorColumn="color" onToggle={vi.fn()} />);
    expect(screen.getByText('Без названия')).toBeInTheDocument();
    expect(container.textContent).not.toContain('[object Object]');
    expect(container.querySelector('svg.lucide-calendar')).toBeNull();
  });

  it('preserves zero-valued titles and subtitles', () => {
    render(<TaskCard item={{ id: '1', data: { title: 0, description: 0 } }} isCompleted={false} onToggle={vi.fn()} />);
    expect(screen.getAllByText('0')).toHaveLength(2);
    expect(screen.queryByText('Без названия')).toBeNull();
  });

  it('renders malformed expanded fields safely while preserving valid values', () => {
    const data = { title: 'Example', choice: {}, tags: ['a', {}], amount: 0, link: {}, date: [] };
    const columns = [
      { name: 'choice', displayName: 'Choice', type: 'select' },
      { name: 'tags', displayName: 'Tags', type: 'multiselect', config: { options: [{ value: 'a', label: 'Alpha' }] } },
      { name: 'amount', displayName: 'Amount', type: 'number' },
      { name: 'link', displayName: 'Link', type: 'url' },
      { name: 'date', displayName: 'Date', type: 'date' },
    ];
    const { container } = render(<TaskCard item={{ id: '1', data }} isCompleted={false} onToggle={vi.fn()} visibleColumns={columns.map(c => c.name)} columnsInfo={columns} />);
    fireEvent.click(screen.getByText('Example'));
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.getByText('0')).toBeInTheDocument();
    expect(container.textContent).not.toContain('[object Object]');
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('keeps toggle, color clearing and comments callbacks intact', () => {
    const onToggle = vi.fn();
    const onUpdate = vi.fn();
    const onDoubleClick = vi.fn();
    render(<TaskCard item={{ id: '1', data: { title: 'Example', color: '#ef4444', amount: 5 } }} isCompleted={false} onToggle={onToggle} onUpdate={onUpdate} onDoubleClick={onDoubleClick} colorColumn="color" visibleColumns={['amount']} />);
    fireEvent.click(screen.getAllByRole('button')[0]);
    expect(onToggle).toHaveBeenCalledExactlyOnceWith(true);
    fireEvent.click(screen.getByTitle('Изменить цвет'));
    fireEvent.click(screen.getByText('Убрать цвет'));
    expect(onUpdate).toHaveBeenCalledExactlyOnceWith('color', null);
    fireEvent.click(screen.getByText('Example'));
    fireEvent.click(screen.getByText('Комментарии'));
    expect(onDoubleClick).toHaveBeenCalledExactlyOnceWith('comments');
  });
});


describe('task card accessibility', () => {
  it('expands from the title with the keyboard and keeps content clicks passive', async () => {
    const user = userEvent.setup();
    render(<TaskCard item={{ id: '1', data: { title: 'Example', amount: 5 } }} isCompleted={false} onToggle={vi.fn()} visibleColumns={['amount']} />);
    await user.tab();
    expect(screen.getByRole('button', { name: 'Выполнено: Example' })).toHaveFocus();
    await user.tab();
    const expand = screen.getByRole('button', { name: 'Подробности: Example' });
    expect(expand).toHaveFocus();
    expect(expand).toHaveTextContent('Example');
    await user.keyboard('{Enter}');
    expect(expand).toHaveAttribute('aria-expanded', 'true');
    await user.click(screen.getByText('5'));
    expect(expand).toHaveAttribute('aria-expanded', 'true');
    expand.focus();
    await user.keyboard(' ');
    expect(expand).toHaveAttribute('aria-expanded', 'false');
  });

  it('opens details and comments without extra fields or submitting its parent form', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    const onSubmit = vi.fn(event => event.preventDefault());
    render(<form onSubmit={onSubmit}><TaskCard item={{ id: '1', data: { title: 'Example' } }} isCompleted={false} onToggle={vi.fn()} onDoubleClick={onOpen} /></form>);
    await user.click(screen.getByRole('button', { name: 'Подробности: Example' }));
    await user.tab();
    expect(screen.getByRole('button', { name: 'Открыть' })).toHaveFocus();
    await user.keyboard('{Enter}');
    await user.tab();
    expect(screen.getByRole('button', { name: 'Комментарии' })).toHaveFocus();
    await user.keyboard(' ');
    expect(onOpen.mock.calls).toEqual([['details'], ['comments']]);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('exposes task-specific completion and expansion names and states', () => {
    const props = { item: { id: '1', data: { title: 0, amount: 0 } }, onToggle: vi.fn(), visibleColumns: ['amount'] };
    const { rerender } = render(<TaskCard {...props} isCompleted={false} />);
    const toggle = screen.getByRole('button', { name: 'Выполнено: 0', pressed: false });
    fireEvent.click(toggle);
    expect(props.onToggle).toHaveBeenCalledExactlyOnceWith(true);
    rerender(<TaskCard {...props} isCompleted />);
    expect(screen.getByRole('button', { name: 'Выполнено: 0', pressed: true })).toBeInTheDocument();
    const expand = screen.getByRole('button', { name: 'Подробности: 0', expanded: false });
    fireEvent.click(expand);
    expect(expand).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(expand);
    expect(expand).toHaveAttribute('aria-expanded', 'false');
  });

  it('names every color, exposes selection and closes on Escape with focus return', () => {
    const onUpdate = vi.fn();
    render(<TaskCard item={{ id: '1', data: { title: 'Example', color: '#ef4444' } }} isCompleted={false} onToggle={vi.fn()} onUpdate={onUpdate} colorColumn="color" />);
    const trigger = screen.getByTitle('Изменить цвет');
    fireEvent.click(trigger);
    const colors = screen.getAllByRole('button', { name: /^Цвет #/ });
    expect(colors).toHaveLength(15);
    expect(screen.getByRole('button', { name: 'Цвет #ef4444', pressed: true })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^Цвет #/, pressed: false })).toHaveLength(14);
    colors[1].focus();
    fireEvent.keyDown(colors[1], { key: 'Escape' });
    expect(screen.queryByRole('button', { name: /^Цвет #/ })).toBeNull();
    expect(trigger).toHaveFocus();
    expect(onUpdate).not.toHaveBeenCalled();
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('button', { name: 'Цвет #f97316' }));
    expect(onUpdate).toHaveBeenCalledExactlyOnceWith('color', '#f97316');
  });
});

describe.each([
  ['Цвет #f97316', '#f97316'],
  ['Убрать цвет', null],
] as const)('palette focus after %s', (name, value) => {
  it('closes the palette, returns focus and preserves the update', () => {
    const onUpdate = vi.fn();
    render(<TaskCard item={{ id: '1', data: { title: 'Example', color: '#ef4444' } }} isCompleted={false} onToggle={vi.fn()} onUpdate={onUpdate} colorColumn="color" />);
    const trigger = screen.getByTitle('Изменить цвет');
    fireEvent.click(trigger);
    const action = screen.getByRole('button', { name });
    action.focus();
    fireEvent.click(action);
    expect(screen.queryByRole('button', { name: /^Цвет #/ })).toBeNull();
    expect(trigger).toHaveFocus();
    expect(onUpdate).toHaveBeenCalledExactlyOnceWith('color', value);
  });
});
