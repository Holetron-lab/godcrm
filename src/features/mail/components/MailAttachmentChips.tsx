import { useState, type ReactNode } from 'react';
import { Download, Paperclip } from 'lucide-react';
import { Modal } from '@/shared/components/ui';
import { FilePreviewModal } from '@/features/files/components/FilePreviewModal';
import { formatFileSize } from '@/features/files/api/filesApi';
import { SafeChatImage } from '@/shared/components/SafeChatImage';
import { cn } from '@/shared/utils/cn';
import { mailApi } from '../api/mailApi';
import type { MailAttachmentMeta, MailMessage } from '../types';
import { useLanguage } from '@/shared/i18n/LanguageContext';

/**
 * ADR-158 §P5 — attachment chips for the list row and the reader, Yandex-style:
 * images are thumbnails that open in the shared image viewer, other files
 * download on click; every chip has a download affordance. The row shows at
 * most {@link ROW_ATTACHMENT_LIMIT} chips, filled from the right edge; past
 * that, a count chip opens {@link MailAttachmentsModal} — the "folder" with
 * every file of the message.
 *
 * Bytes live in the space's files once the sync saved them (`att.url`, a
 * `/uploads/...` path); older rows fall back to `mailApi.attachmentUrl` (the
 * per-index endpoint, which materializes the file on first request). The
 * metadata (`message.attachments`) is already on every row, so nothing is
 * fetched until a thumbnail renders or a file is clicked.
 */
export const ROW_ATTACHMENT_LIMIT = 3;

export function isImageAttachment(att: MailAttachmentMeta): boolean {
  return att.contentType.startsWith('image/');
}

/** View / download URLs for one attachment — saved file first, endpoint fallback. */
export function attachmentUrls(spaceId: number, message: MailMessage, index: number) {
  const att = message.attachments?.[index];
  if (att?.url) return { view: att.url, download: att.url };
  return {
    view: mailApi.attachmentUrl(spaceId, message.id, index),
    download: mailApi.attachmentUrl(spaceId, message.id, index, true),
  };
}

function extOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(i + 1).toUpperCase().slice(0, 5) : '';
}

interface ChipProps {
  spaceId: number;
  message: MailMessage;
  index: number;
  att: MailAttachmentMeta;
  /** `sm` for the list row, `lg` for the modal grid. */
  size?: 'sm' | 'lg';
  /** Image click → open in the viewer. */
  onOpenImage: (message: MailMessage, index: number) => void;
}

export function MailAttachmentChip({ spaceId, message, index, att, size = 'sm', onOpenImage }: ChipProps) {
  const { t } = useLanguage();
  const { view: url, download: downloadUrl } = attachmentUrls(spaceId, message, index);
  const image = isImageAttachment(att);
  const box = cn(
    'group/att relative flex-shrink-0 overflow-hidden rounded-md border border-[var(--border-primary)] bg-[var(--bg-secondary)]',
    size === 'sm' ? 'h-14 w-20' : 'h-28 w-full'
  );

  // A download link styled as a corner badge; focusable so keyboard users get it too.
  const download = (
    <a
      href={downloadUrl}
      download={att.filename}
      onClick={(e) => e.stopPropagation()}
      aria-label={t('mail.attachments.download', { name: att.filename })}
      title={t('mail.attachments.downloadSize', { size: formatFileSize(att.size) })}
      className="absolute bottom-1 right-1 rounded bg-black/60 p-1 text-white opacity-0 transition-opacity focus-visible:opacity-100 group-hover/att:opacity-100"
    >
      <Download size={12} />
    </a>
  );

  if (image) {
    return (
      <div className={box}>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onOpenImage(message, index);
          }}
          aria-label={t('mail.attachments.open', { name: att.filename })}
          title={att.filename}
          className="block h-full w-full"
        >
          <SafeChatImage src={url} alt={att.filename} className="h-full w-full object-cover" draggable={false} />
        </button>
        {download}
      </div>
    );
  }

  // Non-image: the whole chip is the download link (name + type badge).
  return (
    <a
      href={downloadUrl}
      download={att.filename}
      onClick={(e) => e.stopPropagation()}
      title={`${att.filename} · ${formatFileSize(att.size)}`}
      className={cn(box, 'flex flex-col justify-between p-1.5 no-underline hover:border-[var(--color-primary-500)]')}
    >
      <span className={cn('truncate text-[var(--text-secondary)]', size === 'sm' ? 'text-[11px]' : 'text-xs')}>
        {att.filename}
      </span>
      <span className="self-start rounded bg-[var(--color-primary-600)] px-1 text-[9px] font-semibold uppercase leading-4 text-white">
        {extOf(att.filename) || 'file'}
      </span>
    </a>
  );
}

interface RowProps {
  spaceId: number | undefined;
  message: MailMessage;
  onOpenImage: (message: MailMessage, index: number) => void;
  /** The count chip (more than the row limit) → the all-files modal. */
  onOpenAll: (message: MailMessage) => void;
}

/** Right-aligned cluster for a list row: fills from the right edge leftwards. */
export function MailRowAttachments({ spaceId, message, onOpenImage, onOpenAll }: RowProps) {
  const { t } = useLanguage();
  const atts = message.attachments ?? [];
  if (!atts.length || spaceId == null) return null;
  const overflow = atts.length > ROW_ATTACHMENT_LIMIT;
  // With overflow the last slot becomes the count chip, so one fewer file shows.
  const shown = overflow ? atts.slice(0, ROW_ATTACHMENT_LIMIT - 1) : atts;
  return (
    <div className="flex flex-shrink-0 flex-row-reverse items-center gap-1.5" aria-label={t('mail.attachments.group')}>
      {overflow && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onOpenAll(message);
          }}
          aria-label={t('mail.attachments.all', { count: atts.length })}
          title={t('mail.attachments.all', { count: atts.length })}
          className="flex h-14 w-12 flex-col items-center justify-center gap-0.5 rounded-md border border-[var(--border-primary)] bg-[var(--bg-secondary)] text-[var(--text-secondary)] transition-colors hover:border-[var(--color-primary-500)] hover:text-[var(--text-primary)]"
        >
          <Paperclip size={14} />
          <span className="text-xs font-semibold">{atts.length}</span>
        </button>
      )}
      {shown.map((att, i) => (
        <MailAttachmentChip
          key={`${att.filename}-${i}`}
          spaceId={spaceId}
          message={message}
          index={i}
          att={att}
          onOpenImage={onOpenImage}
        />
      ))}
    </div>
  );
}

interface ModalProps {
  spaceId: number;
  message: MailMessage | null;
  onClose: () => void;
  onOpenImage: (message: MailMessage, index: number) => void;
}

/** The "folder" of a message — every attachment with name, size, download. */
export function MailAttachmentsModal({ spaceId, message, onClose, onOpenImage }: ModalProps) {
  const { t } = useLanguage();
  const atts = message?.attachments ?? [];
  return (
    <Modal
      open={message != null}
      onOpenChange={(open) => !open && onClose()}
      title={t('mail.attachments.modalTitle', { count: atts.length })}
      description={message?.subject || t('mail.common.noSubject')}
      size="lg"
    >
      {message && (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {atts.map((att, i) => (
            <li key={`${att.filename}-${i}`} className="flex min-w-0 flex-col gap-1">
              <MailAttachmentChip
                spaceId={spaceId}
                message={message}
                index={i}
                att={att}
                size="lg"
                onOpenImage={onOpenImage}
              />
              <span className="truncate text-xs text-[var(--text-secondary)]" title={att.filename}>
                {att.filename}
              </span>
              <span className="text-[11px] text-[var(--text-tertiary)]">{formatFileSize(att.size)}</span>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

/**
 * One pair of dialogs per surface (list / reader): the all-files modal and the
 * image viewer. Returns the openers for chips and the `dialogs` node to mount.
 * The viewer sits above the modal (z-100 vs z-70), so an image picked inside
 * the modal opens on top of it.
 */
export function useMailAttachmentDialogs(spaceId: number | undefined): {
  openAll: (message: MailMessage) => void;
  openImage: (message: MailMessage, index: number) => void;
  dialogs: ReactNode;
} {
  const [all, setAll] = useState<MailMessage | null>(null);
  const [view, setView] = useState<{ message: MailMessage; index: number } | null>(null);
  const viewed = view?.message.attachments?.[view.index];
  const dialogs =
    spaceId == null ? null : (
      <>
        <MailAttachmentsModal
          spaceId={spaceId}
          message={all}
          onClose={() => setAll(null)}
          onOpenImage={(message, index) => setView({ message, index })}
        />
        {view && viewed && (
          <FilePreviewModal
            isOpen
            onClose={() => setView(null)}
            fileUrl={attachmentUrls(spaceId, view.message, view.index).view}
            fileName={viewed.filename}
            fileType="image"
          />
        )}
      </>
    );
  return {
    openAll: setAll,
    openImage: (message, index) => setView({ message, index }),
    dialogs,
  };
}
