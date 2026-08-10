import { createElement } from 'react';
import type { WidgetPresetConfig } from '@/features/widgets/config/widget-presets.config';
import type { WidgetPresetOption } from './types';

/** Transform config preset to local format (with rendered icon) */
export function transformConfigPreset(config: WidgetPresetConfig): WidgetPresetOption {
  return {
    id: config.id,
    name: config.name,
    description: config.description,
    icon: createElement(config.icon, { className: 'w-8 h-8' }),
    color: config.color,
    tables: config.tables,
  };
}
