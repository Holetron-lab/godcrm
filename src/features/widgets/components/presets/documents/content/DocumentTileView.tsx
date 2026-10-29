/**
 * DocumentTileView — presentational A4 document tile.
 *
 * Pure UI layer extracted from DocumentTile so the same visual can be
 * mounted outside the documents widget (e.g. inside chat row attachments
 * via DocumentRowAtom). All data + callbacks come in via props — no
 * useDocumentsContext, no API calls.
 *
 * Each action button (chat / attach / download / settings / delete) only
 * renders if its callback is supplied. Status `<select>` becomes a
 * read-only pill if `onStatusChange` is absent.
 */

import { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Loader2, Trash2, Download, Settings, MessageCircle, Paperclip } from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { MarkdownPreview } from '@/shared/components/MarkdownPreview';
import { useLanguage } from '@/shared/i18n/LanguageContext';
import { getStatusChipClass, type DocumentRegistryItem, type StatusOption } from '../../../../types/documents.types';

export interface DocumentTileViewProps {
  doc: DocumentRegistryItem;
  preview: string;
  isLoadingPreview: boolean;
  statusOptions: StatusOption[];
  currentStatus?: StatusOption;
  isSelected?: boolean;
  /**
   * Apply A4 aspect ratio (default true). The chat surface passes false so
   * the tile sizes to its content instead of stretching to ~570px tall.
   */
  enforceAspectRatio?: boolean;

  onClick?: () => void;
  onStatusChange?: (newStatusId: number) => void | Promise<void>;
  onChat?: () => void;
  onAttach?: () => void;
  onDownload?: () => void | Promise<void>;
  onSettings?: () => void;
  onConfirmDelete?: () => Promise<void>;
}

export function DocumentTileView({
  doc,
  preview,
  isLoadingPreview,
  statusOptions,
  currentStatus,
  isSelected,
  enforceAspectRatio = true,
  onClick,
  onStatusChange,
  onChat,
  onAttach,
  onDownload,
  onSettings,
  onConfirmDelete,
}: DocumentTileViewProps) {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState(false);
  const { t } = useLanguage();

  const hasAnyAction = !!(onChat || onAttach || onDownload || onSettings || onConfirmDelete);

  return (
    <Dialog.Root open={showDeleteConfirm} onOpenChange={open => { if (!isDeleting) { setShowDeleteConfirm(open); setDeleteError(false); } }}>
    <div
      className={cn(
        'relative bg-white dark:bg-gray-900 rounded-lg shadow-lg',
        'border border-gray-200 dark:border-gray-700',
        'overflow-hidden transition-all duration-200',
        'hover:shadow-xl hover:scale-[1.02] hover:border-blue-500/50',
        'flex flex-col group',
        onClick && 'cursor-pointer',
        isSelected && 'ring-2 ring-blue-500 border-blue-500',
      )}
      style={enforceAspectRatio ? { aspectRatio: '1 / 1.414' } : undefined}
    >
      {/* Header — icon + name */}
      <div className="p-4 border-b border-gray-100 dark:border-gray-800 flex-shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-2xl flex-shrink-0">{doc.icon || '📄'}</span>
          <h3 className="font-medium text-base truncate text-gray-900 dark:text-gray-100 flex-1">
            {onClick ? (
              <button type="button" onClick={onClick} aria-label={`Открыть документ ${doc.name}`}
                className="text-left after:absolute after:inset-0 after:rounded-lg focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-blue-500">
                {doc.name}
              </button>
            ) : doc.name}
          </h3>
        </div>
      </div>

      {/* Body — description + markdown preview */}
      <div className="p-4 pb-14 flex-1 overflow-hidden flex flex-col">
        {doc.description && (
          <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed line-clamp-4 mb-2">
            {doc.description}
          </p>
        )}
        {doc.description && (
          <div className="my-2 border-t border-gray-200 dark:border-gray-700 flex-shrink-0" />
        )}
        <div className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed flex-1 overflow-hidden">
          {isLoadingPreview ? (
            <span className="italic text-gray-400">{t('documents.tilePreviewLoading')}</span>
          ) : preview ? (
            <div className="relative z-10 pointer-events-none [&_a]:pointer-events-auto [&_button]:pointer-events-auto line-clamp-8 prose prose-xs dark:prose-invert max-w-none">
              <MarkdownPreview content={preview} />
            </div>
          ) : (
            <span className="italic text-gray-400">{t('documents.tilePreviewEmpty')}</span>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="absolute z-10 bottom-0 left-0 right-0 bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-700">
        <div className="px-4 py-2.5 flex items-center gap-2">
          {doc.category && (
            <span className="px-2 py-0.5 rounded text-[10px] bg-blue-500/10 text-blue-500 dark:bg-blue-500/20 dark:text-blue-400">
              {doc.category}
            </span>
          )}

          {onStatusChange ? (
            <select
              aria-label="Статус документа"
              value={currentStatus?.id ?? ''}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => {
                e.stopPropagation();
                const newId = Number(e.target.value);
                if (Number.isFinite(newId)) onStatusChange(newId);
              }}
              className="px-1.5 py-0.5 rounded text-[10px] bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 cursor-pointer hover:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              {statusOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.icon ? `${option.icon} ` : ''}
                  {option.label}
                </option>
              ))}
            </select>
          ) : (currentStatus || doc.status) ? (() => {
            // Read-only badge. In public mode statusOptions aren't fetched, so
            // currentStatus is unresolved — fall back to the raw `doc.status`
            // slug so the public viewer still shows the document's status.
            const chip = getStatusChipClass(currentStatus ?? doc.status);
            return (
              <span
                className={cn('px-1.5 py-0.5 rounded text-[10px] font-medium shrink-0', chip.className)}
                style={chip.style}
              >
                {currentStatus?.icon ? `${currentStatus.icon} ` : ''}
                {currentStatus?.label ?? doc.status}
              </span>
            );
          })() : null}

          <div className="flex-1" />

          {hasAnyAction && (
            <div className="flex gap-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
              {onChat && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onChat(); }}
                  className="p-1.5 rounded bg-blue-500/80 text-white hover:bg-blue-600 transition-colors"
                  title="Открыть чат"
                >
                  <MessageCircle className="w-3.5 h-3.5" />
                </button>
              )}
              {onAttach && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onAttach(); }}
                  className="p-1.5 rounded bg-green-500/80 text-white hover:bg-green-600 transition-colors"
                  title="Прикрепить к сообщению"
                >
                  <Paperclip className="w-3.5 h-3.5" />
                </button>
              )}
              {onDownload && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onDownload(); }}
                  className="p-1.5 rounded bg-blue-500/80 text-white hover:bg-blue-600 transition-colors"
                  title="Скачать Markdown"
                >
                  <Download className="w-3.5 h-3.5" />
                </button>
              )}
              {onSettings && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onSettings(); }}
                  className="p-1.5 rounded bg-gray-500/80 text-white hover:bg-gray-600 transition-colors"
                  title="Редактировать документ"
                >
                  <Settings className="w-3.5 h-3.5" />
                </button>
              )}
              {onConfirmDelete && (
                <Dialog.Trigger asChild>
                <button
                  type="button"
                  onClick={(e) => e.stopPropagation()}
                  className="p-1.5 rounded bg-red-500/80 text-white hover:bg-red-600 transition-colors"
                  title="Удалить документ"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
                </Dialog.Trigger>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Delete confirmation */}
      {showDeleteConfirm && onConfirmDelete && (
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
          <Dialog.Content
            className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 bg-[var(--bg-primary)] rounded-xl border border-[var(--border-primary)] shadow-2xl p-6 max-w-md"
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-red-500/20 flex items-center justify-center">
                <Trash2 className="w-5 h-5 text-red-500" />
              </div>
              <div>
                <Dialog.Title className="font-semibold text-lg">Удалить документ?</Dialog.Title>
                <Dialog.Description className="text-sm text-[var(--text-secondary)]">Это действие нельзя отменить</Dialog.Description>
              </div>
            </div>

            <p className="text-sm text-[var(--text-secondary)] mb-4">
              Документ <strong>&quot;{doc.name}&quot;</strong> и все его содержимое будут удалены безвозвратно.
            </p>

            {deleteError && <p role="alert" className="text-sm text-red-500 mb-4">Не удалось удалить документ. Попробуйте ещё раз.</p>}
            <div className="flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setShowDeleteConfirm(false); }}
                className="px-4 py-2 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                disabled={isDeleting}
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={async (e) => {
                  e.stopPropagation();
                  setIsDeleting(true);
                  setDeleteError(false);
                  try {
                    await onConfirmDelete();
                    setShowDeleteConfirm(false);
                  } catch {
                    setDeleteError(true);
                  } finally {
                    setIsDeleting(false);
                  }
                }}
                disabled={isDeleting}
                className="px-4 py-2 rounded-lg bg-red-500 text-white text-sm font-medium hover:bg-red-600 disabled:opacity-50 flex items-center gap-2"
              >
                {isDeleting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Удаление...
                  </>
                ) : (
                  <>
                    <Trash2 className="w-4 h-4" />
                    Удалить
                  </>
                )}
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      )}

      {/* Paper stack effect */}
      <div className="absolute -bottom-1 left-1 right-1 h-1 bg-gray-100 dark:bg-gray-800 rounded-b-lg -z-10 opacity-60" />
      <div className="absolute -bottom-2 left-2 right-2 h-1 bg-gray-100 dark:bg-gray-800 rounded-b-lg -z-20 opacity-30" />
    </div>
    </Dialog.Root>
  );
}
