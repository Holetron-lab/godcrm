/**
 * Labs Widget Preset Entry
 * MindWorkflow frozen — see branch: laboratory
 */

import { LabsWidget as LabsWidgetComponent } from '@/features/labs';
import type { PresetWidgetProps } from '../../types/widget.types';

export function LabsWidget({ widget }: PresetWidgetProps) {
  return (
    <LabsWidgetComponent
      widgetId={String(widget.id)}
    />
  );
}
