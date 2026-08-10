/**
 * ChatAttachmentRenderer — Rich attachment rendering for chat messages.
 *
 * Extracted from AIChatPanel (ADR-082, Task 4).
 * Replaces plain "📎 filename" badges with inline previews:
 *   • Images  → thumbnail with hover overlay + Eye icon
 *   • Video   → native <video> player
 *   • Audio   → native <audio> player with 🎵 icon
 *   • Other   → icon + name + size + preview/external-link buttons
 *
 * Consumers: MessageBubble, ChatTurn (human & agent attachments).
 */

import { useState, lazy, Suspense } from 'react';
import { Eye, ExternalLink, Link2 } from 'lucide-react';
import { formatFileSize, getFileIcon } from '@/features/files/api/filesApi';
import {
  FilePreviewModal,
  detectFileType,
  isPreviewable,
} from '@/features/files/components/FilePreviewModal';
import type { ChatAttachment } from '@/features/ai-chat/types';

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
  const [previewFile, setPreviewFile] = useState<{ url: string; name: string } | null>(null);
  // Ticket #81431: State for viewing a row reference in EditRowModal
  const [viewingRow, setViewingRow] = useState<{ tableId: number; rowId: number } | null>(null);

  if (!attachments || attachments.length === 0) return null;

  return (
    <>
      <div className={`mt-2 space-y-2 ${className}`}>
        {attachments.map((att, i) => {
          // Ticket #77794: Row reference attachment — render as compact chip/card
          if (att.type === 'row_reference' && att.rowReference) {
            const ref = att.rowReference;
            return (
              <div
                key={i}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[rgba(59,130,246,0.08)] border border-[rgba(59,130,246,0.2)] cursor-default hover:bg-[rgba(59,130,246,0.12)] transition-colors"
                title={`${ref.table_name} #${ref.row_id}`}
              >
                {ref.table_icon ? (
                  <span className="text-sm flex-shrink-0">{ref.table_icon}</span>
                ) : (
                  <Link2 className="w-3.5 h-3.5 flex-shrink-0 text-blue-400" />
                )}
                <span className="text-xs text-[var(--text-tertiary)] flex-shrink-0">
                  {ref.table_name}:
                </span>
                <span className="text-xs font-medium truncate max-w-[200px]">
                  {ref.row_title || `#${ref.row_id}`}
                </span>
                {/* Ticket #81431: "Show" button — opens EditRowModal */}
                <button
                  onClick={() => setViewingRow({ tableId: ref.table_id, rowId: ref.row_id })}
                  className="ml-1 p-0.5 rounded text-blue-400/60 hover:text-blue-400 hover:bg-blue-500/10 transition-colors"
                  title="Показать строку"
                >
                  <Eye className="w-3 h-3" />
                </button>
              </div>
            );
          }

          const fileUrl = att.url || att.preview || '';
          const fileName = att.name || 'file';
          const isImage = isImageFile(fileUrl || fileName);
          const isVideo = isVideoFile(fileUrl || fileName);
          const isAudio = isAudioFile(fileUrl || fileName);
          const canPreview = fileUrl && isPreviewable(fileUrl);

          return (
            <div key={i} className="rounded-lg overflow-hidden">
              {/* Image preview — responsive: full width on mobile, max 280px on desktop */}
              {isImage && fileUrl && (
                <div
                  className="relative group cursor-pointer active:opacity-80"
                  onClick={() => setPreviewFile({ url: fileUrl, name: fileName })}
                >
                  <img
                    src={fileUrl}
                    alt={fileName}
                    className="max-w-full sm:max-w-[280px] max-h-[200px] rounded-lg object-cover"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = 'none';
                    }}
                  />
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 sm:transition-colors rounded-lg flex items-center justify-center sm:opacity-0 sm:group-hover:opacity-100">
                    <Eye className="w-6 h-6 text-white drop-shadow-md" />
                  </div>
                </div>
              )}

              {/* Video preview */}
              {isVideo && fileUrl && (
                <div className="relative max-w-full sm:max-w-[320px]">
                  <video
                    src={fileUrl}
                    controls
                    className="w-full rounded-lg"
                    style={{ maxHeight: '200px' }}
                    preload="metadata"
                  >
                    Ваш браузер не поддерживает видео.
                  </video>
                </div>
              )}

              {/* Audio preview */}
              {isAudio && fileUrl && (
                <div className="flex items-center gap-2 p-2 bg-black/20 rounded-lg">
                  <span className="text-xl">🎵</span>
                  <audio
                    src={fileUrl}
                    controls
                    className="flex-1 h-8"
                    preload="metadata"
                  >
                    Ваш браузер не поддерживает аудио.
                  </audio>
                </div>
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
                      <span className="text-[11px] sm:text-[10px] opacity-60">{formatFileSize(att.size)}</span>
                    )}
                  </div>
                  {canPreview && (
                    <button
                      type="button"
                      onClick={() => setPreviewFile({ url: fileUrl, name: fileName })}
                      className="p-2 sm:p-1 hover:bg-white/10 active:bg-white/20 rounded-lg sm:rounded transition-colors flex-shrink-0"
                      title="Preview"
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
                      title="Open in new tab"
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

      {/* Ticket #81431: Row viewer modal for row references */}
      {viewingRow && (
        <Suspense fallback={null}>
          <RowViewerModal
            isOpen={!!viewingRow}
            onClose={() => setViewingRow(null)}
            tableId={viewingRow.tableId}
            rowId={viewingRow.rowId}
          />
        </Suspense>
      )}
    </>
  );
};

export default ChatAttachmentRenderer;
