import { useState } from 'react';
import { Pencil, Trash2, Maximize2, Minimize2, GripVertical } from 'lucide-react';
import type { WidgetContainerProps } from '../types/widget.types';
import { WidgetRenderer } from './WidgetRenderer';
import { getWidgetDisplayName } from '../utils/getWidgetDisplayName';

export function WidgetContainer({
  widget,
  data = [],
  isEditable = false,
  onEdit,
  onDelete,
  onResize,
}: WidgetContainerProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  const handleEdit = () => {
    onEdit?.(widget);
  };

  const handleDelete = () => {
    if (window.confirm(`Delete widget "${widget.title}"?`)) {
      onDelete?.(widget.id);
    }
  };

  const handleToggleExpand = () => {
    if (!isExpanded) {
      // Expand to full width
      onResize?.(widget.id, {
        ...widget.position,
        w: 12,
        h: 8,
      });
    } else {
      // Restore original size
      onResize?.(widget.id, widget.position);
    }
    setIsExpanded(!isExpanded);
  };

  return (
    <div
      className="relative h-full bg-white rounded-lg border border-gray-200 shadow-sm hover:shadow-md transition-shadow overflow-hidden"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      data-testid={`widget-container-${widget.id}`}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-gray-50">
        <div className="flex items-center gap-2">
          {isEditable && (
            <div className="cursor-grab active:cursor-grabbing" data-testid="drag-handle">
              <GripVertical className="w-4 h-4 text-gray-400" />
            </div>
          )}
          <span className="text-lg">{widget.icon}</span>
          <h3 className="font-medium text-gray-900">{getWidgetDisplayName(widget)}</h3>
        </div>

        {/* Actions */}
        {isEditable && isHovered && (
          <div className="flex items-center gap-1" data-testid="widget-actions">
            <button
              onClick={handleToggleExpand}
              className="p-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded"
              title={isExpanded ? 'Minimize' : 'Maximize'}
              data-testid="widget-expand"
            >
              {isExpanded ? (
                <Minimize2 className="w-4 h-4" />
              ) : (
                <Maximize2 className="w-4 h-4" />
              )}
            </button>
            <button
              onClick={handleEdit}
              className="p-1.5 text-gray-500 hover:text-primary-600 hover:bg-primary-50 rounded"
              title="Edit widget"
              data-testid="widget-edit"
            >
              <Pencil className="w-4 h-4" />
            </button>
            <button
              onClick={handleDelete}
              className="p-1.5 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded"
              title="Delete widget"
              data-testid="widget-delete"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>

      {/* Widget Content */}
      <div className="p-4 overflow-auto h-[calc(100%-57px)]">
        <WidgetRenderer widget={widget} data={data} />
      </div>

      {/* Description tooltip (optional) */}
      {widget.description && isHovered && (
        <div className="absolute bottom-2 left-2 right-2 bg-gray-900 text-white text-xs px-2 py-1 rounded opacity-90">
          {widget.description}
        </div>
      )}
    </div>
  );
}
