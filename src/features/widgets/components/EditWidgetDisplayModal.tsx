import { useState, useEffect } from 'react';
import { logger } from '@/shared/utils/logger';
import { useQueryClient } from '@tanstack/react-query';
import { Modal } from '@/shared/components/ui/Modal';
import { Input } from '@/shared/components/ui/Input';
import { Button, Switch } from '@/shared/components/ui';
import { Globe } from 'lucide-react';
import { updateWidget } from '../api/widgetsApi';
import { apiClient } from '@/shared/utils/apiClient';
import { EmojiPicker } from '@/features/tables/components/UniversalTable/EmojiPicker';

interface EditWidgetDisplayModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  widgetId: number;
  currentTitle: string;
  currentIcon?: string;
  currentDescription?: string;
  tableId?: number | string;
  onDeleteClick?: () => void;
}

export const EditWidgetDisplayModal = ({
  open,
  onOpenChange,
  widgetId,
  currentTitle,
  currentIcon,
  currentDescription,
  tableId,
  onDeleteClick
}: EditWidgetDisplayModalProps) => {
  const queryClient = useQueryClient();

  const [title, setTitle] = useState(currentTitle);
  const [icon, setIcon] = useState(currentIcon || '📊');
  const [description, setDescription] = useState(currentDescription || '');
  const [isPublic, setIsPublic] = useState<boolean>(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [tableDefaults, setTableDefaults] = useState<{ name?: string; icon?: string; description?: string } | null>(null);
  const [titleTouched, setTitleTouched] = useState(false);
  const [iconTouched, setIconTouched] = useState(false);
  const [descriptionTouched, setDescriptionTouched] = useState(false);

  const resolveDefaultTitle = () => {
    const fallbackTitle = (currentTitle || '').trim();
    const lowerTitle = fallbackTitle.toLowerCase();
    const isGenericTitle = !lowerTitle || ['таблица', 'table', 'table_view', 'table view'].includes(lowerTitle);
    if (tableDefaults?.name && isGenericTitle) {
      return tableDefaults.name;
    }
    return fallbackTitle || tableDefaults?.name || '';
  };

  const resolveDefaultIcon = () => {
    const fallbackIcon = currentIcon || '📊';
    const isGenericIcon = !currentIcon || currentIcon === '📊';
    if (tableDefaults?.icon && isGenericIcon) {
      return tableDefaults.icon;
    }
    return fallbackIcon || tableDefaults?.icon || '📊';
  };

  const resolveDefaultDescription = () => {
    const fallbackDescription = (currentDescription || '').trim();
    if (!fallbackDescription && tableDefaults?.description) {
      return tableDefaults.description;
    }
    return fallbackDescription;
  };

  // Reset form when modal opens
  useEffect(() => {
    if (open) {
      setTitle(resolveDefaultTitle());
      setIcon(resolveDefaultIcon());
      setDescription(resolveDefaultDescription());
      setTitleTouched(false);
      setIconTouched(false);
      setDescriptionTouched(false);
      setError('');
    }
  }, [open, currentTitle, currentIcon, currentDescription, tableDefaults]);

  // Fetch widget's stored is_public (ADR-0060 opt-out) so the toggle shows
  // the current state. Lives in the modal so callers don't need to drill it.
  useEffect(() => {
    if (!open) return;
    let isActive = true;
    apiClient
      .request<{ data: { is_public?: boolean } }>(`/widgets/${widgetId}`)
      .then((resp) => {
        if (isActive) setIsPublic(resp.data.is_public !== false);
      })
      .catch((e) => logger.error('Failed to load widget is_public:', e));
    return () => { isActive = false; };
  }, [open, widgetId]);

  useEffect(() => {
    if (!open) return;
    if (!titleTouched) {
      setTitle(resolveDefaultTitle());
    }
    if (!iconTouched) {
      setIcon(resolveDefaultIcon());
    }
    if (!descriptionTouched) {
      setDescription(resolveDefaultDescription());
    }
  }, [open, tableDefaults, titleTouched, iconTouched, descriptionTouched]);

  useEffect(() => {
    if (!open || !tableId) {
      setTableDefaults(null);
      return;
    }
    let isActive = true;
    const loadTableDefaults = async () => {
      try {
        const response = await apiClient.request<{
          data: { display_name?: string; name?: string; icon?: string | null; description?: string | null };
        }>(`/tables/${tableId}`);
        if (isActive) {
          setTableDefaults({
            name: response.data.display_name || response.data.name,
            icon: response.data.icon || undefined,
            description: response.data.description || undefined
          });
        }
      } catch (loadError) {
        logger.error('Failed to load table defaults:', loadError);
      }
    };
    loadTableDefaults();
    return () => {
      isActive = false;
    };
  }, [open, tableId]);

  const handleSubmit = async () => {
    if (!title.trim()) {
      setError('Название не может быть пустым');
      return;
    }

    setSaving(true);
    setError('');

    try {
      await updateWidget(widgetId, {
        title: title.trim(),
        icon: icon,
        description: description.trim(),
        is_public: isPublic
      });
      
      // Invalidate widget queries to refresh sidebar
      queryClient.invalidateQueries({ queryKey: ['widgets'] });
      queryClient.invalidateQueries({ queryKey: ['spaces'] });
      queryClient.invalidateQueries({ queryKey: ['dashboards'] });
      
      onOpenChange(false);
      // Refresh to update sidebar
      window.location.reload();
    } catch (err) {
      logger.error('Error updating widget:', err);
      setError('Ошибка при сохранении');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Редактировать виджет" size="sm">
      <div className="space-y-4">
        {error && (
          <div className="rounded-lg bg-red-50 dark:bg-red-900/20 p-3 text-sm text-red-600 dark:text-red-400">
            {error}
          </div>
        )}

        <div className="grid gap-4 grid-cols-[auto,1fr] items-end">
          <div>
            <label className="mb-2 block text-sm font-medium text-[var(--text-primary)]">
              Иконка
            </label>
          <EmojiPicker
            value={icon}
            onChange={(value) => {
              setIcon(value);
              setIconTouched(true);
            }}
            size="md"
            label=""
            portal
          />
          </div>
          <div>
            <label htmlFor="widget-title" className="mb-2 block text-sm font-medium text-[var(--text-primary)]">
              Название виджета
            </label>
            <Input
              id="widget-title"
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                setTitleTouched(true);
              }}
              placeholder="Введите название виджета"
              autoComplete="off"
            />
          </div>
        </div>

        <div>
          <label htmlFor="widget-description" className="mb-2 block text-sm font-medium text-[var(--text-primary)]">
            Описание виджета
          </label>
          <textarea
            id="widget-description"
            value={description}
            onChange={(e) => {
              setDescription(e.target.value);
              setDescriptionTouched(true);
            }}
            placeholder="Описание для тултипа в меню"
            rows={2}
            className="w-full px-3 py-2 rounded-md border border-[var(--border-primary)] bg-[var(--bg-primary)] text-sm resize-none"
          />
        </div>

        <div className="p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-primary)]">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-2">
              <Globe className="w-4 h-4 mt-0.5 text-[var(--accent-primary)] flex-shrink-0" />
              <div className="space-y-1">
                <div className="text-sm font-medium text-[var(--text-primary)]">Виден в публичном пространстве</div>
                <p className="text-xs text-[var(--text-secondary)]">
                  Если space опубликована, виджет (модуль) виден read-only посетителям. Выключите, чтобы скрыть.
                </p>
              </div>
            </div>
            <Switch checked={isPublic} onCheckedChange={setIsPublic} />
          </div>
        </div>

        <div className="text-xs text-[var(--text-tertiary)] flex flex-wrap gap-4">
          <span>Виджет #{widgetId}</span>
          {(tableDefaults?.name || tableId) && (
            <span>
              Таблица: {tableDefaults?.name || ''}{tableDefaults?.name && tableId ? ` (#${tableId})` : tableId && !tableDefaults?.name ? `#${tableId}` : ''}
            </span>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 pt-2">
          {onDeleteClick && (
            <button 
              type="button"
              onClick={() => {
                onDeleteClick();
                onOpenChange(false);
              }}
              className="px-4 py-2 text-sm font-medium text-red-400 border border-red-500/30 rounded-lg hover:bg-red-500/10 hover:border-red-500/50 transition-colors"
            >
              Удалить виджет
            </button>
          )}
          {!onDeleteClick && <div />}
          <div className="flex gap-2">
            <Button
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={saving}
            >
              Отмена
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={saving || !title.trim()}
            >
              {saving ? 'Сохранение...' : 'Сохранить'}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
};
