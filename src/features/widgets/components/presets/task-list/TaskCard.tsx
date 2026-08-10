import { useState, useRef, useEffect, useMemo } from 'react';
import {
  CheckSquare, Square, ChevronDown, ChevronRight,
  Calendar, MessageSquare, Palette, MoreHorizontal,
} from 'lucide-react';
import type { FieldValue } from '../kanban/kanban-types';

export interface TaskItem {
  id: string;
  data: Record<string, unknown>;
}

export interface ColumnInfo {
  name: string;
  displayName: string;
  type: string;
  config?: {
    options?: Array<{ value: string; label?: string; color?: string }>;
  };
}

export interface TaskCardProps {
  item: TaskItem;
  isCompleted: boolean;
  cardTitleColumn?: string;
  cardSubtitleColumn?: string;
  scheduledDateColumn?: string;
  dueDateColumn?: string;
  colorColumn?: string;
  cardColumns?: string[];
  visibleColumns?: string[];
  columnsInfo?: ColumnInfo[];
  onToggle: (completed: boolean) => void;
  onDoubleClick?: (initialTab?: 'details' | 'files' | 'comments') => void;
  onUpdate?: (field: string, value: FieldValue) => void;
  translations?: {
    openFull?: string;
    comments?: string;
    description?: string;
    noDescription?: string;
    moreFields?: string;
  };
}

const hexToRgba = (hex: string | undefined, alpha: number): string => {
  if (!hex) return `rgba(100, 116, 139, ${alpha})`;
  const cleanHex = hex.replace('#', '');
  const r = parseInt(cleanHex.substring(0, 2), 16);
  const g = parseInt(cleanHex.substring(2, 4), 16);
  const b = parseInt(cleanHex.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

export const formatShortDate = (dateString: string | null | undefined): string | null => {
  if (!dateString) return null;
  try {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return null;
    const day = date.getDate();
    const month = date.toLocaleString('ru', { month: 'short' }).replace('.', '');
    return `${day} ${month}`;
  } catch {
    return null;
  }
};

const isOverdue = (dateString: string | null | undefined): boolean => {
  if (!dateString) return false;
  try {
    const date = new Date(dateString);
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    return date < now;
  } catch {
    return false;
  }
};

const colorPalette = [
  '#ef4444', '#f97316', '#eab308', '#22c55e', '#14b8a6',
  '#0ea5e9', '#6366f1', '#a855f7', '#ec4899', '#64748b',
  '#f43f5e', '#84cc16', '#06b6d4', '#8b5cf6', '#e11d48',
];

export function TaskCard({
  item,
  isCompleted,
  cardTitleColumn = 'title',
  cardSubtitleColumn = 'description',
  scheduledDateColumn,
  dueDateColumn,
  colorColumn,
  cardColumns = [],
  visibleColumns = [],
  columnsInfo = [],
  onToggle,
  onDoubleClick,
  onUpdate,
  translations = {},
}: TaskCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const colorPickerRef = useRef<HTMLDivElement>(null);

  const rowData = item.data || item;
  const title = rowData[cardTitleColumn] || 'Без названия';
  const subtitle = rowData[cardSubtitleColumn];
  const cardColor = colorColumn ? rowData[colorColumn] : undefined;
  const scheduledDate = scheduledDateColumn ? formatShortDate(rowData[scheduledDateColumn]) : null;
  const dueDate = dueDateColumn ? formatShortDate(rowData[dueDateColumn]) : null;
  const isDueDateOverdue = dueDateColumn && !isCompleted ? isOverdue(rowData[dueDateColumn]) : false;

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (colorPickerRef.current && !colorPickerRef.current.contains(event.target as Node)) {
        setShowColorPicker(false);
      }
    };
    if (showColorPicker) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showColorPicker]);

  const visibleFields = useMemo(() => {
    const excludedColumns = [
      cardTitleColumn, cardSubtitleColumn, scheduledDateColumn,
      dueDateColumn, colorColumn, 'id',
    ].filter(Boolean);
    const columnsToShow = visibleColumns.length > 0 ? visibleColumns : cardColumns;
    return columnsToShow
      .filter(c => !excludedColumns.includes(c) && rowData[c] !== undefined && rowData[c] !== null && rowData[c] !== '')
      .map(c => {
        const ci = columnsInfo.find(x => x.name === c);
        return {
          name: c,
          displayName: ci?.displayName || c,
          type: ci?.type || 'text',
          value: rowData[c],
          config: ci?.config,
        };
      });
  }, [rowData, cardTitleColumn, cardSubtitleColumn, scheduledDateColumn, dueDateColumn, colorColumn, cardColumns, visibleColumns, columnsInfo]);

  const renderFieldValue = (field: typeof visibleFields[0]) => {
    const { type, value, config } = field;
    if (value === null || value === undefined || value === '') {
      return <span className="text-[var(--text-tertiary)] italic">—</span>;
    }
    switch (type) {
      case 'select': {
        const option = config?.options?.find(opt => opt.value === value);
        return option ? (
          <span className="inline-flex px-2 py-0.5 rounded-md text-xs font-medium" style={{ backgroundColor: option.color ? hexToRgba(option.color, 0.2) : 'var(--bg-tertiary)', color: option.color || 'var(--text-primary)' }}>
            {option.label || value}
          </span>
        ) : <span>{value}</span>;
      }
      case 'multiselect': {
        const values = Array.isArray(value) ? value : [value];
        return (
          <div className="flex flex-wrap gap-1">
            {values.map((v, i) => {
              const opt = config?.options?.find(o => o.value === v);
              return (
                <span key={i} className="inline-flex px-2 py-0.5 rounded-md text-xs font-medium" style={{ backgroundColor: opt?.color ? hexToRgba(opt.color, 0.2) : 'var(--bg-tertiary)', color: opt?.color || 'var(--text-primary)' }}>
                  {opt?.label || v}
                </span>
              );
            })}
          </div>
        );
      }
      case 'date':
      case 'datetime':
        return <span className="text-[var(--text-secondary)]">{formatShortDate(value)}</span>;
      case 'number':
        return <span className="text-[var(--text-primary)] font-medium">{value}</span>;
      case 'boolean':
      case 'checkbox':
        return value
          ? <CheckSquare className="w-4 h-4 text-green-500" />
          : <Square className="w-4 h-4 text-[var(--text-tertiary)]" />;
      case 'url':
        return (
          <a href={value} target="_blank" rel="noopener noreferrer" className="text-primary-500 hover:underline truncate max-w-[150px] inline-block" onClick={(e) => e.stopPropagation()}>
            {value}
          </a>
        );
      default:
        return <span className="text-[var(--text-secondary)] truncate">{String(value)}</span>;
    }
  };

  const handleColorChange = (color: string | null) => {
    setShowColorPicker(false);
    if (colorColumn && onUpdate) onUpdate(colorColumn, color);
  };

  const handleToggleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onToggle(!isCompleted);
  };

  return (
    <div
      className={`group relative rounded-lg border transition-all duration-200 cursor-pointer
        ${isCompleted
          ? 'bg-[var(--bg-secondary)] border-[var(--border-secondary)] opacity-70'
          : 'bg-[var(--bg-primary)] border-[var(--border-primary)] hover:shadow-md'
        }`}
      style={{ borderLeftWidth: '4px', borderLeftColor: cardColor || 'var(--border-primary)' }}
      onClick={() => setIsExpanded(!isExpanded)}
      onDoubleClick={() => onDoubleClick?.('details')}
    >
      <div className="p-3">
        <div className="flex items-start gap-3">
          <button onClick={handleToggleClick} className="flex-shrink-0 mt-0.5 text-[var(--text-secondary)] hover:text-green-500 transition-colors">
            {isCompleted ? <CheckSquare className="w-5 h-5 text-green-500" /> : <Square className="w-5 h-5" />}
          </button>
          <div className="flex-1 min-w-0">
            <div className={`font-medium text-sm ${isCompleted ? 'line-through text-[var(--text-tertiary)]' : 'text-[var(--text-primary)]'}`}>{title}</div>
            {subtitle && (
              <div className={`text-xs mt-0.5 line-clamp-1 ${isCompleted ? 'line-through text-[var(--text-tertiary)]' : 'text-[var(--text-secondary)]'}`}>{subtitle}</div>
            )}
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              {scheduledDate && (
                <span className="inline-flex items-center gap-1 text-xs text-[var(--text-tertiary)]">
                  <Calendar className="w-3 h-3" /> {scheduledDate}
                </span>
              )}
              {dueDate && (
                <span className={`inline-flex items-center gap-1 text-xs ${isDueDateOverdue ? 'text-red-500' : 'text-[var(--text-tertiary)]'}`}>
                  <Calendar className="w-3 h-3" /> → {dueDate}
                </span>
              )}
              {colorColumn && (
                <div className="relative" ref={colorPickerRef}>
                  <button
                    onClick={(e) => { e.stopPropagation(); setShowColorPicker(!showColorPicker); }}
                    className="p-1 rounded hover:bg-[var(--bg-tertiary)] transition-colors"
                    title="Изменить цвет"
                  >
                    <Palette className="w-3.5 h-3.5" style={{ color: cardColor || 'var(--text-tertiary)' }} />
                  </button>
                  {showColorPicker && (
                    <div className="absolute top-full left-0 mt-1 p-2 bg-[var(--bg-primary)] rounded-lg shadow-lg border border-[var(--border-primary)] z-50" onClick={(e) => e.stopPropagation()}>
                      <div className="grid grid-cols-5 gap-1.5 mb-2">
                        {colorPalette.map((color) => (
                          <button
                            key={color}
                            className={`w-6 h-6 rounded-md transition-transform hover:scale-110 ${cardColor === color ? 'ring-2 ring-offset-1 ring-primary-500' : ''}`}
                            style={{ backgroundColor: color }}
                            onClick={() => handleColorChange(color)}
                          />
                        ))}
                      </div>
                      {cardColor && (
                        <button onClick={() => handleColorChange(null)} className="w-full text-xs text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] py-1">
                          Убрать цвет
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
          <button
            onClick={(e) => { e.stopPropagation(); setIsExpanded(!isExpanded); }}
            className="flex-shrink-0 p-1 rounded hover:bg-[var(--bg-tertiary)] text-[var(--text-tertiary)] transition-colors"
          >
            {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          </button>
        </div>
      </div>
      {isExpanded && visibleFields.length > 0 && (
        <div className="px-3 pb-3 pt-0 border-t border-[var(--border-secondary)] mt-1">
          <div className="grid grid-cols-2 gap-2 mt-2">
            {visibleFields.map((field) => (
              <div key={field.name} className="flex flex-col">
                <span className="text-xs text-[var(--text-tertiary)] mb-0.5">{field.displayName}</span>
                <div className="text-sm">{renderFieldValue(field)}</div>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-2 mt-3 pt-2 border-t border-[var(--border-secondary)]">
            <button
              onClick={(e) => { e.stopPropagation(); onDoubleClick?.('details'); }}
              className="text-xs text-[var(--text-tertiary)] hover:text-[var(--text-primary)] flex items-center gap-1 transition-colors"
            >
              <MoreHorizontal className="w-3.5 h-3.5" /> {translations.openFull || 'Открыть'}
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onDoubleClick?.('comments'); }}
              className="text-xs text-[var(--text-tertiary)] hover:text-[var(--text-primary)] flex items-center gap-1 transition-colors"
            >
              <MessageSquare className="w-3.5 h-3.5" /> {translations.comments || 'Комментарии'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
