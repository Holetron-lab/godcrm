import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { GalleryWidget } from '../GalleryWidget';
import type { Widget } from '../../../types/widget.types';

const widget: Widget = {
  id: 1, dashboard_id: 1, source_widget_id: null, widget_type: 'preset',
  preset_name: 'gallery_widget', code: null, code_version: 1, title: 'Gallery',
  description: null, icon: '', config: {}, position: { x: 0, y: 0, w: 4, h: 4 },
  is_visible: true, is_module: false, order_index: 0, created_by: null,
  created_at: '', updated_at: '', module_id: null, sidebar_order: null,
  sidebar_icon: null, access_level: null, is_pinned: null,
};
const row = { id: 1, data: { name: 'Монстера', description: 'Полив завтра' } };

describe('Gallery card keyboard access', () => {
  it('opens the same row with Enter, Space and pointer without submitting a form', async () => {
    const user = userEvent.setup();
    const open = vi.fn();
    const submit = vi.fn(event => event.preventDefault());
    render(<form onSubmit={submit}><GalleryWidget widget={widget} data={[row]} onCardClick={open} /></form>);
    const card = screen.getByRole('button', { name: /Монстера/ });
    await user.tab();
    expect(card).toHaveFocus();
    await user.keyboard('{Enter}');
    await user.keyboard(' ');
    await user.click(card);
    expect(open.mock.calls).toEqual([[row], [row], [row]]);
    expect(submit).not.toHaveBeenCalled();
  });

  it('does not offer an active action when there is no row opener', () => {
    render(<GalleryWidget widget={widget} data={[row]} />);
    expect(screen.getByRole('button', { name: /Монстера/ })).toBeDisabled();
  });
});
