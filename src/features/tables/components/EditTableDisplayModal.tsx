import { useState, useEffect } from 'react';
import { logger } from '@/shared/utils/logger';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Modal } from '@/shared/components/ui/Modal';
import { Input } from '@/shared/components/ui/Input';
import { Button } from '@/shared/components/ui';
import { tablesApi } from '../api/tablesApi';
import { apiClient } from '@/shared/utils/apiClient';

interface EditTableDisplayModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tableId: number | string;
  projectId?: number | null;
}

const TABLE_ICONS = [
  '📊', '📋', '📅', '📈', '📦', '📁', '📝', '📌', '🎯', '⭐', '💡', '🔥',
  '✅', '💼', '🏷️', '📎', '🔗', '💰', '👥', '🛒', '📱', '💻', '🏠', '🚀',
  '🗃️', '🗂️', '📄', '📃', '📑', '📒'
];

export const EditTableDisplayModal = ({ open, onOpenChange, tableId, projectId }: EditTableDisplayModalProps) => {
  const queryClient = useQueryClient();
  
  // Fetch fresh table data when modal opens
  const { data: tableData, isLoading } = useQuery({
    queryKey: ['edit-table-display', tableId, projectId],
    queryFn: async () => {
      if (projectId) {
        try {
          const response = await apiClient.request<{ data: Array<{ id: number; name: string; display_name?: string; icon?: string }> }>(
            `/projects/${projectId}/tables`
          );
          const found = response.data.find(t => String(t.id) === String(tableId));
          if (found) {
            return {
              id: found.id,
              name: found.name,
              displayName: found.display_name || found.name,
              icon: found.icon || null
            };
          }
        } catch (e) {
          logger.error('[EditTableDisplayModal] Project tables fetch failed:', e);
        }
      }
      
      // Direct table fetch
      const response = await apiClient.request<{ data: { id: number; name: string; display_name?: string; icon?: string } }>(
        `/tables/${tableId}`
      );
      return {
        id: response.data.id,
        name: response.data.name,
        displayName: response.data.display_name || response.data.name,
        icon: response.data.icon || null
      };
    },
    enabled: open,
    staleTime: 0,
  });

  const [displayName, setDisplayName] = useState('');
  const [icon, setIcon] = useState('📋');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Set form values when data loads
  useEffect(() => {
    if (tableData) {
      setDisplayName(tableData.displayName);
      setIcon(tableData.icon || '📋');
    }
    setError('');
  }, [tableData, open]);

  const handleSubmit = async () => {
    if (!displayName.trim()) {
      setError('Название не может быть пустым');
      return;
    }

    setSaving(true);
    setError('');

    try {
      await tablesApi.updateTable(String(tableId), {
        displayName: displayName.trim(),
        icon: icon
      });
      
      queryClient.invalidateQueries({ queryKey: ['project-tables'] });
      queryClient.invalidateQueries({ queryKey: ['tables'] });
      
      onOpenChange(false);
      window.location.reload();
    } catch (err) {
      logger.error('Error updating:', err);
      setError('Ошибка при сохранении');
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    if (!tableData) return;
    
    if (!confirm('Вы уверены, что хотите сбросить к исходному названию таблицы?')) return;

    setSaving(true);
    setError('');

    try {
      await tablesApi.updateTable(String(tableId), {
        displayName: tableData.name,
        icon: null
      });
      
      queryClient.invalidateQueries({ queryKey: ['project-tables'] });
      queryClient.invalidateQueries({ queryKey: ['tables'] });
      
      onOpenChange(false);
      window.location.reload();
    } catch (err) {
      logger.error('Error resetting:', err);
      setError('Ошибка при сбросе настроек');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Редактировать отображение таблицы">
      <div className="space-y-4">
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[var(--color-primary-500)]"></div>
          </div>
        ) : (
          <>
            {error && (
              <div className="rounded-lg bg-red-50 dark:bg-red-900/20 p-3 text-sm text-red-600 dark:text-red-400">
                {error}
              </div>
            )}

            <div>
              <label htmlFor="table-display-name" className="mb-2 block text-sm font-medium text-[var(--text-primary)]">
                Отображаемое название
              </label>
              <Input
                id="table-display-name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Введите название таблицы"
                autoComplete="off"
              />
              {tableData && (
                <p className="mt-1 text-xs text-[var(--text-tertiary)]">
                  Исходное название: <span className="font-mono">{tableData.name}</span>
                </p>
              )}
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-[var(--text-primary)]">
                Иконка
              </label>
              <div className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] p-3">
                <div className="mb-3 flex items-center gap-3">
                  <div className="flex-1 flex items-center justify-center rounded-lg bg-[var(--bg-secondary)] py-4">
                    <span className="text-5xl">{icon}</span>
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-[var(--text-tertiary)]">
                      Своя иконка
                    </label>
                    <input
                      type="text"
                      value={icon}
                      onChange={(e) => {
                        const value = e.target.value;
                        if (value.length <= 2) setIcon(value || '📋');
                      }}
                      className="w-20 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-3 py-2 text-center text-2xl
                        focus:border-[var(--color-primary-500)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-500)]/20"
                      maxLength={2}
                    />
                  </div>
                </div>
                <div className="grid max-h-48 grid-cols-10 gap-1 overflow-y-auto">
                  {TABLE_ICONS.map((emoji, index) => (
                    <button
                      key={`${emoji}-${index}`}
                      type="button"
                      onClick={() => setIcon(emoji)}
                      className={`flex h-9 w-9 items-center justify-center rounded-lg text-xl transition ${
                        icon === emoji
                          ? 'bg-[var(--color-primary-500)]/20 ring-2 ring-[var(--color-primary-500)]'
                          : 'hover:bg-[var(--bg-tertiary)]'
                      }`}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between gap-3 pt-4 border-t border-[var(--border-primary)] mt-4">
              <button 
                type="button"
                onClick={handleReset}
                disabled={saving || !tableData}
                className="px-4 py-2 text-sm font-medium text-red-400 border border-red-500/30 rounded-lg hover:bg-red-500/10 hover:border-red-500/50 transition-colors disabled:opacity-50"
              >
                Сбросить
              </button>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => onOpenChange(false)}
                  disabled={saving}
                  className="px-4 py-2 text-sm font-medium text-[var(--text-secondary)] border border-[var(--border-primary)] rounded-lg hover:bg-[var(--bg-tertiary)] transition-colors"
                >
                  Отмена
                </button>
                <Button variant="primary" onClick={handleSubmit} disabled={saving}>
                  {saving ? 'Сохранение...' : 'Сохранить'}
                </Button>
              </div>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
};
