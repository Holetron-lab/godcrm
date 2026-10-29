import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { NavTreeToolbar } from './NavTreeToolbar';

const props = {
  allVisible: true,
  sortMode: false,
  onToggleVisibility: vi.fn(),
  onToggleSortMode: vi.fn(),
  onExpandAll: vi.fn(),
  onCollapseAll: vi.fn(),
  onCollapseTables: vi.fn(),
  t: (key: string) => key,
};

describe('NavTreeToolbar help', () => {
  it('opens with the keyboard, exposes the legend and restores focus on Escape', async () => {
    const user = userEvent.setup();
    render(<NavTreeToolbar {...props} />);
    const trigger = screen.getByRole('button', { name: 'schemaEditor.helpToolbar' });
    for (let i = 0; i < 6; i++) await user.tab();
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await user.keyboard('{Enter}');
    const dialog = screen.getByRole('dialog', { name: 'schemaEditor.helpToolbar' });
    expect(dialog).toHaveFocus();
    expect(dialog).toHaveTextContent('schemaEditor.visibility.visible');
    expect(dialog).toHaveTextContent('schemaEditor.connectionLegend.hasRelations');
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    await user.keyboard(' ');
    expect(screen.getByRole('dialog')).toBeVisible();
    await user.click(trigger);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('keeps the legend readable on content clicks and closes on outside interaction', async () => {
    const user = userEvent.setup();
    render(<><NavTreeToolbar {...props} /><button type="button">Outside</button></>);
    await user.click(screen.getByRole('button', { name: 'schemaEditor.helpToolbar' }));
    await user.click(screen.getByText('schemaEditor.visibility.visible'));
    expect(screen.getByRole('dialog')).toBeVisible();
    const outside = screen.getByRole('button', { name: 'Outside' });
    await user.click(outside);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(outside).toHaveFocus();
  });
});
