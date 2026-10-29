import { VideoAttachmentPlayer } from '../VideoAttachmentPlayer';
import { AudioAttachmentPlayer } from '../AudioAttachmentPlayer';
import { useLanguage } from '@/shared/i18n/LanguageContext';
/**
 * ChatAttachmentRenderer — Rich attachment rendering for chat messages.
 *
 * Extracted from AIChatPanel (ADR-082, Task 4).
 * Replaces plain "📎 filename" badges with inline previews:
 *   • Images  → thumbnail with hover overlay + Eye icon
 *   • Video   → native <video> player
 *   • Audio   → waveform player with seeking
 *   • Other   → icon + name + size + preview/external-link buttons
 *
 * Consumers: MessageBubble, ChatTurn (human & agent attachments).
 */

import { useState, lazy, Suspense } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Eye, ExternalLink, Link2, MoreVertical, Pencil, MessageCircle, MessageCirclePlus, Paperclip } from 'lucide-react';
import { formatFileSize, getFileIcon } from '@/features/files/api/filesApi';
import {
  FilePreviewModal,
  detectFileType,
  isPreviewable,
} from '@/features/files/components/FilePreviewModal';
import { DropdownMenu } from '@/shared/components/ui';
import { SafeChatImage } from '@/shared/components/SafeChatImage';
import { apiClient } from '@/shared/utils/apiClient';
import { logger } from '@/shared/utils/logger';
import { showToast } from '@/shared/hooks/useToast';
import { useAIChat } from '@/features/ai-chat/context/AIChatContext';
import { resolveActivePreset } from '@/features/ai-chat/utils/chatSourcePresets';
import type { TasksSourceConfig, FavoritesConfig } from '@/features/ai-chat/components/AIChatPanel/types';
import type { ChatAttachment } from '@/features/ai-chat/types';
import { MailMessageChip } from '@/features/mail/components/MailMessageChip';
import { RowPresetCard } from './ChatTurn/RowPresetCard';
import { TicketRowAtom } from './ChatTurn/TicketRowAtom';
import { DocumentRowAtom } from './ChatTurn/DocumentRowAtom';

// Ticket #81431: Self-loading row viewer modal for "Show" button on row reference chips
const RowViewerModal = lazy(() => import('./RowViewerModal'));

// ── helpers (mirrors AIChatPanel) ────────────────────────────────
const getFileExtension = (urlOrName: string): string => {
  const parts = urlOrName.split('/').pop()?.split('.') || [];
  return parts.length > 1 ? parts.pop()?.toLowerCase() || '' : '';
};

const isImageFile = (urlOrName: string): boolean => {
  const ext = getFileExtension(urlOrName);
  return ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico'].includes(ext);
};

const isVideoFile = (urlOrName: string): boolean => {
  const ext = getFileExtension(urlOrName);
  return ['mp4', 'webm', 'ogg', 'mov', 'avi', 'mkv'].includes(ext);
};

const isAudioFile = (urlOrName: string): boolean => {
  const ext = getFileExtension(urlOrName);
  return ['mp3', 'wav', 'flac', 'ogg', 'aac', 'm4a'].includes(ext);
};

// ── component ────────────────────────────────────────────────────
interface ChatAttachmentRendererProps {
  attachments: ChatAttachment[];
  /** Optional class name for the outer wrapper */
  className?: string;
}

export const ChatAttachmentRenderer = ({
  attachments,
  className = '',
}: ChatAttachmentRendererProps) => {
  const { t } = useLanguage();
  const [previewFile, setPreviewFile] = useState<{ url: string; name: string } | null>(null);
  // Ticket #81431: State for viewing a row reference — kanban card detail (default) or edit form.
  const [viewingRow, setViewingRow] = useState<
    { tableId: number; rowId: number; mode: 'view' | 'edit' } | null
  >(null);

  // Optional chat-context handlers; safe to call here because ChatAttachmentRenderer
  // always renders inside <AIChatProvider> (Layout wraps the whole app).
  const { attachRowToChat, attachRowToMessage, openTaskChat, spaceId } = useAIChat();

  // Open the row's own task chat thread (chat-bubble icon on TicketRowAtom /
  // DocumentRowAtom). Mirrors the flow in useTableRowActions.handleOpenRowChat
  // and DashboardWidgetCard.handleOpenCardChat: GET conversationId via
  // /chat/rows/:tableId/:rowId then hand off to openTaskChat. This is *not*
  // the same as binding the row to the panel — that's `attachRowToChat`.
  const openRowTaskChat = async (ref: { table_id: number; row_id: number; row_title?: string }) => {
    try {
      const response = await apiClient.get<{ data: { conversationId?: number; id?: number } }>(
        `/chat/rows/${ref.table_id}/${ref.row_id}?create=true`,
      );
      const convId = response.data?.conversationId || response.data?.id;
      if (!convId) {
        showToast(t('aiChat.ui.couldNotGetTheChatID'), 'error');
        return;
      }
      openTaskChat({
        conversationId: Number(convId),
        tableId: Number(ref.table_id),
        rowId: Number(ref.row_id),
        rowTitle: ref.row_title || `#${ref.row_id}`,
      });
    } catch (error) {
      logger.error('[ChatAttachmentRenderer] openRowTaskChat failed', { error });
      showToast(t('aiChat.ui.couldNotOpenTheChat'), 'error');
    }
  };

  // T-141688 / ADR-0031 §Y / WP-22 — fetch space-level data-source config
  // (tickets_config + favorites_config) so we can resolve the active preset
  // for each row_reference. Cached, dedup'd across all renderer instances
  // mounted in the same chat.
  const { data: spaceConfig } = useQuery<{ tasksSource?: TasksSourceConfig; favoritesConfig?: FavoritesConfig }>({
    queryKey: ['space', spaceId, 'preset-config'],
    queryFn: async () => {
      if (!spaceId) return {};
      const resp = await apiClient.get<{ success?: boolean; data?: { space?: { tickets_config?: TasksSourceConfig | null; favorites_config?: FavoritesConfig | null } } }>(
        `/spaces/${spaceId}`,
      );
      return {
        tasksSource: resp?.data?.space?.tickets_config || undefined,
        favoritesConfig: resp?.data?.space?.favorites_config || undefined,
      };
    },
    enabled: !!spaceId,
    staleTime: 60_000,
  });

  if (!attachments || attachments.length === 0) return null;

  return (
    <>
      <div className={`mt-2 flex flex-wrap items-start gap-2 ${className}`}>
        {attachments.map((att, i) => {
          // ADR-158 §P5: a mail message attached from the mail list — the
          // snapshot travels inline, the chip deep-links into the reader.
          if (att.type === 'mail_message_ref' && att.mailRef) {
            return (
              <div key={i} className="min-w-0 max-w-full">
                <MailMessageChip mailRef={att.mailRef} />
              </div>
            );
          }
          // Ticket #77794 (+ T-141688 / ADR-0031 §Y / WP-22): Row reference
          // attachment — collapsed chip by default; chevron expands to a
          // preset-driven card view when an active preset matches the table.
          if (att.type === 'row_reference' && att.rowReference) {
            const ref = att.rowReference;
            const activePreset = resolveActivePreset({
              workspaceId: spaceId,
              tableId: ref.table_id,
              tasksSource: spaceConfig?.tasksSource,
              favoritesConfig: spaceConfig?.favoritesConfig,
            });
            return (
              <div key={i} className="w-full min-w-0">
                <RowReferenceItem
                  ref_={ref}
                  activePreset={activePreset}
                  onOpenView={() => setViewingRow({ tableId: ref.table_id, rowId: ref.row_id, mode: 'view' })}
                  onOpenEdit={() => setViewingRow({ tableId: ref.table_id, rowId: ref.row_id, mode: 'edit' })}
                  onOpenTaskChat={openRowTaskChat}
                  onAttachToChat={attachRowToChat}
                  onAttachToMessage={attachRowToMessage}
                />
              </div>
            );
          }

          const fileUrl = att.url || att.preview || '';
          const fileName = att.name || 'file';
          const isImage = att.type.startsWith('image/') || isImageFile(fileUrl || fileName);
          const isAudio = att.type.startsWith('audio/') || (!att.type.startsWith('video/') && isAudioFile(fileUrl || fileName));
          const isVideo = !isAudio && (att.type.startsWith('video/') || isVideoFile(fileName) || isVideoFile(fileUrl));
          const canPreview = fileUrl && isPreviewable(fileUrl);

          return (
            <div key={i} className={`min-w-0 max-w-full rounded-lg overflow-hidden ${isImage ? 'w-fit' : 'w-full'}`}>
              {/* Intrinsic image widths let narrow attachments share a row. */}
              {isImage && fileUrl && (
                <div className="relative group/attachment max-w-[280px]">
                  <SafeChatImage
                    src={fileUrl}
                    alt={fileName}
                    onClick={() => setPreviewFile({ url: fileUrl, name: fileName })}
                    className="max-w-full max-h-[200px] rounded-lg object-contain"
                  />
                  <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-black/0 group-hover/attachment:bg-black/30 group-focus-within/attachment:bg-black/30 transition-colors rounded-lg flex items-center justify-center opacity-0 group-hover/attachment:opacity-100 group-focus-within/attachment:opacity-100">
                    <Eye className="w-6 h-6 text-white" />
                  </div>
                </div>
              )}

              {/* Video preview */}
              {isVideo && fileUrl && (
                <VideoAttachmentPlayer key={fileUrl} src={fileUrl} name={fileName} />
              )}

              {/* Audio preview */}
              {isAudio && fileUrl && (
                <AudioAttachmentPlayer src={fileUrl} name={fileName} />
              )}

              {/* Other files — icon + name + size + preview/external-link (mobile-friendly touch targets) */}
              {!isImage && !isVideo && !isAudio && (
                <div className="flex items-center gap-2 px-3 py-2 sm:px-2 sm:py-1.5 bg-black/20 rounded-lg">
                  <span className="text-lg sm:text-base flex-shrink-0">{getFileIcon(att.type)}</span>
                  <div className="flex-1 min-w-0">
                    {fileUrl ? (
                      canPreview ? (
                        <button
                          type="button"
                          onClick={() => setPreviewFile({ url: fileUrl, name: fileName })}
                          className="text-sm sm:text-xs font-medium truncate block hover:underline active:opacity-70 text-left w-full"
                        >
                          {fileName}
                        </button>
                      ) : (
                        <a
                          href={fileUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm sm:text-xs font-medium truncate block hover:underline active:opacity-70"
                        >
                          {fileName}
                        </a>
                      )
                    ) : (
                      <span className="text-sm sm:text-xs font-medium truncate block">{fileName}</span>
                    )}
                    {att.size > 0 && (
                      <span className="text-[11px] sm:text-[10px]">{formatFileSize(att.size)}</span>
                    )}
                  </div>
                  {canPreview && (
                    <button
                      type="button"
                      onClick={() => setPreviewFile({ url: fileUrl, name: fileName })}
                      className="p-2 sm:p-1 hover:bg-white/10 active:bg-white/20 rounded-lg sm:rounded transition-colors flex-shrink-0"
                      title={t('aiChat.ui.preview')}
                    >
                      <Eye className="w-5 h-5 sm:w-4 sm:h-4" />
                    </button>
                  )}
                  {fileUrl && (
                    <a
                      href={fileUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="p-2 sm:p-1 hover:bg-white/10 active:bg-white/20 rounded-lg sm:rounded transition-colors flex-shrink-0"
                      title={t('aiChat.ui.openNewTab')}
                    >
                      <ExternalLink className="w-5 h-5 sm:w-4 sm:h-4" />
                    </a>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* FilePreviewModal — rendered once for the whole list */}
      {previewFile && (
        <FilePreviewModal
          isOpen={!!previewFile}
          onClose={() => setPreviewFile(null)}
          fileUrl={previewFile.url}
          fileName={previewFile.name}
          fileType={detectFileType(previewFile.url)}
        />
      )}

      {/* Ticket #81431: Row viewer modal for row references — view (CardDetailModal) or edit (EditRowModal) */}
      {viewingRow && (
        <Suspense fallback={null}>
          <RowViewerModal
            isOpen={!!viewingRow}
            onClose={() => setViewingRow(null)}
            tableId={viewingRow.tableId}
            rowId={viewingRow.rowId}
            mode={viewingRow.mode}
            onAttachToChat={() => {
              const a = attachments.find(
                x => x.type === 'row_reference' && x.rowReference?.table_id === viewingRow.tableId && x.rowReference?.row_id === viewingRow.rowId
              );
              const ref = a?.rowReference;
              if (ref) {
                attachRowToChat({
                  table_id: ref.table_id,
                  row_id: ref.row_id,
                  table_name: ref.table_name,
                  table_icon: ref.table_icon,
                  row_title: ref.row_title,
                });
              }
            }}
            onAttachToMessage={() => {
              const a = attachments.find(
                x => x.type === 'row_reference' && x.rowReference?.table_id === viewingRow.tableId && x.rowReference?.row_id === viewingRow.rowId
              );
              const ref = a?.rowReference;
              if (ref) {
                attachRowToMessage({
                  table_id: ref.table_id,
                  row_id: ref.row_id,
                  table_name: ref.table_name,
                  table_icon: ref.table_icon,
                  row_title: ref.row_title,
                });
              }
            }}
          />
        </Suspense>
      )}
    </>
  );
};

/**
 * RowReferenceItem — single row_reference rendering (T-141688 / ADR-0031 §Y / WP-22).
 *
 * - When a preset matches → render the atomic widget directly
 *   (TicketRowAtom for tickets, RowPresetCard otherwise). Expand/collapse
 *   for full row detail lives INSIDE the widget itself (TicketRowHeader's
 *   chevron) — no chat-level toggle.
 * - When `activePreset` is null → render the legacy blue chip with action menu.
 */
type RowRef = NonNullable<ChatAttachment['rowReference']>;

interface RowReferenceItemProps {
  ref_: RowRef;
  activePreset: ReturnType<typeof resolveActivePreset>;
  onOpenView: () => void;
  onOpenEdit: () => void;
  onOpenTaskChat: (row: { table_id: number; row_id: number; row_title?: string }) => void;
  onAttachToChat: (row: { table_id: number; row_id: number; table_name?: string; table_icon?: string; row_title?: string }) => void;
  onAttachToMessage: (row: { table_id: number; row_id: number; table_name?: string; table_icon?: string; row_title?: string }) => void;
}

function RowReferenceItem({
  ref_, activePreset, onOpenView, onOpenEdit, onOpenTaskChat, onAttachToChat, onAttachToMessage,
}: RowReferenceItemProps) {
  const { t } = useLanguage();
  const refForAttach = {
    table_id: ref_.table_id,
    row_id: ref_.row_id,
    table_name: ref_.table_name,
    table_icon: ref_.table_icon,
    row_title: ref_.row_title,
  };

  if (activePreset) {
    if (activePreset.kind === 'tickets') {
      return (
        <TicketRowAtom
          tableId={ref_.table_id}
          rowId={ref_.row_id}
          rowReference={ref_}
          onOpenEdit={onOpenEdit}
          onOpenTaskChat={() => onOpenTaskChat(refForAttach)}
          onAttachToMessage={() => onAttachToMessage(refForAttach)}
        />
      );
    }
    if (activePreset.kind === 'documents') {
      return (
        <DocumentRowAtom
          tableId={ref_.table_id}
          rowId={ref_.row_id}
          rowReference={ref_}
          onOpenDetail={onOpenView}
          onOpenEdit={onOpenEdit}
          onOpenTaskChat={() => onOpenTaskChat(refForAttach)}
          onAttachToMessage={() => onAttachToMessage(refForAttach)}
        />
      );
    }
    return (
      <RowPresetCard
        preset={activePreset}
        tableId={ref_.table_id}
        rowId={ref_.row_id}
        rowReference={ref_}
        onOpenDetail={onOpenView}
        onOpenEdit={onOpenEdit}
        onBindToChat={() => onAttachToChat(refForAttach)}
        onAttachToMessage={() => onAttachToMessage(refForAttach)}
      />
    );
  }

  const menuItems = [
    {
      label: t('dashboardPage.edit'),
      value: 'edit',
      icon: <Pencil className="w-4 h-4" />,
      onSelect: onOpenEdit,
    },
    {
      label: t('rowActions.openChat'),
      value: 'open-chat',
      icon: <MessageCircle className="w-4 h-4" />,
      onSelect: () => onOpenTaskChat(refForAttach),
    },
    {
      label: t('aiChat.ui.linkToChat'),
      value: 'bind-chat',
      icon: <MessageCirclePlus className="w-4 h-4" />,
      onSelect: () => onAttachToChat(refForAttach),
    },
    {
      label: t('rowActions.attachToMessage'),
      value: 'attach-message',
      icon: <Paperclip className="w-4 h-4" />,
      onSelect: () => onAttachToMessage(refForAttach),
    },
  ];

  return (
    <div
      className="flex w-full items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[rgba(59,130,246,0.08)] border border-[rgba(59,130,246,0.2)] hover:bg-[rgba(59,130,246,0.12)] transition-colors"
      title={`${ref_.table_name} #${ref_.row_id}`}
    >
      {ref_.table_icon ? (
        <span className="text-sm flex-shrink-0">{ref_.table_icon}</span>
      ) : (
        <Link2 className="w-3.5 h-3.5 flex-shrink-0 text-blue-400" />
      )}
      <button
        type="button"
        onClick={onOpenView}
        className="flex-1 min-w-0 text-left text-xs font-medium truncate text-blue-300 hover:text-blue-200 hover:underline"
        title={`${ref_.table_name || 'Table'} · ${ref_.row_title || `#${ref_.row_id}`}`}
      >
        {ref_.row_title || `#${ref_.row_id}`}
      </button>
      <DropdownMenu
        trigger={
          <button
            type="button"
            className="ml-1 flex-shrink-0 p-0.5 rounded text-blue-400/60 hover:text-blue-400 hover:bg-blue-500/10 transition-colors"
            title={t('tableToolbar.actionsLabel')}
            onClick={(e) => e.stopPropagation()}
          >
            <MoreVertical className="w-3.5 h-3.5" />
          </button>
        }
        items={menuItems}
      />
    </div>
  );
}

export default ChatAttachmentRenderer;
