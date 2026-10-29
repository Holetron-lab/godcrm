import { ExternalLink } from 'lucide-react';
import type { TableWidgetSummary } from '../../types/schema-editor.types';
import { getWidgetIcon } from '../widgetIcon';

// Each strip is tucked this far behind the thing below it (the card, then the next strip),
// so modules read as tabs sticking out from behind the table.
const TUCK_PX = 8;
const STRIP_HEIGHT = 28;
// Visible rise of each strip: content + top border - overlap. Shared with project bounds.
export const WIDGET_STRIP_RISE = STRIP_HEIGHT + 1 - TUCK_PX;

interface TableWidgetStripsProps {
  widgets: TableWidgetSummary[];
  openLabel: string;
}

/**
 * Modules built on a table, drawn as full-width strips glued above its card.
 * Lives inside the TableNode DOM: moves with the table, stacks when there are several,
 * and the card paints over the strips' lower edge.
 */
export const TableWidgetStrips = ({ widgets, openLabel }: TableWidgetStripsProps) => (
  <div
    className="absolute left-0 right-0 isolate flex flex-col-reverse px-2"
    style={{ bottom: `calc(100% - ${TUCK_PX}px)` }}
    data-testid="table-widget-strips"
  >
    {widgets.map((widget, index) => {
      const Icon = getWidgetIcon(widget.presetName, widget.widgetConfig);
      return (
        <div
          key={widget.widgetId}
          style={{ zIndex: widgets.length - index, marginBottom: index === 0 ? 0 : -TUCK_PX }}
          className="rounded-t-lg border border-b-0 border-purple-500/40 bg-[var(--bg-primary)]"
          data-testid={`table-widget-${widget.widgetId}`}
        >
          <div
            style={{ height: STRIP_HEIGHT, paddingBottom: TUCK_PX }}
            className="flex items-center gap-2 rounded-t-lg bg-purple-500/15 px-3 text-xs text-purple-700 dark:bg-purple-500/20 dark:text-purple-200"
          >
            <Icon className="h-3.5 w-3.5 flex-shrink-0 text-purple-500" aria-hidden="true" />
            <span className="truncate font-medium">{widget.icon ? `${widget.icon} ` : ''}{widget.name}</span>
            <span className="ml-auto flex-shrink-0 text-[10px] uppercase tracking-wide text-purple-500/80">
              {widget.presetName || 'module'}
            </span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                window.open(`/widgets/${widget.widgetId}`, '_blank', 'noopener,noreferrer');
              }}
              className="nodrag flex-shrink-0 rounded p-0.5 transition-colors hover:bg-purple-500/30"
              title={openLabel}
              aria-label={`${openLabel}: ${widget.name}`}
            >
              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
        </div>
      );
    })}
  </div>
);
