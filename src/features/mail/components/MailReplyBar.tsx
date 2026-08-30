import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { FileText, PenLine, Save, Clock, CalendarClock, SendHorizonal, Trash2 } from 'lucide-react';
import { DropdownMenu, Modal, Input, Button } from '@/shared/components/ui';
import type { DropdownMenuItem } from '@/shared/components/ui/DropdownMenu';
import { ScheduleDatePicker } from '@/features/ai-chat/components/AIChatPanel/components/ScheduleDatePicker';
import {
  useSendMail,
  useScheduleMail,
  useSaveDraft,
  useUpdateScheduled,
  useCancelScheduled,
} from '../hooks/useMail';
import type { MailSendInput } from '../api/mailApi';
import { buildReply, buildForward } from '../utils/quote';
import { filesToAttachments } from '../utils/attachments';
import { isOutgoingFolder, type MailMessage, type MailScheduled } from '../types';
import { useMailLibrary, defaultSignature, newId, type MailSignature, type MailTemplate } from '../library';
import { MailComposer } from './MailComposer';
import { RecipientInput, isValidEmail } from './RecipientInput';

/** What the composer is seeded for. */
export type ComposeMode = 'reply' | 'forward' | 'new' | 'scheduled';

interface MailReplyBarProps {
  /**
   * The message being replied to / forwarded. Absent in `new`/`scheduled` mode (a
   * fresh message, or a queued send reopened from the outbox).
   */
  message?: MailMessage;
  /**
   * The queued send being edited (`scheduled` mode). Seeds To/Subject/body from the
   * outbox row; Save reschedules it in place (PATCH), keeping its id + attachments.
   */
  scheduled?: MailScheduled;
  /** Reply (default), forward the open message, a brand-new message, or edit a
   *  queued (scheduled) send. */
  mode: ComposeMode;
  spaceId: number | undefined;
  /** Active mailbox. Send is disabled until one is selected. */
  connectorId: number | null;
  /**
   * Fired after a successful send. Lets the parent close a compose-only pane
   * (`new`) or drop a forward back to plain reply — a plain reply passes nothing
   * and simply stays open with a cleared body.
   */
  onSent?: () => void;
  /**
   * Fill the parent height (standalone "new message" pane) instead of docking as a
   * fixed-height bar under a thread. Drops the composer's resize handle too.
   */
  fill?: boolean;
}

/** Quill emits `<p><br></p>` for an empty doc — strip tags to decide emptiness. */
function isHtmlEmpty(html: string): boolean {
  return !html || html.replace(/<[^>]*>/g, '').replace(/ |&nbsp;/g, '').trim() === '';
}

/** Shared field styling for the save-as-template modal (matches Settings). */
const templateFieldClass =
  'w-full rounded-md border border-[var(--border-primary)] bg-[var(--bg-primary)] px-2.5 py-1.5 text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)] focus:border-[var(--color-primary-500)]';

/** Escape untrusted message text and turn newlines into <br> for the HTML body. */
function textToHtml(text: string): string {
  if (!text.trim()) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>');
}

/**
 * Turn the plain-text quote block from `buildReply` into HTML so it appends
 * cleanly under the HTML body the composer produces. Reply keeps the quote out
 * of the editor and glues it on at send time.
 */
function quotedHtml(text: string): string {
  const esc = textToHtml(text);
  return esc ? `<br><br>${esc}` : '';
}

/** Human fire time for the scheduled-edit banner: "сегодня/завтра в HH:MM" or "D mon в HH:MM". */
function formatFireTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const time = d.toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === now.toDateString()) return `сегодня в ${time}`;
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  if (d.toDateString() === tomorrow.toDateString()) return `завтра в ${time}`;
  return `${d.toLocaleDateString('ru', { day: 'numeric', month: 'short' })} в ${time}`;
}

/** A signature block: a blank line, then the (escaped) signature text. */
function signatureHtml(sig: MailSignature): string {
  const esc = textToHtml(sig.text);
  return esc ? `<p><br></p><p>${esc}</p>` : '';
}

/** A template body as an HTML paragraph (subject is applied separately). */
function templateBodyHtml(tpl: MailTemplate): string {
  const esc = textToHtml(tpl.body);
  return esc ? `<p>${esc}</p>` : '';
}

/**
 * Flatten the composer's HTML body back to plain text for storage as a template.
 * Templates are a plain-text model (re-escaped to HTML on insert via `textToHtml`),
 * so saving raw HTML would double-encode the tags on re-use. Block boundaries and
 * <br> become newlines; entities are decoded once.
 */
function htmlToText(html: string): string {
  return html
    .replace(/<\/(p|div|li|h[1-6]|blockquote)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * ADR-158 — inline composer docked at the bottom of the reading pane (reply /
 * forward) or standing alone on the right (new message). Reuses the P4
 * `MailComposer` (chat-style input: attach / format / send / voice, HTML body,
 * sharp corners) wired to the active mailbox's SMTP via `useSendMail`.
 *
 * Modes:
 *  - `reply`   — To/Subject seeded from the thread; the quote is appended on send.
 *  - `forward` — Subject `Fwd:`, forwarded content pre-filled into the editor,
 *                To left blank for the user to address.
 *  - `new`     — everything blank; no message above it.
 *
 * ⌘/Ctrl+Enter or the Send button fires; a Sent copy is persisted and the lists
 * refresh.
 */
export function MailReplyBar({ message, scheduled, mode, spaceId, connectorId, onSent, fill = false }: MailReplyBarProps) {
  const [attachments, setAttachments] = useState<File[]>([]);
  // Set while files are being base64-encoded, so Send shows progress and can't
  // double-fire before the payload is ready.
  const [encoding, setEncoding] = useState(false);
  const [encodeError, setEncodeError] = useState<string | undefined>(undefined);
  // Flagged when Send is pressed with an empty recipient — new/forward start
  // without a To, so we can't silently no-op.
  const [missingTo, setMissingTo] = useState(false);
  // ADR-158 §P6 — "Отправить позже": the send-menu opens this picker, and a picked
  // time enqueues the same composed payload into the outbox instead of sending now.
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const send = useSendMail(spaceId, connectorId);
  const schedule = useScheduleMail(spaceId, connectorId);
  const saveDraft = useSaveDraft(spaceId, connectorId);
  // ADR-158 §P6 — editing a queued send: PATCH it in place, or drop it from the queue.
  const updateScheduled = useUpdateScheduled(spaceId);
  const cancelScheduled = useCancelScheduled(spaceId);
  const isScheduledEdit = mode === 'scheduled' && !!scheduled;

  // Client-side signatures + templates. The default signature seeds a new message;
  // both are insertable from the composer toolbar. Managed in mail Settings.
  const { library, update: updateLibrary } = useMailLibrary();
  const sig = defaultSignature(library);

  // "Save as template" flow: the send-menu opens a modal to name the template, then
  // the current subject + body land in the client-side library (Settings-managed).
  const [templateModalOpen, setTemplateModalOpen] = useState(false);
  const [templateName, setTemplateName] = useState('');
  const [templateSubject, setTemplateSubject] = useState('');
  const [templateBody, setTemplateBody] = useState('');

  // Seed To / Subject / editor body + the quote appended at send time, derived
  // from the mode and (for reply/forward) the open message.
  const seed = useMemo((): { to: string[]; subject: string; body: string; quoteOnSend: string } => {
    // Editing a queued send — the outbox row already holds the fully-composed body
    // (signature/quote baked in at compose time), so reopen it verbatim, editable.
    if (mode === 'scheduled') {
      return {
        to: scheduled?.to ?? [],
        subject: scheduled?.subject ?? '',
        body: scheduled?.body ?? '',
        quoteOnSend: '',
      };
    }
    if (mode === 'new' || !message) {
      // A brand-new message starts on the default signature (Gmail-style); reply /
      // forward leave it out so it doesn't land between the reply and the quote.
      return { to: [], subject: '', body: sig ? signatureHtml(sig) : '', quoteOnSend: '' };
    }
    if (mode === 'forward') {
      const fwd = buildForward(message);
      return {
        to: [],
        subject: fwd.subject ?? `Fwd: ${message.subject}`,
        // Forwarded content is visible/editable in the body, not glued on later.
        body: textToHtml(fwd.body ?? ''),
        quoteOnSend: '',
      };
    }
    const reply = buildReply(message);
    const replyTo =
      reply.to ?? (isOutgoingFolder(message.folder) ? message.to?.[0] : message.fromAddress) ?? '';
    return {
      to: replyTo ? [replyTo] : [],
      subject: reply.subject ?? `Re: ${message.subject}`,
      body: '',
      quoteOnSend: quotedHtml(reply.body ?? ''),
    };
  }, [mode, message, sig, scheduled]);

  const [to, setTo] = useState<string[]>(seed.to);
  const [subject, setSubject] = useState(seed.subject);
  const [body, setBody] = useState(seed.body);
  // Scheduled-edit only: the (editable) fire time. Empty in every other mode.
  const [scheduledAt, setScheduledAt] = useState<string>(scheduled?.scheduledAt ?? '');

  // Re-seed the draft whenever the target message or the mode changes (switching
  // rows, or flipping reply ⇄ forward on the same open message).
  useEffect(() => {
    setTo(seed.to);
    setSubject(seed.subject);
    setBody(seed.body);
    setScheduledAt(scheduled?.scheduledAt ?? '');
    setAttachments([]);
    setEncodeError(undefined);
    setMissingTo(false);
    setScheduleOpen(false);
    send.reset();
    schedule.reset();
    saveDraft.reset();
    updateScheduled.reset();
    cancelScheduled.reset();
    // seed is derived from [message?.id, mode, scheduled?.id]; re-seeding on those
    // (switching rows, or opening a different queued send) is intentional.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [message?.id, mode, scheduled?.id]);

  // Dirty flag drives the "не сохранено" badge in scheduled-edit: any change to
  // recipient / subject / body / fire time, or a newly-attached file.
  const dirty = useMemo(() => {
    if (!isScheduledEdit) return false;
    const sameTo = to.length === seed.to.length && to.every((a, i) => a === seed.to[i]);
    return (
      !sameTo ||
      subject !== seed.subject ||
      body !== seed.body ||
      attachments.length > 0 ||
      scheduledAt !== (scheduled?.scheduledAt ?? '')
    );
  }, [isScheduledEdit, to, subject, body, attachments.length, scheduledAt, seed, scheduled]);

  /**
   * Validate recipients + body and base64-encode the attachments into the shared
   * send payload. Returns null (and sets the error state for the banner) when the
   * composition isn't sendable — so both "Отправить" and "Отправить позже" gate on
   * the exact same rules and never diverge.
   */
  const buildPayload = async (): Promise<MailSendInput | null> => {
    if (!to.length || to.some((a) => !isValidEmail(a))) {
      setMissingTo(true);
      return null;
    }
    // Allow send with only an attachment (empty body but files picked).
    if (isHtmlEmpty(body) && attachments.length === 0) return null;
    setEncodeError(undefined);

    let encoded;
    try {
      setEncoding(true);
      encoded = await filesToAttachments(attachments);
    } catch (err) {
      setEncodeError((err as Error)?.message || 'Failed to read an attachment');
      return null;
    } finally {
      setEncoding(false);
    }

    return {
      to,
      subject: subject.trim() || (mode === 'reply' && message ? `Re: ${message.subject}` : '(без темы)'),
      // Reply glues the quoted thread under the user's HTML; forward/new already
      // carry their full body in the editor.
      body: `${body}${seed.quoteOnSend}`,
      html: true,
      attachments: encoded,
    };
  };

  const submit = async () => {
    if (send.isPending || schedule.isPending || encoding || !connectorId) return;
    const payload = await buildPayload();
    if (!payload) return;
    send.mutate(payload, {
      onSuccess: () => {
        setBody('');
        setAttachments([]);
        onSent?.();
      },
    });
  };

  // Open the picker only once the composition is actually sendable, so the user
  // doesn't pick a time and then hit a recipient error hidden behind the modal.
  const openSchedule = () => {
    if (!connectorId || send.isPending || schedule.isPending || encoding) return;
    if (!to.length || to.some((a) => !isValidEmail(a))) {
      setMissingTo(true);
      return;
    }
    if (isHtmlEmpty(body) && attachments.length === 0) return;
    setScheduleOpen(true);
  };

  // A picked time enqueues the composed payload into the outbox (nothing sends now).
  const handleSchedule = async (iso: string) => {
    if (send.isPending || schedule.isPending || encoding) return;
    const payload = await buildPayload();
    if (!payload) {
      setScheduleOpen(false);
      return;
    }
    schedule.mutate(
      { msg: payload, scheduledAt: iso },
      {
        onSuccess: () => {
          setBody('');
          setAttachments([]);
          setScheduleOpen(false);
          onSent?.();
        },
      }
    );
  };

  // ── Scheduled-edit actions (ADR-158 §P6) ──────────────────────────────────
  // A picked time in scheduled mode just updates the local (unsaved) fire time —
  // it doesn't persist until Save, so the "не сохранено" badge lights up first.
  const handlePickNewTime = (iso: string) => {
    setScheduledAt(iso);
    setScheduleOpen(false);
  };

  // Save = reschedule in place (PATCH): keeps the outbox id + its stored
  // attachments, applies the edited recipients / subject / body / time. A no-op
  // when nothing changed — just close.
  const handleReschedule = async () => {
    if (!scheduled) return;
    if (updateScheduled.isPending || send.isPending || cancelScheduled.isPending || encoding) return;
    if (!dirty) {
      onSent?.();
      return;
    }
    const payload = await buildPayload();
    if (!payload) return;
    updateScheduled.mutate(
      { id: scheduled.id, msg: payload, scheduledAt: scheduledAt || scheduled.scheduledAt },
      {
        onSuccess: () => {
          setAttachments([]);
          onSent?.();
        },
      }
    );
  };

  // "Отправить сейчас" — drop the queued copy first (so a race with the minute
  // worker can't double-send), then send now. If the send fails the composer stays
  // open with its content intact to retry.
  const handleSendNow = async () => {
    if (!scheduled || !connectorId) return;
    if (send.isPending || updateScheduled.isPending || cancelScheduled.isPending || encoding) return;
    const payload = await buildPayload();
    if (!payload) return;
    cancelScheduled.mutate(scheduled.id, {
      onSuccess: () => {
        send.mutate(payload, {
          onSuccess: () => {
            setAttachments([]);
            onSent?.();
          },
        });
      },
    });
  };

  // "Отменить отправку" — drop the queued send entirely.
  const handleCancelScheduled = () => {
    if (!scheduled || cancelScheduled.isPending) return;
    cancelScheduled.mutate(scheduled.id, { onSuccess: () => onSent?.() });
  };

  // "Сохранить в черновик" — persist the composition to the Drafts folder without
  // sending. Unlike send, recipients are NOT required (that's the point of a draft),
  // but there must be *something* worth saving. Encodes attachments the same way as
  // send so the draft carries their metadata.
  const handleSaveDraft = async () => {
    if (send.isPending || schedule.isPending || saveDraft.isPending || encoding || !connectorId) return;
    if (isHtmlEmpty(body) && !subject.trim() && to.length === 0 && attachments.length === 0) return;
    setEncodeError(undefined);

    let encoded;
    try {
      setEncoding(true);
      encoded = await filesToAttachments(attachments);
    } catch (err) {
      setEncodeError((err as Error)?.message || 'Failed to read an attachment');
      return;
    } finally {
      setEncoding(false);
    }

    saveDraft.mutate(
      {
        to,
        subject: subject.trim(),
        // Keep the quoted thread with the draft so reopening it reads whole.
        body: `${body}${seed.quoteOnSend}`,
        html: true,
        attachments: encoded,
      },
      {
        onSuccess: () => {
          setBody('');
          setAttachments([]);
          onSent?.();
        },
      }
    );
  };

  const missingToError = missingTo
    ? !to.length
      ? 'Укажите получателя'
      : to.some((a) => !isValidEmail(a))
        ? 'Проверьте адрес получателя'
        : undefined
    : undefined;
  const serverError =
    encodeError ??
    missingToError ??
    (send.isError
      ? (send.error as { message?: string })?.message || 'Failed to send — check the mailbox connection.'
      : schedule.isError
        ? (schedule.error as { message?: string })?.message || 'Не удалось запланировать — проверьте подключение ящика.'
        : saveDraft.isError
          ? (saveDraft.error as { message?: string })?.message || 'Не удалось сохранить черновик.'
          : updateScheduled.isError
            ? (updateScheduled.error as { message?: string })?.message || 'Не удалось сохранить изменения — возможно, письмо уже отправляется.'
            : cancelScheduled.isError
              ? (cancelScheduled.error as { message?: string })?.message || 'Не удалось отменить отправку.'
              : undefined);

  // Insert a signature at the end of the body; apply a template's subject (only
  // when the subject is still empty, so a typed one isn't clobbered) + body.
  const insertSignature = (s: MailSignature) => setBody((prev) => (prev || '') + signatureHtml(s));
  const applyTemplate = (t: MailTemplate) => {
    if (t.subject && !subject.trim()) setSubject(t.subject);
    const html = templateBodyHtml(t);
    setBody((prev) => (isHtmlEmpty(prev) ? html : prev + html));
  };

  // Open the save-as-template modal with every field pre-filled straight from the
  // current composition (name defaults to the subject, body flattened to plain
  // text) — nothing is blank, the user only tweaks what they want.
  const openSaveTemplate = () => {
    setTemplateName(subject.trim());
    setTemplateSubject(subject.trim());
    setTemplateBody(htmlToText(body));
    setTemplateModalOpen(true);
  };
  const saveTemplate = () => {
    const name = templateName.trim();
    if (!name) return;
    updateLibrary({
      ...library,
      templates: [
        ...library.templates,
        { id: newId(), name, subject: templateSubject.trim(), body: templateBody.trim() },
      ],
    });
    setTemplateModalOpen(false);
  };

  const templateItems: DropdownMenuItem[] = library.templates.length
    ? library.templates.map((t) => ({
        label: t.icon ? `${t.icon} ${t.name}` : t.name,
        value: t.id,
        onSelect: () => applyTemplate(t),
      }))
    : [{ label: 'Нет шаблонов — добавьте в настройках', value: '__empty', onSelect: () => {} }];
  const signatureItems: DropdownMenuItem[] = library.signatures.length
    ? library.signatures.map((s) => ({
        label: s.icon ? `${s.icon} ${s.name}` : s.name,
        value: s.id,
        onSelect: () => insertSignature(s),
      }))
    : [{ label: 'Нет подписей — добавьте в настройках', value: '__empty', onSelect: () => {} }];

  const pickerBtn = 'flex flex-shrink-0 items-center gap-1 rounded px-1.5 py-1 text-xs text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]';
  const toolbarExtra = (
    <>
      <DropdownMenu
        align="start"
        side="top"
        trigger={
          <button type="button" title="Вставить шаблон" aria-label="Вставить шаблон" className={pickerBtn}>
            <FileText className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Шаблон</span>
          </button>
        }
        items={templateItems}
      />
      <DropdownMenu
        align="start"
        side="top"
        trigger={
          <button type="button" title="Вставить подпись" aria-label="Вставить подпись" className={pickerBtn}>
            <PenLine className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Подпись</span>
          </button>
        }
        items={signatureItems}
      />
    </>
  );

  // Scheduled-edit: the caret menu next to Save (send now / change time / drop).
  const openTimePicker = () => setScheduleOpen(true);
  const scheduledMenuItems: DropdownMenuItem[] = [
    {
      label: 'Отправить сейчас',
      value: 'send-now',
      icon: <SendHorizonal className="h-4 w-4" />,
      onSelect: handleSendNow,
    },
    {
      label: 'Изменить время…',
      value: 'reschedule-time',
      icon: <CalendarClock className="h-4 w-4" />,
      onSelect: openTimePicker,
    },
    {
      label: 'Отменить отправку',
      value: 'cancel-scheduled',
      icon: <Trash2 className="h-4 w-4" />,
      onSelect: handleCancelScheduled,
    },
  ];

  // Composer action wiring differs for scheduled-edit (Save/reschedule + its own
  // menu) vs. the normal send/schedule/draft split button.
  const composerActionProps = isScheduledEdit
    ? {
        onSend: handleReschedule,
        sendLabel: 'Сохранить',
        sendIcon: <Save className="h-4 w-4" />,
        menuItems: scheduledMenuItems,
        sending: send.isPending || updateScheduled.isPending || cancelScheduled.isPending || encoding,
      }
    : {
        onSend: submit,
        onSchedule: openSchedule,
        onSaveDraft: handleSaveDraft,
        onSaveTemplate: openSaveTemplate,
        sending: send.isPending || schedule.isPending || saveDraft.isPending || encoding,
      };

  const placeholder = !connectorId
    ? 'Подключите почтовый ящик, чтобы отправить'
    : mode === 'new'
      ? 'Текст письма…'
      : mode === 'scheduled'
        ? 'Текст отложенного письма…'
        : mode === 'forward'
          ? 'Добавьте сообщение к пересылаемому письму…'
          : `Ответ для ${to[0] || 'отправителя'}…`;

  return (
    <div className={fill ? 'flex min-h-0 flex-1 flex-col bg-[var(--bg-primary)]' : 'flex-shrink-0 bg-[var(--bg-primary)]'}>
      {serverError && (
        <p className="px-3 pt-2 text-xs text-[var(--color-error)]" role="alert">
          {serverError}
        </p>
      )}
      <MailComposer
        value={body}
        onChange={setBody}
        {...composerActionProps}
        disabled={!connectorId}
        attachments={attachments}
        onAttachmentsChange={setAttachments}
        placeholder={placeholder}
        fill={fill}
        toolbarExtra={toolbarExtra}
        header={
          // To / Subject fields above the body input — editable inline for every mode.
          <div className="flex flex-col divide-y divide-[var(--border-primary)] border-b border-[var(--border-primary)]">
            {isScheduledEdit && (
              // Scheduled-edit banner: when it fires + an unsaved-changes badge. The
              // amber tint keeps it visually part of the "Отложенные" surface.
              <div className="flex items-center gap-2 bg-amber-500/10 px-3 py-1.5 text-xs">
                <Clock className="h-3.5 w-3.5 flex-shrink-0 text-amber-500" />
                <button
                  type="button"
                  onClick={openTimePicker}
                  className="min-w-0 truncate text-left text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
                  title="Изменить время отправки"
                >
                  Уйдёт{' '}
                  <span className="font-medium text-[var(--text-primary)]">
                    {scheduledAt ? formatFireTime(scheduledAt) : '—'}
                  </span>
                  <span className="ml-1 text-[var(--text-tertiary)]">· изменить</span>
                </button>
                {dirty && (
                  <span
                    className="ml-auto flex flex-shrink-0 items-center gap-1 rounded-full bg-amber-500/20 px-2 py-0.5 font-medium text-amber-600"
                    role="status"
                  >
                    <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                    Не сохранено
                  </span>
                )}
              </div>
            )}
            <div className="flex items-start gap-2 px-3 py-1.5 text-sm">
              <span className="w-14 flex-shrink-0 pt-1 text-xs text-[var(--text-tertiary)]">Кому</span>
              <RecipientInput
                value={to}
                onChange={(next) => {
                  setTo(next);
                  if (missingTo) setMissingTo(false);
                }}
                disabled={!connectorId}
                placeholder="name@example.com"
                ariaLabel="Кому"
                autoFocus={mode !== 'reply'}
                invalid={!!missingToError}
              />
            </div>
            <label className="flex items-center gap-2 px-3 py-1.5 text-sm">
              <span className="w-14 flex-shrink-0 text-xs text-[var(--text-tertiary)]">Тема</span>
              <input
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                disabled={!connectorId}
                placeholder="Тема письма"
                aria-label="Тема письма"
                className="min-w-0 flex-1 bg-transparent text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)] disabled:cursor-not-allowed"
              />
            </label>
          </div>
        }
      />

      <Modal
        open={templateModalOpen}
        onOpenChange={setTemplateModalOpen}
        size="md"
        title="Сохранить как шаблон"
        description="Всё подставлено из письма — поправьте при необходимости. Шаблон доступен из меню «Шаблон» и в настройках почты."
        footer={
          <>
            <Button variant="secondary" onClick={() => setTemplateModalOpen(false)}>
              Отмена
            </Button>
            <Button variant="primary" disabled={!templateName.trim()} onClick={saveTemplate}>
              Сохранить
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <Input
            label="Название шаблона"
            value={templateName}
            onChange={(e) => setTemplateName(e.target.value)}
            placeholder="Например: Приветствие клиента"
            autoFocus
            onKeyDown={(e) => {
              // Enter in the single-line name field saves; the textarea keeps Enter.
              if (e.key === 'Enter' && templateName.trim()) saveTemplate();
            }}
          />
          <label className="flex flex-col gap-1">
            <span className="text-sm text-[var(--text-secondary)]">Тема</span>
            <input
              value={templateSubject}
              onChange={(e) => setTemplateSubject(e.target.value)}
              placeholder="Тема письма"
              aria-label="Тема шаблона"
              className={templateFieldClass}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-sm text-[var(--text-secondary)]">Текст</span>
            <textarea
              value={templateBody}
              onChange={(e) => setTemplateBody(e.target.value)}
              placeholder="Текст письма…"
              aria-label="Текст шаблона"
              rows={8}
              className={`${templateFieldClass} resize-y`}
            />
          </label>
        </div>
      </Modal>

      {/* "Отправить позже" — the same datetime picker as the AI-chat scheduled
          messages, centered as a modal. Portaled to <body> so it escapes the
          reading pane's z-10 stacking context (otherwise it renders under the
          divider / pane chrome). z-[80] clears the app's Modal (z-[60]/[70]). Its
          own outside-click closes it, so the backdrop is display-only. */}
      {scheduleOpen &&
        createPortal(
          <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4">
            <div className="w-full max-w-md">
              <ScheduleDatePicker
                // Scheduled-edit: picking a time just stages it (Save persists);
                // otherwise it enqueues the composition into the outbox now.
                onSchedule={isScheduledEdit ? handlePickNewTime : handleSchedule}
                onCancel={() => setScheduleOpen(false)}
                isScheduling={isScheduledEdit ? false : schedule.isPending || encoding}
              />
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
