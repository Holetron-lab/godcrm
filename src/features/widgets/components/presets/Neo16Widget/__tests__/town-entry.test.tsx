import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { Neo16ModuleWidget } from '../town/TownWidget';
import type { PresetWidgetProps } from '../../../../types/widget.types';

const legacy = vi.fn((_props: PresetWidgetProps) => <div>Legacy office</div>);
vi.mock('../Neo16Widget', () => ({ Neo16Widget: (props: PresetWidgetProps) => legacy(props) }));
vi.mock('../town/useWorld', () => ({ useWorld: () => ({ world: null, notice: null }) }));
vi.mock('../setup/Neo16Setup', () => ({ Neo16Setup: () => <div>Установка Neo16</div> }));
const widget: PresetWidgetProps['widget'] = {
  id: 42, dashboard_id: 1, source_widget_id: null, code: null, code_version: 1, description: null,
  is_module: false, module_id: null, sidebar_order: null, sidebar_icon: null, access_level: null, is_pinned: null,
  widget_type: 'preset', preset_name: '16neo', title: 'Neo16', icon: '🎮',
  config: {}, position: { x: 0, y: 0, w: 12, h: 8 }, is_visible: true, order_index: 0, created_by: 1,
  created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
};
it('installed widgets never mount the legacy office and its multiplayer hooks', () => {
  const installed = { ...widget, config: { __module: { key: 'neo16' } } };
  render(<Neo16ModuleWidget widget={installed} data={[]} />);
  expect(screen.getByLabelText('Neo16 town')).toBeInTheDocument();
  expect(legacy).not.toHaveBeenCalled();
});
it('new and existing uninstalled rows reach explicit setup without mounting the office', () => {
  render(<Neo16ModuleWidget widget={widget} data={[]} />);
  expect(screen.getByText('Установка Neo16')).toBeInTheDocument();
  expect(legacy).not.toHaveBeenCalled();
});
