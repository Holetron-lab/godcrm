/**
 * MailComposer — ADR-158 P4. The reply/compose input, modelled 1:1 on the chat
 * InputArea (screenshot reference) but producing real HTML instead of markdown,
 * because a mail body IS HTML. Sharp-cornered per design ("без скруглений").
 *
 * One toolbar under the To/Subject header: the always-visible format strip on the
 * left (B / I / S / code / link / list / quote) whose buttons drive `quill.format()`
 * directly — full control over the icons, no reliance on Quill's default toolbar
 * chrome (disabled) — then a divider, then the action controls (attach / voice)
 * with Send pinned right.
 *
 * Presentational + self-contained: it owns its body-editing surface and a vertical
 * resize handle; the parent owns placement, To/Subject (via `header`) and send.
 */
import { useCallback, useMemo, useRef, useState } from 'react';
import ReactQuill from 'react-quill-new';
import 'react-quill-new/dist/quill.snow.css';
import './MailComposer.css';
import {
  Bold, Italic, Strikethrough, Code, Link2, List, Quote,
  Paperclip, Send, Mic, Square, Loader2, X, ChevronDown, ChevronUp,
  Clock, Save, BookmarkPlus,
  ImageIcon, FileText, File as FileIcon,
} from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { DropdownMenu } from '@/shared/components/ui';
import type { DropdownMenuItem } from '@/shared/components/ui/DropdownMenu';
import { useVoiceInput } from '@/features/ai-chat/hooks/useVoiceInput';
import { useLanguage } from '@/shared/i18n/LanguageContext';

const QUILL_FORMATS = ['bold', 'italic', 'strike', 'code', 'link', 'list', 'blockquote'];

type InlineFmt = 'bold' | 'italic' | 'strike' | 'code' | 'blockquote';

const MIN_HEIGHT = 120;
const maxHeight = () => (typeof window !== 'undefined' ? window.innerHeight * 0.7 : 480);
// Collapsible composer: a drag that ends below this height snaps to the one-line
// bar; a drag from the bar that crosses it opens the full editor.
const COLLAPSE_BELOW = MIN_HEIGHT / 2;

export interface MailComposerProps {
  /** HTML body. Controlled — Quill emits `<p><br></p>` when visually empty. */
  value: string;
  onChange: (html: string) => void;
  /** Fired by the Send button and by ⌘/Ctrl+Enter. */
  onSend: () => void;
  /**
   * Secondary send/save actions, surfaced in the caret menu next to Send. Each is
   * optional — an item only appears when its handler is provided, so the composer
   * never shows a dead action. Omit all three and the caret disappears entirely.
   */
  onSchedule?: () => void;
  onSaveDraft?: () => void;
  onSaveTemplate?: () => void;
  /**
   * Primary-button label + icon. Defaults to Send/"Отправить"; the scheduled-edit
   * composer overrides them with Save/"Сохранить".
   */
  sendLabel?: string;
  sendIcon?: React.ReactNode;
  /**
   * Replace the caret menu wholesale. When provided, these items are shown instead
   * of the derived schedule/draft/template set — used by the scheduled editor
   * ("Отправить сейчас" / "Изменить время…" / "Отменить отправку").
   */
  menuItems?: DropdownMenuItem[];
  sending?: boolean;
  /** Hard-disable (e.g. no mailbox connected). */
  disabled?: boolean;
  placeholder?: string;
  /** Optional attachments, owned by the parent (compose/reply). */
  attachments?: File[];
  onAttachmentsChange?: (files: File[]) => void;
  /** Rendered above the editor — compose passes To/Subject fields here. */
  header?: React.ReactNode;
  /** Extra toolbar controls (template / signature pickers), placed after the
   *  format strip. Rendered inside the scrollable region so they never crowd out
   *  the pinned Send on mobile. */
  toolbarExtra?: React.ReactNode;
  /**
   * Fill the parent's height instead of a fixed/resizable editor box: the editor
   * grows to the available space and the top resize handle is dropped. Used by the
   * standalone "new message" pane, which owns the full right column.
   */
  fill?: boolean;
  /**
   * Start as a one-line reply bar — just the text input and the attach / voice /
   * Send group — that opens into the full composer (To/Subject header, format
   * strip) when the handle is dragged up, the expand button is pressed, or the
   * slider is keyed up. Dragging back below the minimum height collapses it again.
   */
  collapsible?: boolean;
  className?: string;
}

/** Quill emits `<p><br></p>` for an empty doc — strip tags to decide emptiness. */
function isHtmlEmpty(html: string): boolean {
  return !html || html.replace(/<[^>]*>/g, '').replace(/\u00a0|&nbsp;/g, '').trim() === '';
}

function fileIcon(type: string) {
  if (type.startsWith('image/')) return <ImageIcon className="h-4 w-4" />;
  if (type.includes('pdf') || type.includes('document')) return <FileText className="h-4 w-4" />;
  return <FileIcon className="h-4 w-4" />;
}

export function MailComposer({
  value, onChange, onSend, onSchedule, onSaveDraft, onSaveTemplate,
  sendLabel, sendIcon, menuItems,
  sending = false, disabled = false,
  placeholder, attachments, onAttachmentsChange,
  header, toolbarExtra, fill = false, collapsible = false, className,
}: MailComposerProps) {
  const { t } = useLanguage();
  const sendText = sendLabel ?? t('mail.composer.send');
  const placeholderText = placeholder ?? t('mail.composer.placeholder');
  const [height, setHeight] = useState(180);
  const [collapsed, setCollapsed] = useState(true);
  const isCollapsed = collapsible && collapsed;
  const quillRef = useRef<ReactQuill>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Quill's own toolbar is off — our format strip drives formatting programmatically.
  const modules = useMemo(() => ({ toolbar: false }), []);

  const files = useMemo(() => attachments ?? [], [attachments]);
  const isEmpty = isHtmlEmpty(value) && files.length === 0;
  const canSend = !disabled && !sending && !isEmpty;

  // Secondary actions in the caret menu. Save-as-template/draft don't need a live
  // mailbox (they persist the composition, not transmit it), so they gate on
  // "has content + not mid-send", not on `disabled`. Only provided handlers render.
  const derivedMenuItems: DropdownMenuItem[] = [];
  if (onSchedule) derivedMenuItems.push({ label: t('mail.composer.scheduleLater'), value: 'schedule', icon: <Clock className="h-4 w-4" />, onSelect: onSchedule });
  if (onSaveDraft) derivedMenuItems.push({ label: t('mail.composer.saveDraft'), value: 'draft', icon: <Save className="h-4 w-4" />, onSelect: onSaveDraft });
  if (onSaveTemplate) derivedMenuItems.push({ label: t('mail.composer.saveTemplate'), value: 'template', icon: <BookmarkPlus className="h-4 w-4" />, onSelect: onSaveTemplate });
  const sendMenuItems = menuItems ?? derivedMenuItems;
  const hasSendMenu = sendMenuItems.length > 0;
  const canUseMenu = !sending && !isEmpty;

  /* ── Formatting: toggle inline marks / list / link on the current selection ── */
  const toggleFmt = useCallback((fmt: InlineFmt) => {
    const editor = quillRef.current?.getEditor();
    if (!editor) return;
    const range = editor.getSelection(true);
    const current = editor.getFormat(range ?? undefined);
    editor.format(fmt, !current[fmt]);
  }, []);

  const toggleList = useCallback(() => {
    const editor = quillRef.current?.getEditor();
    if (!editor) return;
    const range = editor.getSelection(true);
    const current = editor.getFormat(range ?? undefined);
    editor.format('list', current.list === 'bullet' ? false : 'bullet');
  }, []);

  const insertLink = useCallback(() => {
    const editor = quillRef.current?.getEditor();
    if (!editor) return;
    editor.getSelection(true);
    const url = window.prompt(t('mail.composer.linkPrompt'));
    if (url) editor.format('link', url.trim());
  }, [t]);

  /* ── Voice → insert transcript at the cursor (webSpeech: free, no backend) ── */
  const voice = useVoiceInput({
    onResult: (text) => {
      const editor = quillRef.current?.getEditor();
      if (!editor) return;
      const range = editor.getSelection(true);
      const index = range ? range.index : editor.getLength();
      editor.insertText(index, text);
      editor.setSelection(index + text.length, 0);
    },
  });

  /* ── Vertical resize: drag the top handle up to grow the editor. A collapsible
        composer treats the bar as height 0: dragging up past COLLAPSE_BELOW opens
        it, dragging an open one below that threshold collapses it. ── */
  const onResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = isCollapsed ? 0 : height;
    const move = (ev: MouseEvent) => {
      const raw = startH + (startY - ev.clientY);
      if (collapsible) {
        if (raw < COLLAPSE_BELOW) {
          setCollapsed(true);
          return;
        }
        setCollapsed(false);
      }
      setHeight(Math.min(maxHeight(), Math.max(MIN_HEIGHT, raw)));
    };
    const up = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  }, [height, isCollapsed, collapsible]);

  // Keyboard equivalent of the drag: the slider's value is 0 while collapsed.
  const onHandleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    if (collapsible && (e.key === 'Home' || (e.key === 'ArrowDown' && (isCollapsed || height <= MIN_HEIGHT)))) {
      setCollapsed(true);
      return;
    }
    if (isCollapsed) {
      // ArrowUp / End from the bar: open at the current (or max) height.
      setCollapsed(false);
      if (e.key === 'End') setHeight(maxHeight());
      return;
    }
    const next = e.key === 'Home' ? MIN_HEIGHT : e.key === 'End' ? maxHeight()
      : height + (e.key === 'ArrowUp' ? 20 : -20);
    setHeight(Math.min(maxHeight(), Math.max(MIN_HEIGHT, next)));
  }, [collapsible, isCollapsed, height]);

  const addFiles = useCallback((list: FileList | null) => {
    if (!list?.length || !onAttachmentsChange) return;
    onAttachmentsChange([...files, ...Array.from(list)]);
  }, [files, onAttachmentsChange]);

  const removeFile = useCallback((idx: number) => {
    onAttachmentsChange?.(files.filter((_, i) => i !== idx));
  }, [files, onAttachmentsChange]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && canSend) {
      e.preventDefault();
      onSend();
    }
  }, [canSend, onSend]);

  const FmtBtn = ({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) => (
    <button
      type="button" onClick={onClick} title={label} aria-label={label}
      className="rounded p-1 text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]"
    >
      {icon}
    </button>
  );

  /* ── Action group — attach / voice / Send, always pinned right. Lives in the
        toolbar when the composer is open and beside the input when collapsed. ── */
  const actions = (
    <div className="flex flex-shrink-0 items-center gap-0.5 pl-1">
      {collapsible && !isCollapsed && (
        <button
          type="button" onClick={() => setCollapsed(true)} title={t('mail.composer.collapse')} aria-label={t('mail.composer.collapseReply')}
          className="rounded-lg p-1.5 text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]"
        >
          <ChevronDown className="h-4 w-4" />
        </button>
      )}
      <div className="mx-0.5 h-4 w-px bg-[var(--border-primary)]" />
      <button
        type="button" onClick={() => fileInputRef.current?.click()} title={t('mail.composer.attach')} aria-label={t('mail.composer.attach')}
        className="rounded-lg p-1.5 text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]"
      >
        <Paperclip className="h-4 w-4" />
      </button>
      {voice.isRecording ? (
        <div className="flex items-center gap-1">
          <span className="tabular-nums text-[10px] text-red-400">
            {Math.floor(voice.duration / 60)}:{(voice.duration % 60).toString().padStart(2, '0')}
          </span>
          <button
            type="button" onClick={voice.stopRecording} title={t('mail.composer.stop')} aria-label={t('mail.composer.stopRecording')}
            className="animate-pulse rounded-lg bg-red-500 p-1.5 text-white transition-colors hover:bg-red-600"
          >
            <Square className="h-4 w-4 fill-current" />
          </button>
        </div>
      ) : (
        <button
          type="button" onClick={voice.startRecording}
          title={voice.error || t('mail.composer.voice')} aria-label={t('mail.composer.voice')}
          className={cn(
            'rounded-lg p-1.5 transition-colors',
            voice.error ? 'text-red-400 hover:bg-red-500/10' : 'text-[var(--text-tertiary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]'
          )}
        >
          <Mic className="h-4 w-4" />
        </button>
      )}

      {/* Send is a split button when secondary actions exist: the primary half
          sends; the caret half opens schedule / draft / save-as-template. */}
      <div className="flex items-stretch">
        <button
          type="button" onClick={onSend} disabled={!canSend} title={t('mail.composer.sendHint', { label: sendText })} aria-label={sendText}
          className={cn(
            'flex items-center gap-1.5 px-2 py-1.5 text-sm font-medium transition-colors sm:px-2.5',
            hasSendMenu ? 'rounded-l-lg' : 'rounded-lg',
            canSend
              ? 'bg-[var(--color-primary-500)] text-white hover:bg-[var(--color-primary-600)]'
              : 'cursor-not-allowed bg-[var(--bg-secondary)] text-[var(--text-tertiary)]'
          )}
        >
          {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : (sendIcon ?? <Send className="h-4 w-4" />)}
          {/* Label collapses to the icon on mobile to keep the pinned group narrow. */}
          <span className="hidden sm:inline">{sendText}</span>
        </button>
        {hasSendMenu && (
          <DropdownMenu
            align="end" side="top"
            trigger={
              <button
                type="button" disabled={!canUseMenu}
                title={t('mail.composer.moreActions')} aria-label={t('mail.composer.moreActions')}
                className={cn(
                  'flex items-center rounded-r-lg border-l px-1 py-1.5 transition-colors',
                  canUseMenu
                    ? 'border-white/25 bg-[var(--color-primary-500)] text-white hover:bg-[var(--color-primary-600)]'
                    : 'cursor-not-allowed border-[var(--border-primary)] bg-[var(--bg-secondary)] text-[var(--text-tertiary)]'
                )}
              >
                <ChevronDown className="h-4 w-4" />
              </button>
            }
            items={sendMenuItems}
          />
        )}
      </div>
    </div>
  );

  return (
    // Sharp corners by design — no rounded-*; flat input in the InputArea idiom.
    <div
      role="presentation"
      className={cn(
        'mail-composer flex flex-col border border-[var(--border-primary)] bg-[var(--bg-tertiary)]',
        fill && 'min-h-0 flex-1',
        isCollapsed && 'mail-composer--collapsed',
        className,
      )}
      onKeyDown={handleKeyDown}
    >
      {/* Resize handle — dropped in fill mode, where the editor takes all the height. */}
      {!fill && (
        <div
          role="slider" aria-orientation="vertical" aria-label={t('mail.composer.resize')}
          tabIndex={0}
          aria-valuemin={collapsible ? 0 : MIN_HEIGHT}
          aria-valuemax={maxHeight()}
          aria-valuenow={isCollapsed ? 0 : height}
          aria-valuetext={isCollapsed ? t('mail.composer.collapsed') : `${Math.round(height)} px`}
          onKeyDown={onHandleKeyDown}
          onMouseDown={onResizeStart}
          className="group flex h-2 flex-shrink-0 cursor-ns-resize items-center justify-center border-b border-[var(--border-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-primary-500)]"
        >
          <span className="h-0.5 w-8 rounded-full bg-[var(--border-primary)] transition-colors group-hover:bg-[var(--color-primary-500)]" />
        </div>
      )}

      {/* To / Subject header (compose/reply) sits directly under the resize handle. */}
      {!isCollapsed && header}

      {/* Single-row toolbar. The format strip scrolls horizontally on narrow
          screens (chat-input idiom) instead of wrapping, so the action group —
          attach / voice / Send — stays pinned and Send is always visible even on
          mobile. (No wrapping → the bar can't grow tall.) Collapsed: the whole
          bar goes, the actions move down beside the input. */}
      {!isCollapsed && (
        <div className="flex shrink-0 items-center gap-0.5 border-b border-[var(--border-primary)] bg-[var(--bg-secondary)]/60 px-1.5 py-1 max-md:[&_button]:flex max-md:[&_button]:h-11 max-md:[&_button]:min-w-11 max-md:[&_button]:items-center max-md:[&_button]:justify-center">
          {/* Formatting — scrolls if it can't fit the width. */}
          <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto scrollbar-none">
            <FmtBtn icon={<Bold className="h-3.5 w-3.5" />} label={t('mail.composer.bold')} onClick={() => toggleFmt('bold')} />
            <FmtBtn icon={<Italic className="h-3.5 w-3.5" />} label={t('mail.composer.italic')} onClick={() => toggleFmt('italic')} />
            <FmtBtn icon={<Strikethrough className="h-3.5 w-3.5" />} label={t('mail.composer.strike')} onClick={() => toggleFmt('strike')} />
            <FmtBtn icon={<Code className="h-3.5 w-3.5" />} label={t('mail.composer.code')} onClick={() => toggleFmt('code')} />
            <div className="mx-0.5 h-4 w-px flex-shrink-0 bg-[var(--border-primary)]" />
            <FmtBtn icon={<Link2 className="h-3.5 w-3.5" />} label={t('mail.composer.link')} onClick={insertLink} />
            <FmtBtn icon={<List className="h-3.5 w-3.5" />} label={t('mail.composer.list')} onClick={toggleList} />
            <FmtBtn icon={<Quote className="h-3.5 w-3.5" />} label={t('mail.composer.quote')} onClick={() => toggleFmt('blockquote')} />
            {toolbarExtra && (
              <>
                <div className="mx-0.5 h-4 w-px flex-shrink-0 bg-[var(--border-primary)]" />
                {toolbarExtra}
              </>
            )}
          </div>
          {actions}
        </div>
      )}

      {/* Attachments preview */}
      {files.length > 0 && (
        <div className="flex flex-wrap gap-2 border-b border-[var(--border-primary)] px-2 py-1.5">
          {files.map((file, index) => (
            <div key={`${file.name}-${index}`} className="flex items-center gap-2 rounded-lg bg-[var(--bg-secondary)] px-2 py-1.5 text-xs">
              {fileIcon(file.type)}
              <span className="max-w-[120px] truncate text-[var(--text-primary)]">{file.name}</span>
              <button
                type="button" onClick={() => removeFile(index)} aria-label={t('mail.composer.removeFile', { name: file.name })}
                className="text-[var(--text-tertiary)] transition-colors hover:text-red-400"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      <input ref={fileInputRef} type="file" multiple className="hidden" onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />

      {/* Editor — full-width; the toolbar sits above it. In fill mode it grows to
          the pane; otherwise it's the fixed/resizable box. Collapsed: one row —
          expand button, the (auto-height) input, then the action group after its
          divider. The editor keeps the same slot in both layouts so Quill is
          never remounted by a toggle. */}
      <div
        className={cn(
          'p-1.5',
          fill && 'min-h-0 flex-1',
          isCollapsed && 'flex items-end gap-1 max-md:[&_button]:flex max-md:[&_button]:h-11 max-md:[&_button]:min-w-11 max-md:[&_button]:items-center max-md:[&_button]:justify-center',
        )}
      >
        {isCollapsed && (
          <button
            type="button" onClick={() => setCollapsed(false)} title={t('mail.composer.expand')} aria-label={t('mail.composer.expandReply')}
            className="flex-shrink-0 rounded-lg p-1.5 text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]"
          >
            <ChevronUp className="h-4 w-4" />
          </button>
        )}
        <div
          className={cn('min-w-0 overflow-auto', fill && 'h-full', isCollapsed && 'flex-1 self-center')}
          style={fill || isCollapsed ? undefined : { height }}
        >
          <ReactQuill
            ref={quillRef}
            theme="snow"
            value={value}
            onChange={onChange}
            readOnly={disabled}
            modules={modules}
            formats={QUILL_FORMATS}
            placeholder={placeholderText}
          />
        </div>
        {isCollapsed && actions}
      </div>
    </div>
  );
}
