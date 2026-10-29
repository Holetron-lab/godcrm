import {
  ArrowLeft,
  Mail,
  MailOpen,
  Archive,
  ArchiveRestore,
  Trash2,
  Star,
  Reply,
  ReplyAll,
  Forward,
  Printer,
  ChevronLeft,
  ChevronRight,
  Code2,
  Eye,
  Sun,
  Moon,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '@/shared/components/ui';
import { cn } from '@/shared/utils/cn';
import type { MailBodyTheme } from '../settings';
import type { ComposeMode } from './MailReplyBar';
import { useLanguage } from '@/shared/i18n/LanguageContext';

export interface MailReadToolbarProps {
  /** Close the reader, back to the list. */
  onBack: () => void;
  /** Read state of the open message. A message opens as read, so the toolbar's
   *  common action is "mark unread"; the button flips back when already unread. */
  read: boolean;
  onToggleRead: () => void;
  /** Archive move is a toggle: archive ⇄ inbox depending on the current folder. */
  isArchived: boolean;
  onToggleArchive: () => void;
  onDelete: () => void;
  starred: boolean;
  onToggleStar: () => void;
  /** Body view-type — rendered HTML vs. raw source. */
  renderHtml: boolean;
  onRenderHtmlChange: (renderHtml: boolean) => void;
  /** Body surface — light (white page) or dark. */
  bodyTheme: MailBodyTheme;
  onBodyThemeChange: (theme: MailBodyTheme) => void;
  /** Which action the docked composer is currently seeded for — highlights the button.
   *  Only reply/forward are ever passed here; the wider ComposeMode keeps it aligned
   *  with the shared type. */
  mode?: ComposeMode;
  onReply: () => void;
  onForward: () => void;
  onPrint: () => void;
  /** Prev/next stepping through the current list around the open message. */
  onPrev: () => void;
  onNext: () => void;
  canPrev: boolean;
  canNext: boolean;
  /** Inline label controls (add/toggle) for the open message — rendered inside
   *  the toolbar so tagging lives with the other message actions, not in a
   *  separate bar. Nothing is reserved when omitted. */
  labelSlot?: ReactNode;
  /** Inline "attach to chat message" control for the open message, rendered
   *  beside the label slot. Nothing is reserved when omitted. */
  linkSlot?: ReactNode;
}

const Divider = () => (
  <div className="mx-1 h-6 w-px bg-[var(--border-primary)]" aria-hidden="true" />
);

const segment = (active: boolean) =>
  cn(
    'flex items-center justify-center px-2.5 py-1.5 transition-colors',
    active
      ? 'bg-[var(--bg-tertiary)] text-[var(--text-primary)]'
      : 'bg-[var(--bg-secondary)] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]'
  );

/**
 * ADR-158 — the message-scoped toolbar. Renders inside the reading pane, directly
 * above the message body, and only while a message is open. Everything here acts on
 * the *open message* (back / archive / delete / star / reply / forward / print /
 * step / view-type) — the top MailToolbar keeps the list-scoped controls.
 */
export function MailReadToolbar({
  onBack,
  read,
  onToggleRead,
  isArchived,
  onToggleArchive,
  onDelete,
  starred,
  onToggleStar,
  renderHtml,
  onRenderHtmlChange,
  bodyTheme,
  onBodyThemeChange,
  mode,
  onReply,
  onForward,
  onPrint,
  onPrev,
  onNext,
  canPrev,
  canNext,
  labelSlot,
  linkSlot,
}: MailReadToolbarProps) {
  const { t } = useLanguage();
  return (
    <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-[var(--border-primary)] bg-[var(--bg-primary)] px-3 py-1.5 [&>*]:shrink-0 max-md:[&>button]:h-11 max-md:[&>button]:min-w-11 md:flex-wrap md:overflow-visible">
      <Button variant="ghost" size="sm" aria-label={t('mail.read.back')} title={t('mail.read.backHint')} onClick={onBack}>
        <ArrowLeft size={16} />
      </Button>

      <Divider />

      {/* Mark read/unread — sits left of Archive. A message opens as read, so the
          default action is "mark unread"; a closed envelope signals the target
          (unread) state, flipping to an open envelope when already unread. */}
      <Button
        variant="ghost"
        size="sm"
        aria-label={read ? t('mail.read.markUnread') : t('mail.read.markRead')}
        aria-pressed={!read}
        title={read ? t('mail.read.markUnread') : t('mail.read.markRead')}
        onClick={onToggleRead}
      >
        {read ? <Mail size={16} /> : <MailOpen size={16} />}
      </Button>

      {/* Archive toggles: from Archive it restores to Inbox, else it archives. */}
      <Button
        variant="ghost"
        size="sm"
        aria-label={isArchived ? t('mail.list.unarchive') : t('mail.list.archive')}
        title={isArchived ? t('mail.list.unarchive') : t('mail.list.archive')}
        onClick={onToggleArchive}
      >
        {isArchived ? <ArchiveRestore size={16} /> : <Archive size={16} />}
      </Button>
      <Button variant="ghost" size="sm" aria-label={t('mail.common.delete')} title={t('mail.common.delete')} onClick={onDelete}>
        <Trash2 size={16} />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        aria-label={starred ? t('mail.list.unstar') : t('mail.list.star')}
        aria-pressed={starred}
        title={starred ? t('mail.list.unstar') : t('mail.list.star')}
        onClick={onToggleStar}
      >
        <Star
          size={16}
          className={starred ? 'fill-current text-[var(--color-warning,#eab308)]' : undefined}
        />
      </Button>

      <Divider />

      <Button
        variant={mode === 'reply' ? 'secondary' : 'ghost'}
        size="sm"
        aria-label={t('mail.read.reply')}
        aria-pressed={mode === 'reply'}
        title={t('mail.read.replyHint')}
        onClick={onReply}
      >
        <Reply size={16} />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        aria-label={t('mail.read.replyAll')}
        title={t('mail.read.replyAllHint')}
        disabled
      >
        <ReplyAll size={16} />
      </Button>
      <Button
        variant={mode === 'forward' ? 'secondary' : 'ghost'}
        size="sm"
        aria-label={t('mail.read.forward')}
        aria-pressed={mode === 'forward'}
        title={t('mail.read.forwardHint')}
        onClick={onForward}
      >
        <Forward size={16} />
      </Button>
      <Button variant="ghost" size="sm" aria-label={t('mail.read.print')} title={t('mail.read.print')} onClick={onPrint}>
        <Printer size={16} />
      </Button>

      <Divider />

      {/* Body view-type — rendered HTML vs. raw source. */}
      <div
        role="group"
        aria-label={t('mail.read.bodyView')}
        className="flex overflow-hidden rounded-md border border-[var(--border-primary)]"
      >
        <button
          type="button"
          aria-pressed={renderHtml}
          title={t('mail.read.rendered')}
          className={segment(renderHtml)}
          onClick={() => onRenderHtmlChange(true)}
        >
          <Eye size={15} />
        </button>
        <button
          type="button"
          aria-pressed={!renderHtml}
          title={t('mail.read.source')}
          className={segment(!renderHtml)}
          onClick={() => onRenderHtmlChange(false)}
        >
          <Code2 size={15} />
        </button>
      </div>

      {/* Body surface: pressed = dark surface on; the icon shows the state you
          would switch to. */}
      <Button
        variant="ghost"
        size="sm"
        aria-label={t('mail.read.darkTheme')}
        aria-pressed={bodyTheme === 'dark'}
        title={bodyTheme === 'dark' ? t('mail.read.lightTheme') : t('mail.read.darkTheme')}
        onClick={() => onBodyThemeChange(bodyTheme === 'dark' ? 'light' : 'dark')}
      >
        {bodyTheme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
      </Button>

      {labelSlot && (
        <>
          <Divider />
          {labelSlot}
        </>
      )}

      {linkSlot && (
        <>
          <Divider />
          {linkSlot}
        </>
      )}

      {/* Newer/older stepping, pinned to the far right. */}
      <div className="ml-auto flex items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          aria-label={t('mail.read.prev')}
          title={t('mail.read.prevHint')}
          disabled={!canPrev}
          onClick={onPrev}
        >
          <ChevronLeft size={16} />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          aria-label={t('mail.read.next')}
          title={t('mail.read.nextHint')}
          disabled={!canNext}
          onClick={onNext}
        >
          <ChevronRight size={16} />
        </Button>
      </div>
    </div>
  );
}
