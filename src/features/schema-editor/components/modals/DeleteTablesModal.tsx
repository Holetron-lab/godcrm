/**
 * DeleteTablesModal - Confirmation modal for bulk table deletion
 * Requires typing "delete X funny items" to confirm
 */

import { logger } from '@/shared/utils/logger';
import { useState, useMemo, useEffect } from 'react';
import { Modal } from '@/shared/components/ui/Modal';
import { Input } from '@/shared/components/ui/Input';
import { Button } from '@/shared/components/ui/Button';
import { AlertTriangle, Trash2, Table2 } from 'lucide-react';
import { useLanguage } from '@/shared/i18n/LanguageContext';

// 50 random funny/sarcastic words for confirmation
const RANDOM_WORDS = [
  'dumb', 'silly', 'useless', 'forgotten', 'abandoned', 'cursed', 'doomed',
  'unlucky', 'obsolete', 'ancient', 'dusty', 'rusty', 'broken', 'haunted',
  'weird', 'strange', 'mysterious', 'chaotic', 'messy', 'cluttered',
  'unnecessary', 'redundant', 'legacy', 'outdated', 'deprecated',
  'boring', 'tedious', 'annoying', 'stubborn', 'pesky', 'troublesome',
  'rotten', 'stinky', 'moldy', 'crusty', 'creepy', 'spooky', 'ghostly',
  'evil', 'wicked', 'nasty', 'grumpy', 'cranky', 'moody', 'gloomy',
  'lonely', 'sad', 'pathetic', 'hopeless', 'desperate'
];

interface DeleteTablesModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tables: Array<{ id: number; name: string; displayName?: string; icon?: string }>;
  onConfirm: () => Promise<void>;
}

export const DeleteTablesModal = ({
  open,
  onOpenChange,
  tables,
  onConfirm
}: DeleteTablesModalProps) => {
  const { t } = useLanguage();
  const [confirmText, setConfirmText] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);

  // Generate random word on open
  const randomWord = useMemo(() => {
    return RANDOM_WORDS[Math.floor(Math.random() * RANDOM_WORDS.length)];
  }, [open]);

  // Expected confirmation phrase
  const expectedPhrase = `delete ${tables.length} ${randomWord} items`;

  // Check if input matches
  const isValid = confirmText.toLowerCase().trim() === expectedPhrase.toLowerCase();

  // Reset on close
  useEffect(() => {
    if (!open) {
      setConfirmText('');
      setIsDeleting(false);
    }
  }, [open]);

  const handleConfirm = async () => {
    if (!isValid) return;
    
    setIsDeleting(true);
    try {
      await onConfirm();
      onOpenChange(false);
    } catch (error) {
      logger.error('Delete failed:', error);
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={
        <div className="flex items-center gap-2 text-red-500">
          <AlertTriangle className="w-5 h-5" />
          <span>Удаление {tables.length} таблиц</span>
        </div>
      }
    >
      <div className="space-y-4">
        {/* Warning */}
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4">
          <p className="text-red-500 font-medium mb-2">
            ⚠️ Это действие необратимо!
          </p>
          <p className="text-sm text-[var(--text-secondary)]">
            Все данные в этих таблицах будут удалены навсегда. Связи с другими таблицами будут разорваны.
          </p>
        </div>

        {/* Tables list */}
        <div className="border border-[var(--border-primary)] rounded-lg overflow-hidden">
          <div className="bg-[var(--bg-secondary)] px-3 py-2 border-b border-[var(--border-primary)]">
            <span className="text-sm font-medium text-[var(--text-primary)]">
              Таблицы для удаления ({tables.length})
            </span>
          </div>
          <div className="max-h-48 overflow-y-auto">
            {tables.map((table) => (
              <div
                key={table.id}
                className="flex items-center gap-2 px-3 py-2 border-b border-[var(--border-secondary)] last:border-b-0 hover:bg-[var(--bg-secondary)]"
              >
                <span className="text-base">{table.icon || '📋'}</span>
                <span className="flex-1 text-sm text-[var(--text-primary)] truncate">
                  {table.displayName || table.name}
                </span>
                <span className="text-xs text-[var(--text-tertiary)] font-mono">
                  #{table.id}
                </span>
                <Table2 className="w-3.5 h-3.5 text-green-500" />
              </div>
            ))}
          </div>
        </div>

        {/* Confirmation input */}
        <div className="space-y-2">
          <label className="block text-sm font-medium text-[var(--text-primary)]">
            Для подтверждения введите:
          </label>
          <div className="bg-[var(--bg-tertiary)] rounded-lg px-3 py-2 font-mono text-sm text-[var(--accent-primary)] select-all">
            {expectedPhrase}
          </div>
          <Input
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder="Введите фразу выше..."
            className={`font-mono ${isValid ? 'border-green-500 focus:border-green-500' : ''}`}
            autoFocus
          />
          {confirmText && !isValid && (
            <p className="text-xs text-red-500">
              Фраза не совпадает. Проверьте правильность ввода.
            </p>
          )}
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-3 pt-2">
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={isDeleting}
          >
            Отмена
          </Button>
          <Button
            variant="default"
            onClick={handleConfirm}
            disabled={!isValid || isDeleting}
            className={`${isValid ? 'bg-red-600 hover:bg-red-700' : 'opacity-50'}`}
          >
            {isDeleting ? (
              <>
                <span className="animate-spin mr-2">⏳</span>
                Удаление...
              </>
            ) : (
              <>
                <Trash2 className="w-4 h-4 mr-2" />
                Удалить {tables.length} таблиц
              </>
            )}
          </Button>
        </div>
      </div>
    </Modal>
  );
};

export default DeleteTablesModal;
