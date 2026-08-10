/**
 * WidgetNode - Simple purple node for widgets/views in Schema Editor
 * Shows widget icon, name, and opens in popup on click
 */

import { memo, useState, useCallback } from 'react';
import { Handle, Position } from '@xyflow/react';
import type { NodeProps } from '@xyflow/react';
import { 
  Calendar, 
  LayoutGrid, 
  Image, 
  BarChart3, 
  List, 
  Table2,
  ExternalLink,
  Eye
} from 'lucide-react';
import type { WidgetNodeData } from '../../types/schema-editor.types';
import { Modal } from '@/shared/components/ui/Modal';

interface WidgetNodeComponentProps extends NodeProps {
  data: WidgetNodeData;
}

// Get icon component based on widget type
const getWidgetIcon = (widgetType: string) => {
  switch (widgetType?.toLowerCase()) {
    case 'calendar':
      return Calendar;
    case 'kanban':
      return LayoutGrid;
    case 'gallery':
      return Image;
    case 'chart':
      return BarChart3;
    case 'list':
      return List;
    case 'table':
      return Table2;
    default:
      return Eye;
  }
};

export const WidgetNode = memo(({ data, selected }: WidgetNodeComponentProps) => {
  const {
    widgetId,
    displayName,
    name,
    icon,
    widgetType,
    mainTableId,
    projectId,
  } = data;

  const [showPreview, setShowPreview] = useState(false);

  // No handleClick - card is now draggable by default

  const handleOpenInNewTab = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    window.open(`/widgets/${widgetId}`, '_blank', 'noopener,noreferrer');
  }, [widgetId]);

  const handleOpenInline = useCallback(() => {
    // Just navigate to widget page in same tab
    window.location.href = `/widgets/${widgetId}`;
  }, [widgetId]);

  const IconComponent = getWidgetIcon(widgetType);

  return (
    <>
      {/* Hidden handle at top for connection from table */}
      <Handle 
        type="target" 
        position={Position.Top}
        id="widget-top"
        className="!w-0 !h-0 !bg-transparent !border-0"
      />
      {/* Hidden handles for potential other connections */}
      <Handle 
        type="target" 
        position={Position.Left} 
        className="!w-0 !h-0 !bg-transparent !border-0"
      />
      <Handle 
        type="source" 
        position={Position.Right} 
        className="!w-0 !h-0 !bg-transparent !border-0"
      />

      {/* Widget Card - draggable, no click handler */}
      <div
        className={`
          min-w-[160px] max-w-[220px] p-3 rounded-xl 
          bg-purple-600/20 hover:bg-purple-600/30
          border-2 cursor-grab
          transition-all duration-200
          ${selected 
            ? 'border-purple-400 shadow-lg shadow-purple-500/30' 
            : 'border-purple-500/50 hover:border-purple-400'
          }
        `}
      >
        {/* Header */}
        <div className="flex items-center gap-2">
          {/* Icon */}
          <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-purple-500/30 flex items-center justify-center">
            {icon ? (
              <span className="text-lg">{icon}</span>
            ) : (
              <IconComponent className="w-4 h-4 text-purple-400" />
            )}
          </div>

          {/* Name */}
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-purple-200 truncate">
              {displayName || name}
            </div>
            <div className="text-[10px] text-purple-400 uppercase tracking-wide">
              {widgetType || 'widget'}
            </div>
          </div>

          {/* Open in new tab button */}
          <button
            onClick={handleOpenInNewTab}
            className="flex-shrink-0 p-1 rounded hover:bg-purple-500/30 transition-colors"
            title="Открыть в новой вкладке"
          >
            <ExternalLink className="w-3.5 h-3.5 text-purple-400" />
          </button>
        </div>

        {/* Badge showing linked table */}
        {mainTableId && (
          <div className="mt-2 flex items-center gap-1 text-[10px] text-purple-400">
            <Table2 className="w-3 h-3" />
            <span>Table #{mainTableId}</span>
          </div>
        )}
      </div>

      {/* Hidden handle at bottom for outgoing edge to table - no visible dot */}
      <Handle 
        type="source" 
        position={Position.Bottom}
        id="widget-bottom"
        className="!w-0 !h-0 !bg-transparent !border-0"
      />

      {/* Preview Modal */}
      <Modal
        open={showPreview}
        onOpenChange={setShowPreview}
        title={
          <div className="flex items-center gap-2">
            <span>{icon}</span>
            <span>{displayName || name}</span>
          </div>
        }
        className="max-w-4xl"
      >
        <div className="w-full h-[70vh] flex flex-col items-center justify-center gap-4">
          <div className="text-[var(--text-secondary)] text-center">
            <p className="text-lg font-medium">{displayName || name}</p>
            <p className="text-sm mt-1">Тип: {widgetType || 'widget'}</p>
            {mainTableId && <p className="text-sm">Связана с таблицей #{mainTableId}</p>}
          </div>
          <button
            onClick={() => window.open(`/widgets/${widgetId}`, '_blank', 'noopener,noreferrer')}
            className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-lg flex items-center gap-2"
          >
            <ExternalLink className="w-4 h-4" />
            Открыть виджет
          </button>
        </div>
      </Modal>
    </>
  );
});

WidgetNode.displayName = 'WidgetNode';

export default WidgetNode;
