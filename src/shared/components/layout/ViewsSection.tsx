import { useState, useRef, useEffect } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  ChevronRight,
  ChevronDown,
  Plus,
  Loader2,
  Trash2
} from 'lucide-react';
import { useProjectWidgets } from '@/features/projects/hooks/useProjectWidgets';
import { useUpdateWidget, useDeleteWidget } from '@/features/widgets/hooks/useWidgets';
import { useLanguage } from '@/shared/i18n/LanguageContext';

// Local Widget type matching useProjectWidgets return
interface ProjectWidget {
  id: number;
  dashboard_id: number;
  title: string;
  icon: string;
  widget_type: 'preset' | 'custom';
  preset_name?: string;
  is_module?: boolean;
  // ADR-065: Module metadata from LEFT JOIN
  module_id?: number | null;
  sidebar_order?: number | null;
  sidebar_icon?: string | null;
  access_level?: 'admin' | 'member' | 'viewer' | null;
  is_pinned?: boolean | null;
  config?: {
    tableId?: string;
    table_id?: string;
    [key: string]: unknown;
  };
}

/**
 * Widget type to emoji mapping (fallback)
 */
const widgetEmoji: Record<string, string> = {
  table_view: '📊',
  kanban_board: '📋',
  calendar_widget: '📅',
  timeline_widget: '📈',
  chart_widget: '📉',
};

interface ViewsSectionProps {
  projectId: number;
  isExpanded?: boolean;
  onAddWidget?: () => void;
}

/**
 * ViewsSection - Section showing Widget Pages (full-screen views) in sidebar
 * 
 * Shows all widgets for a project that can be opened as full pages:
 * - TableView widgets → /tables/:tableId
 * - Kanban widgets → /widgets/:widgetId
 * - Calendar widgets → /widgets/:widgetId
 * - Timeline widgets → /widgets/:widgetId
 */
export function ViewsSection({ projectId, isExpanded = true, onAddWidget }: ViewsSectionProps) {
  const { language } = useLanguage();
  const t = (ru: string, en: string) => (language === 'ru' ? ru : en);
  const [isSectionExpanded, setIsSectionExpanded] = useState(isExpanded);
  const location = useLocation();
  const navigate = useNavigate();
  
  const { data: widgets = [], isLoading } = useProjectWidgets(projectId);
  const updateWidget = useUpdateWidget();
  const deleteWidget = useDeleteWidget();
  
  // Filter to only show modules (ADR-045: is_module flag from DB)
  const viewWidgets = widgets.filter((w) => w.is_module === true);
  
  // Don't show section if no view widgets
  if (!isLoading && viewWidgets.length === 0) {
    return null;
  }
  
  const getWidgetUrl = (widget: ProjectWidget): string => {
    // TableView widgets link directly to table
    if (widget.preset_name === 'table_view') {
      const tableId = widget.config?.tableId || widget.config?.table_id;
      if (tableId) {
        return `/tables/${tableId}`;
      }
    }
    // Other widgets link to widget editor/view
    return `/widgets/${widget.id}/edit`;
  };
  
  const isWidgetActive = (widget: ProjectWidget): boolean => {
    const url = getWidgetUrl(widget);
    return location.pathname === url || location.pathname.startsWith(url);
  };
  
  return (
    <div className="space-y-0.5">
      {/* Section Header */}
      <button
        onClick={() => setIsSectionExpanded(!isSectionExpanded)}
        className="w-full flex items-center gap-2 px-2 py-1.5 text-xs font-semibold text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors"
      >
        {isSectionExpanded ? (
          <ChevronDown className="w-3 h-3" />
        ) : (
          <ChevronRight className="w-3 h-3" />
        )}
        <span>📱 {t('Представления', 'Views')}</span>
        {viewWidgets.length > 0 && (
          <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-[var(--bg-tertiary)]">
            {viewWidgets.length}
          </span>
        )}
        {onAddWidget && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onAddWidget();
            }}
            className="ml-1 p-0.5 rounded hover:bg-[var(--bg-tertiary)] transition-colors"
            title={t('Добавить представление', 'Add view')}
          >
            <Plus className="w-3 h-3" />
          </button>
        )}
      </button>
      
      {/* Widgets List */}
      {isSectionExpanded && (
        <div className="ml-2 space-y-0.5">
          {isLoading ? (
            <div className="flex items-center gap-2 px-2 py-1 text-xs text-[var(--text-tertiary)]">
              <Loader2 className="w-3 h-3 animate-spin" />
              Loading...
            </div>
          ) : (
            viewWidgets.map((widget: ProjectWidget) => (
              <WidgetItem
                key={widget.id}
                widget={widget}
                isActive={isWidgetActive(widget)}
                url={getWidgetUrl(widget)}
                projectId={projectId}
                updateWidget={updateWidget}
                deleteWidget={deleteWidget}
                navigate={navigate}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Individual Widget Item with inline editing when active
 */
interface WidgetItemProps {
  widget: ProjectWidget;
  isActive: boolean;
  url: string;
  projectId: number;
  updateWidget: ReturnType<typeof useUpdateWidget>;
  deleteWidget: ReturnType<typeof useDeleteWidget>;
  navigate: ReturnType<typeof useNavigate>;
}

function WidgetItem({ widget, isActive, url, projectId, updateWidget, deleteWidget, navigate }: WidgetItemProps) {
  const { language } = useLanguage();
  const t = (ru: string, en: string) => (language === 'ru' ? ru : en);
  const [editName, setEditName] = useState(widget.title);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  
  const emoji = widget.icon || (widget.preset_name ? widgetEmoji[widget.preset_name] : '📊') || '📊';
  
  // Focus input when active
  useEffect(() => {
    if (isActive && inputRef.current) {
      // Don't auto-focus, let user click to edit
    }
  }, [isActive]);

  const handleSave = () => {
    if (editName.trim() && editName !== widget.title) {
      updateWidget.mutate({ 
        widgetId: widget.id, 
        updates: { title: editName.trim() }
      });
    }
  };

  const handleDelete = () => {
    deleteWidget.mutate(widget.id, {
      onSuccess: () => {
        navigate(`/projects/${projectId}`);
      }
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSave();
      inputRef.current?.blur();
    } else if (e.key === 'Escape') {
      setEditName(widget.title);
      inputRef.current?.blur();
    }
  };

  // Active state - show editable input
  if (isActive) {
    return (
      <div className="group relative flex items-center gap-2 px-2 py-1.5 rounded-lg bg-[var(--color-primary-500)]/20 text-[var(--color-primary-600)]">
        <span className="flex-shrink-0">{emoji}</span>
        <input
          ref={inputRef}
          type="text"
          value={editName}
          onChange={(e) => setEditName(e.target.value)}
          onBlur={handleSave}
          onKeyDown={handleKeyDown}
          className="flex-1 min-w-0 bg-transparent border-none outline-none text-xs font-medium truncate"
          title={t('Нажмите Enter для сохранения', 'Press Enter to save')}
        />
        {updateWidget.isPending && <Loader2 className="w-3 h-3 animate-spin" />}
        
        {/* Delete button */}
        <button
          onClick={() => setShowDeleteConfirm(true)}
          className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-red-500/10 rounded text-red-500"
          title={t('Удалить модуль', 'Delete module')}
        >
          <Trash2 className="w-3 h-3" />
        </button>
        
        {/* Delete confirmation popup */}
        {showDeleteConfirm && (
          <div className="absolute left-0 top-full mt-1 z-50 p-2 bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-lg shadow-lg">
            <p className="text-[10px] text-[var(--text-secondary)] mb-2">{t('Удалить модуль?', 'Delete module?')}</p>
            <div className="flex gap-1">
              <button
                onClick={handleDelete}
                disabled={deleteWidget.isPending}
                className="h-5 px-2 text-[9px] rounded bg-red-500 hover:bg-red-600 text-white disabled:opacity-50"
              >
                {deleteWidget.isPending ? '...' : t('Да', 'Yes')}
              </button>
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="h-5 px-2 text-[9px] rounded bg-[var(--bg-tertiary)] hover:bg-[var(--bg-primary)] text-[var(--text-secondary)]"
              >
                {t('Нет', 'No')}
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // Inactive state - regular link
  return (
    <NavLink
      to={url}
      className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs transition-colors text-[var(--text-tertiary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-secondary)]"
    >
      <span className="flex-shrink-0">{emoji}</span>
      <span className="truncate flex-1">{widget.title}</span>
      <span className="text-[10px] opacity-60 capitalize">
        {(widget.preset_name || widget.widget_type).replace('_widget', '').replace('_board', '').replace('_', ' ')}
      </span>
    </NavLink>
  );
}
