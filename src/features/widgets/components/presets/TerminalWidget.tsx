/**
 * TerminalWidget - ADR-076
 * Dashboard widget wrapper for the terminal panel.
 */

import { TerminalPanel } from '@/features/terminal';
import type { WidgetRendererProps } from '../../types/widget.types';

export function TerminalWidget({ widget }: WidgetRendererProps) {
  return (
    <TerminalPanel
      className="h-full"
      defaultTitle={widget.title || 'Terminal'}
    />
  );
}
